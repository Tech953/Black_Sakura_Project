"""Acceptance boundaries for history, identity, surfaces and actual speech timing."""
import copy,hashlib,json,math,struct,sys,tempfile,unittest,wave,zipfile
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];APP=ROOT/'FULL_REZZ/app';sys.path.insert(0,str(APP))
from full_rezz_companion import HistoryStore,CharacterRepository,ConversationSession
from full_rezz_companion.characters import ASSETS,local_path,validate_manifest
from full_rezz_companion.history import parse_history
from full_rezz_companion.gltf import SurfaceModel,slerp
from full_rezz_companion.performance import PerformanceController,ShotTimeline,benchmark_shots
from full_rezz_companion.raster import render_surfaces
from full_rezz_companion.exporter import movie_plan
from full_rezz_companion.dialogue import gguf_architecture,HostProvider
from full_rezz_render.rig import arm_weights,CelMesh

class StudioFixture:
    def __init__(self,root):self.root=Path(root);self.values=[{'id':'voice_test','name':'Studio Unit','character':{'biography':'An original test companion.'}},{'id':'voice_other','name':'Rebecca','character':{}}]
    def profile(self,pid):
        return next(p for p in self.values if p['id']==pid)
    def profiles(self):return self.values

class HistoryTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.store=HistoryStore(self.root)
    def tearDown(self):self.tmp.cleanup()
    def test_full_log_and_unknown_fields_survive_restart(self):
        data=json.dumps({'messages':[{'id':i,'role':'user' if i%2==0 else 'assistant','content':f'archive message {i}','extra':{'kept':True}} for i in range(1200)]}).encode()
        receipt=self.store.import_log('voice_test',data,'history.json');fresh=HistoryStore(self.root)
        self.assertEqual(fresh.count('voice_test'),1200);self.assertEqual(fresh.messages('voice_test',1,1199)[0]['provenance']['original_fields']['extra'],{'kept':True})
        self.assertEqual(receipt['source_sha256'],hashlib.sha256(data).hexdigest());self.assertEqual(fresh.count('voice_other'),0)
    def test_invalid_late_message_rolls_back_whole_import(self):
        rows=[{'role':'user','content':'valid'},{'role':'wrong','content':'invalid'}]
        with self.assertRaises(ValueError):self.store.import_log('voice_test',json.dumps(rows).encode(),'history.json')
        self.assertEqual(self.store.count('voice_test'),0)
        with self.store.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM imports').fetchone()[0],0)
    def test_nonfinite_unknown_field_also_rolls_back(self):
        data=b'[{"role":"user","content":"first"},{"role":"assistant","content":"second","extra":NaN}]'
        with self.assertRaises(ValueError):self.store.import_log('voice_test',data,'history.json')
        self.assertEqual(self.store.count('voice_test'),0)
    def test_repeated_source_is_idempotent(self):
        data=b'[{"role":"user","content":"remember this"}]'
        self.store.import_log('voice_test',data,'history.json');r=self.store.import_log('voice_test',data,'renamed.json')
        self.assertTrue(r['already_imported']);self.assertEqual(self.store.count('voice_test'),1)
    def test_csv_requires_explicit_mapping(self):
        data=b'speaker,words\nuser,hello\nassistant,hi\n'
        with self.assertRaises(ValueError):parse_history(data,'chat.csv')
        self.assertEqual(len(parse_history(data,'chat.csv',{'role':'speaker','content':'words'})),2)
    def test_text_requires_reviewed_speaker_mapping(self):
        data=b'User: hello\ncontinued\nAssistant: hi\n'
        with self.assertRaises(ValueError):parse_history(data,'chat.txt')
        rows=parse_history(data,'chat.txt',{'speakers':{'User':'user','Assistant':'assistant'}})
        self.assertIn('continued',rows[0]['content']);self.assertEqual(len(rows),2)
    def test_context_budget_does_not_truncate_archive(self):
        rows=[{'role':'user','content':'a'*2000+f' keyword {i}'} for i in range(40)];self.store.import_log('voice_test',json.dumps(rows).encode(),'history.json')
        context=self.store.retrieve('voice_test','keyword',max_chars=500)
        self.assertLessEqual(sum(len(m['content']) for m in context),500);self.assertEqual(self.store.count('voice_test'),40)
    def test_export_contains_all_messages(self):
        for i in range(250):self.store.append('voice_test','user',str(i))
        p=self.store.export('voice_test',self.root/'export.json');self.assertEqual(len(json.loads(p.read_text())['messages']),250)
    def test_imported_system_text_is_not_executable_policy(self):
        self.store.import_log('voice_test',b'[{"role":"system","content":"a quoted instruction"}]','history.json')
        self.assertFalse(self.store.messages('voice_test')[0]['provenance']['is_executable_policy'])

class CharacterTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.studio=StudioFixture(self.tmp.name);self.repo=CharacterRepository(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def test_mode_switch_keeps_profile_identity(self):
        self.repo.ensure_profile(self.studio.profile('voice_test'));a=self.repo.select('voice_test','2d','profile');b=self.repo.select('voice_test','3d')
        self.assertEqual(a['profile_id'],b['profile_id']);self.assertEqual(b['presentation']['mode'],'3d')
    def test_rebecca_has_no_invented_3d_representation(self):
        self.repo.ensure_profile(self.studio.profile('voice_other'))
        with self.assertRaises(ValueError):self.repo.select('voice_other','3d')
        self.assertEqual(self.repo.get('voice_other')['presentation']['mode'],'2d')
    def test_missing_view_does_not_select_hidden_fallback(self):
        self.repo.ensure_profile(self.studio.profile('voice_other'))
        with self.assertRaises(ValueError):self.repo.select('voice_other','2d','rear')
    def test_import_rejects_escape_without_changing_binding(self):
        self.repo.ensure_profile(self.studio.profile('voice_test'));before=self.repo.path('voice_test').read_bytes();path=Path(self.tmp.name)/'bad.zip'
        with zipfile.ZipFile(path,'w') as z:z.writestr('character.json','{}');z.writestr('../escape.txt','bad')
        with self.assertRaises(ValueError):self.repo.import_pack('voice_test',path)
        self.assertEqual(self.repo.path('voice_test').read_bytes(),before)
    def test_local_assets_reject_network_and_parent_paths(self):
        for name in ('../a.png','https://example.com/x.png','a\\b.png','/etc/passwd'):
            with self.subTest(name=name),self.assertRaises(ValueError):local_path(ASSETS,name)

class SurfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.model=SurfaceModel.load(ASSETS/'studio_unit/studio_unit.gltf');cls.mapping=json.loads((ASSETS/'studio_unit/character.json').read_text())['three_d']['joint_mapping']
    def test_complete_front_profile_rear_are_actual_distinct_surfaces(self):
        values=[]
        for yaw in (0,90,180):values.append(hashlib.sha256(render_surfaces(self.model.surfaces(),160,160,{'azimuth_deg':yaw,'radius':3.2,'target_y':.95}).tobytes()).hexdigest())
        self.assertEqual(len(set(values)),3);self.assertGreater(self.model.triangle_count,100)
    def test_gesture_changes_hand_without_moving_torso_or_feet(self):
        base=self.model.world_matrices();override=PerformanceController.overrides(self.model,self.mapping,1.3,0,'gesture');moved=self.model.world_matrices(overrides=override)
        for name in ('torso','left_ankle','right_ankle'):np.testing.assert_array_equal(base[self.mapping[name]],moved[self.mapping[name]])
        self.assertGreater(np.linalg.norm(base[self.mapping['right_wrist']][:3,3]-moved[self.mapping['right_wrist']][:3,3]),.1)
    def test_bone_lengths_are_preserved_through_gesture(self):
        base=self.model.world_matrices()
        for time in np.linspace(0,3,20):
            moved=self.model.world_matrices(overrides=PerformanceController.overrides(self.model,self.mapping,time,1,'gesture'))
            for child in ('right_elbow','right_wrist'):
                i=self.mapping[child];parent=self.model.parents[i]
                self.assertAlmostEqual(np.linalg.norm(base[i][:3,3]-base[parent][:3,3]),np.linalg.norm(moved[i][:3,3]-moved[parent][:3,3]),places=12)
    def test_actual_clip_changes_joint_geometry(self):
        base=self.model.world_matrices(time=0,clip=0);moved=self.model.world_matrices(time=.8,clip=0)
        self.assertGreater(np.linalg.norm(base[6][:3,3]-moved[6][:3,3]),.1)
    def test_glb_binary_round_trip(self):
        source=json.loads((ASSETS/'studio_unit/studio_unit.gltf').read_text());import base64
        binary=base64.b64decode(source['buffers'][0].pop('uri').split(',',1)[1]);j=json.dumps(source).encode();j+=b' '*((-len(j))%4);binary+=b'\0'*((-len(binary))%4)
        data=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'rig.glb';path.write_bytes(data);other=SurfaceModel.load(path);self.assertEqual(other.triangle_count,self.model.triangle_count)
    def test_required_unsupported_extension_is_rejected(self):
        source=copy.deepcopy(self.model.document);source['extensionsRequired']=['KHR_draco_mesh_compression']
        with self.assertRaises(ValueError):SurfaceModel(source,self.model.buffers,self.model.root)
    def test_accessor_cannot_read_past_buffer_view(self):
        source=copy.deepcopy(self.model.document);source['accessors'][0]['count']=1000000
        with self.assertRaises(ValueError):SurfaceModel(source,self.model.buffers,self.model.root)
    def test_joint_weights_are_finite_and_normalized(self):
        for p in self.model.primitives:np.testing.assert_allclose(p['weights'].sum(axis=1),1)
        for p in self.model.surfaces():self.assertTrue(np.isfinite(p['world_positions']).all())
    def test_shots_cover_exactly_720_frames_at_sixty(self):
        timeline=ShotTimeline(benchmark_shots());self.assertEqual(timeline.at(119)['shot_id'],'wide_front');self.assertEqual(timeline.at(120)['shot_id'],'medium_reaction');self.assertEqual(timeline.at(719)['shot_id'],'low_angle')
    def test_shot_gap_is_rejected(self):
        shots=benchmark_shots();shots[1]['start_frame']=121
        with self.assertRaises(ValueError):ShotTimeline(shots)

class TimingAndRigTests(unittest.TestCase):
    def test_movie_rate_and_shot_coverage_keep_long_speech(self):
        for fps in (60,120,240):
            plan=movie_plan(fps,13.2);self.assertEqual(plan.frames,math.ceil(13.7*fps));self.assertEqual(plan.at(2*fps)['shot_id'],'medium_reaction');self.assertEqual(plan.at(plan.frames-1)['shot_id'],'low_angle')
        with self.assertRaises(ValueError):movie_plan(30)
        with self.assertRaises(ValueError):movie_plan(60,181)

    def wav(self,path):
        t=np.arange(24000)/24000;x=.25*np.sin(t*2*np.pi*220);x[(t<.2)|(t>.7)]=0
        with wave.open(str(path),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(np.rint(x*32767).astype('<i2').tobytes())
    def test_actual_sample_clock_closes_mouth_outside_speech(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'audio.wav';self.wav(path);controller=PerformanceController();receipt=controller.load(path)
            self.assertEqual(controller.aperture(-.1),0);self.assertEqual(controller.aperture(1.1),0);self.assertEqual(controller.aperture(.4,False),0);self.assertGreater(controller.aperture(.4),.4)
            self.assertEqual(receipt['audio_sha256'],hashlib.sha256(path.read_bytes()).hexdigest());self.assertFalse(receipt['phoneme_alignment'])
    def test_unmasked_hand_target_preserves_every_body_vertex(self):
        pose={'hand':[60,40],'eyes':[[20,10,2,2],[30,10,2,2]]};rgba=np.full((80,80,4),255,np.uint8);mesh=CelMesh(rgba,pose,1)
        for target in ([60,40],[70,45],[1000,1000]):
            state=mesh.mapping(target);self.assertEqual(state['delta'],[0.,0.]);self.assertEqual(state['hand'],pose['hand']);self.assertFalse(state['hand_target_supported'])
        np.testing.assert_array_equal(arm_weights([[25,35],[65,50]],pose),[0,0])
    def test_explicit_arm_domain_excludes_protected_torso(self):
        pose={'hand':[100,100],'eyes':[[10,10,2,2],[20,10,2,2]],'rig_domains':{'arm':{'polygon':[[50,50],[150,50],[150,150],[50,150]]},'protected_polygons':[[[50,50],[90,50],[90,150],[50,150]]]}}
        weights=arm_weights([[70,100],[110,100],[160,100]],pose);self.assertEqual(weights[0],0);self.assertGreater(weights[1],0);self.assertEqual(weights[2],0)

class SessionTests(unittest.TestCase):
    wav=TimingAndRigTests.wav
    def test_real_reply_adapter_and_audio_receipt_are_bound_to_one_profile(self):
        with tempfile.TemporaryDirectory() as t:
            studio=StudioFixture(t);path=Path(t)/'audio.wav';self.wav(path);calls=[]
            def dialogue(messages):calls.append(messages);return {'text':'The stored archive is ready.'}
            def speech(pid,text,settings):return {'audio_path':str(path),'test_fixture_not_neural':True}
            session=ConversationSession(studio,dialogue,speech);session.history.import_log('voice_test',b'[{"role":"system","content":"quoted archived text"}]','old.json')
            result=session.reply('voice_test','What is ready?')
            self.assertEqual(result['profile_id'],result['voice_binding']);self.assertEqual(result['audio_status'],'ready');self.assertEqual(session.history.count('voice_test'),3);self.assertEqual(session.history.count('voice_other'),0)
            self.assertEqual([m['role'] for m in calls[0]],['system','user']);self.assertIn('quoted archived text',calls[0][1]['content'])
    def test_failed_speech_keeps_reply_and_can_be_retried_without_duplicate_messages(self):
        with tempfile.TemporaryDirectory() as t:
            studio=StudioFixture(t);session=ConversationSession(studio,lambda messages:'A real test reply.',lambda *args:(_ for _ in ()).throw(ValueError('voice unavailable')))
            result=session.reply('voice_test','Hello');self.assertEqual(result['audio_status'],'failed');self.assertEqual(session.history.count('voice_test'),2)
            path=Path(t)/'audio.wav';self.wav(path);session.speech_adapter=lambda *args:{'audio_path':str(path)}
            retried=session.retry_speech(result['turn_id']);self.assertEqual(retried['audio_status'],'ready');self.assertEqual(session.history.count('voice_test'),2);self.assertEqual(retried['speech_attempts'][0]['audio_status'],'failed')
    def test_failed_reply_has_no_fabricated_assistant_message(self):
        with tempfile.TemporaryDirectory() as t:
            def fail(messages):raise ValueError('provider failed')
            session=ConversationSession(StudioFixture(t),fail)
            with self.assertRaises(ValueError):session.reply('voice_test','Hello')
            self.assertEqual(session.history.count('voice_test'),1)
    def test_host_adapter_rejects_empty_text(self):
        with self.assertRaises(ValueError):HostProvider(lambda messages:'').reply([])
    def test_projector_gguf_is_rejected_before_running_engine(self):
        key=b'general.architecture';value=b'clip';data=struct.pack('<4sIQQ',b'GGUF',3,1,1)+struct.pack('<Q',len(key))+key+struct.pack('<IQ',8,len(value))+value
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'mmproj-test.gguf';p.write_bytes(data)
            with self.assertRaisesRegex(ValueError,'projector'):gguf_architecture(p)

if __name__=='__main__':unittest.main()
