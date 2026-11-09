import unittest,tempfile,json,sys,subprocess
from pathlib import Path
import numpy as np
from voice_studio import spectrum
from voice_studio.engine import Studio
from voice_studio.synthesis import word_check,RenderManager,RATINGS
class OfflineTests(unittest.TestCase):
 def test_band_calibration(self):
  t=np.arange(24000)/24000;r=spectrum.measure(.2*(np.sin(2*np.pi*100*t)+np.sin(2*np.pi*4000*t)),24000)['band_percent'];self.assertAlmostEqual(r['bass'],50,delta=.2);self.assertAlmostEqual(r['treble'],50,delta=.2);self.assertAlmostEqual(sum(r.values()),100)
 def test_silence_and_limits(self):
  self.assertFalse(spectrum.measure(np.zeros(24000),24000)['available']);r=spectrum.measure(np.sin(np.arange(24000)),24000);self.assertFalse(spectrum.compare(r,r)['spectral_agreement_verified'])
 def test_word_check_preserves_slang(self):self.assertEqual(word_check('Easy choom','Easy chume')['word_errors'],1);self.assertTrue(word_check('Hello, WORLD!','hello world')['passed'])
 def test_network_denied(self):
  p=subprocess.run([sys.executable,'-c','from voice_studio.runtime import enforce_offline;enforce_offline();import socket;socket.create_connection(("example.com",443))'],capture_output=True,text=True);self.assertNotEqual(p.returncode,0);self.assertIn('Network access is disabled',p.stderr)
 def test_telemetry_engine_blocked(self):
  p=subprocess.run([sys.executable,'-c','from voice_studio.runtime import enforce_offline;enforce_offline();import onnxruntime'],capture_output=True,text=True);self.assertNotEqual(p.returncode,0);self.assertIn('excluded from this offline release',p.stderr)
 def test_all_revisions_and_reviews(self):
  with tempfile.TemporaryDirectory() as d:
   s=Studio(Path(d));p=s.new_profile('A');p=s.update_character(p['id'],{**p['character'],'biography':'changed'});self.assertTrue(list((s.root/'profile_history'/p['id']).glob('*.json')));g=RenderManager(s);folder=g.root/'gen_0000000000000001';folder.mkdir();(folder/'audit.json').write_text(json.dumps({'id':folder.name,'status':'ready_for_listening_review','profile_id':p['id'],'word_check_history':[{'passed':False}]}));r=g.review(folder.name,{k:'unreviewed' for k in RATINGS},'pending');self.assertFalse(r['word_check_history'][0]['passed']);self.assertEqual(len(r['review_history']),1)
 def test_archive_contract(self):
  with tempfile.TemporaryDirectory() as d:
   s=Studio(Path(d));p=s.new_profile('A');c=p['character'];c['archive_contract']={'emulation_mode':'posthumous_archive','canonical_status':'deceased','new_dialogue_status':'authored_noncanon','may_claim_performer_identity':True}
   with self.assertRaises(ValueError):s.update_character(p['id'],c)
 def test_export_generation_policy(self):
  with tempfile.TemporaryDirectory() as d:
   s=Studio(Path(d));p=s.new_profile('A');g=RenderManager(s);f=g.root/'gen_0000000000000002';f.mkdir();(f/'audit.json').write_text(json.dumps({'id':f.name,'profile_id':p['id'],'generation_performed':False}));z=s.export([p['id']]);m=json.loads((z.with_suffix('')/'manifest.json').read_text());self.assertTrue(m['generation_audits']);self.assertFalse(m['voice_analysis_policy']['spectral_agreement_verified'])
