import hashlib,json,os,subprocess,sys,tempfile,unittest,zipfile
from pathlib import Path
import numpy as np
from voice_studio import audio,quality,spectrum,synthesis,portable_import,render_store
from voice_studio.engine import Studio,write_json

class OfflineTests(unittest.TestCase):
 def tone(self,hz,sr=24000):return .1*np.sin(2*np.pi*hz*np.arange(sr*4)/sr)
 def fixture(self,root):
  studio=Studio(root/'project');p=studio.new_profile('Local voice');path=root/'source.wav';audio.write_audio(path,24000,self.tone(180),'FLOAT32');r=studio.import_audio(path)
  studio.save_segments(r['id'],[{'start':0,'end':4,'speaker':'A','purity':'reviewed_single_voice','text':'These are the reference words.','style':'neutral'}]);studio.bind(r['id'],'A',p['id']);studio.import_source(p['id'],b'Local source evidence.','source.txt');return studio,p,studio.export([p['id']])
 def test_bass_band(self):self.assertGreater(spectrum.measure(self.tone(80),24000)['bands']['bass']['energy_fraction'],.95)
 def test_treble_band(self):self.assertGreater(spectrum.measure(self.tone(4000),24000)['bands']['treble']['energy_fraction'],.95)
 def test_silence_unknown(self):
  r=spectrum.measure(np.zeros(24000),24000);self.assertIsNone(r['context']['inferred_emotion']);self.assertTrue(all(x['energy_fraction'] is None for x in r['bands'].values()))
 def test_low_rate_unavailable(self):self.assertIsNone(spectrum.measure(self.tone(1000,8000),8000)['bands']['upper']['energy_fraction'])
 def test_opposite_phase_not_cancelled(self):
  x=self.tone(80);self.assertGreater(spectrum.measure(np.column_stack([x,-x]),24000)['bands']['bass']['energy_fraction'],.95)
 def test_overrange_not_pcm_clipping(self):
  q=quality.inspect(np.full(24000,1.2),24000);self.assertEqual(q['near_full_scale_fraction'],0);self.assertEqual(q['over_range_fraction'],1)
 def test_fullscale_plateau_rejected(self):self.assertEqual(quality.inspect(np.ones(24000),24000)['status'],'reject')
 def test_render_params_rejected(self):
  for value in (True,float('nan'),float('inf'),.1,3):
   with self.subTest(value=value),self.assertRaises(ValueError):synthesis.validate('Test',value,0,0,32,0,'')
  for seed in (True,-1,2**31):
   with self.assertRaises(ValueError):synthesis.validate('Test',1,0,0,32,seed,'')
 def test_unsafe_zip_names(self):
  for name in ('../x','/x','C:/x','a\\b','CON.txt','a./x','x\x00y','a//b'):
   with self.subTest(name=name),self.assertRaises(ValueError):portable_import.safe_name(name)
 def test_case_collisions(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);z=root/'bad.zip'
   with zipfile.ZipFile(z,'w') as out:out.writestr('A.txt','a');out.writestr('a.txt','b')
   with self.assertRaises(ValueError):portable_import.restore(Studio(root/'target'),z)
 def test_restore_and_reexport_original(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);src,p,z=self.fixture(root);dst=Studio(root/'target');result=portable_import.restore(dst,z)
   self.assertNotEqual(result['profile_ids'][0],p['id']);self.assertEqual((dst.root/'original_imports'/result['import_id']/'original.zip').read_bytes(),z.read_bytes())
   with zipfile.ZipFile(dst.export(result['profile_ids'])) as out:self.assertEqual(out.read('original_imports/'+result['import_id']+'/original.zip'),z.read_bytes())
   self.assertEqual(dst.source_text(result['profile_ids'][0],dst.profiles()[0]['sources'][0]['id'])['text'],'Local source evidence.')
 def test_tampered_pack_rolls_back(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);src,p,z=self.fixture(root);bad=root/'bad.zip'
   with zipfile.ZipFile(z) as inp,zipfile.ZipFile(bad,'w') as out:
    for n in inp.namelist():out.writestr(n,b'changed' if n.startswith('clips/') else inp.read(n))
   dst=Studio(root/'target');existing=dst.new_profile('Existing')
   with self.assertRaises(ValueError):portable_import.restore(dst,bad)
   self.assertEqual(dst.profiles(),[existing]);self.assertEqual(dst.records(),[])
 def test_active_pack_over_export_history(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);src,p,z=self.fixture(root);wrapped=root/'wrapped.zip'
   with zipfile.ZipFile(z) as inp,zipfile.ZipFile(wrapped,'w') as out:
    for n in inp.namelist():out.writestr('project/reference_pack/'+n,inp.read(n));out.writestr('project/exports/old/'+n,inp.read(n))
   result=portable_import.restore(Studio(root/'target'),wrapped);self.assertEqual(len(result['profile_ids']),1)
 def test_local_speaker_grouping_does_not_claim_overlap_detection(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);studio,profile,_=self.fixture(root);record=studio.records()[0];record['analysis']={'method':'pyannote','backend':'local-ecapa-energy-clustering'};write_json(studio.record_path(record['id'])/'record.json',record)
   with zipfile.ZipFile(studio.export([profile['id']])) as z:manifest=json.loads(z.read('manifest.json'))
   self.assertFalse(manifest['recordings'][0]['overlap_detection_available'])
 def test_review_hash_and_history(self):
  with tempfile.TemporaryDirectory() as d:
   s=Studio(Path(d));p=s.root/'renders/render_0123456789abcdef';p.mkdir(parents=True);(p/'speech.wav').write_bytes(b'a');write_json(p/'receipt.json',{'audio_sha256':hashlib.sha256(b'a').hexdigest(),'review_history':[]})
   r=render_store.review(s,p.name,'needs_revision','Check words');self.assertEqual(len(r['review_history']),1);before=(p/'receipt.json').read_bytes();(p/'speech.wav').write_bytes(b'b')
   with self.assertRaises(ValueError):render_store.review(s,p.name,'approved')
   self.assertEqual((p/'receipt.json').read_bytes(),before)
   with self.assertRaises(ValueError):render_store.directory(s,'../outside')
 def test_offline_guard_in_fresh_process(self):
  code="from voice_studio import offline;offline.activate();import socket;socket.getaddrinfo('127.0.0.1',80)\nfor action in (lambda:socket.getaddrinfo('example.com',80),lambda:__import__('onnxruntime')):\n try:action();raise AssertionError('not blocked')\n except (OSError,ImportError):pass"
  result=subprocess.run([sys.executable,'-c',code],capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode())
