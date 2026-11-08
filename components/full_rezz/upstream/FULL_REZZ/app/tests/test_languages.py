import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from voice_studio.languages import LanguageSettings,Localizer,LOCALES,canonical,catalogs,read_settings,save_settings,synthesis_capability
from voice_studio.synthesis import disclosure,word_check,RenderManager
from voice_studio.engine import Studio
class LanguageTests(unittest.TestCase):
 def test_catalogs_complete(self):
  c=catalogs();self.assertEqual(len(c),12)
  for language in LOCALES:self.assertEqual(set(c['en']),set(c[language]))
 def test_independent_persisted_settings_and_custom_fields(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'settings.json';p.write_text(json.dumps({'workspace':'old','custom':{'keep':True},'languages':{'future':42}}));s=LanguageSettings(interface_language='ar',reply_language='fr',transcription_language='ja',synthesis_language='hi',speech_engine='espeak');save_settings(p,s);data,loaded=read_settings(p);self.assertEqual(loaded,s);self.assertEqual(data['workspace'],'old');self.assertEqual(data['custom'],{'keep':True});self.assertEqual(data['languages']['future'],42)
 def test_default_migration_retains_workspace(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'settings.json';p.write_text('{"workspace":"old"}');data,s=read_settings(p);self.assertEqual(data['workspace'],'old');self.assertEqual(s.interface_language,'en')
 def test_aliases(self):self.assertEqual(canonical('zh-CN'),'zh-Hans');self.assertEqual(canonical('en-US'),'en')
 def test_unsupported_language_tags(self):
  for value in ['xx','zh-Hant','../ar',42]:
   with self.assertRaises(ValueError):canonical(value)
 def test_asr_auto_and_chinese_mapping(self):self.assertIsNone(LanguageSettings().transcription_code());self.assertEqual(LanguageSettings(transcription_language='zh-Hans').transcription_code(),'zh')
 def test_auto_reply_requires_host_confirmation(self):
  c=LanguageSettings(interface_language='ar',synthesis_language='hi').reply_contract();self.assertIsNone(c['resolved_language']);self.assertTrue(c['host_must_confirm_language']);self.assertFalse(c['translate_sources']);self.assertFalse(c['studio_generates_chat'])
 def test_reply_follows_user_not_interface(self):self.assertEqual(LanguageSettings(interface_language='ar').reply_contract('ja')['resolved_language'],'ja')
 def test_explicit_reply_does_not_follow_user(self):self.assertEqual(LanguageSettings(reply_language='fr').reply_contract('hi')['resolved_language'],'fr')
 def test_f5_limits_no_fallback(self):
  for code in LOCALES:
   c=synthesis_capability(code,'f5');self.assertEqual(c['language_supported'],code in ('en','zh-Hans'));self.assertFalse(c['automatic_fallback']);self.assertTrue(c['reference_conditioned'])
 def test_generic_not_character_voice(self):
  for code in LOCALES:
   c=synthesis_capability(code,'espeak');self.assertTrue(c['language_supported']);self.assertFalse(c['reference_conditioned']);self.assertFalse(c['character_likeness_verified'])
 def test_unsupported_f5_refused_before_reference_export(self):
  with tempfile.TemporaryDirectory() as d:
   s=Studio(Path(d));p=s.new_profile('voice')
   with patch('voice_studio.synthesis.enforce_offline'),patch.object(s,'export',side_effect=AssertionError('must not export')):
    with self.assertRaisesRegex(ValueError,'does not support'):RenderManager(s).generate(p['id'],'bonjour',language='fr')
   self.assertEqual(RenderManager(s).list(),[])
 def test_disclosures_distinguish_archive(self):
  for code in LOCALES:self.assertTrue(disclosure(code));self.assertNotEqual(disclosure(code),disclosure(code,True))
 def test_chinese_character_error_metric(self):
  c=word_check('你好世界','你好世',language='zh-Hans');self.assertEqual(c['metric'],'CER');self.assertEqual(c['character_error_rate'],.25);self.assertIsNone(c['word_error_rate']);self.assertFalse(c['passed'])
 def test_japanese_characters(self):self.assertEqual(word_check('音声テスト','音声テスト',language='ja')['character_error_rate'],0)
 def test_english_slang_not_remapped(self):self.assertEqual(word_check('Easy, choom.','Easy tune.',language='en')['word_error_rate'],.5)
 def test_localized_guides_cover_workflows(self):
  for code in LOCALES:
   localizer=Localizer(code);guide=localizer.guide();self.assertIn(localizer.text('Speech engine'),guide)
   for heading in ['1 Audio & regions','2 Profile & sources','3 Generate','4 Review & audit','5 Export & backup']:self.assertIn('## '+localizer.text(heading),guide)
 def test_named_interpolation(self):
  for code in LOCALES:self.assertIn('ASR',Localizer(code).text('Processing {operation} locally…',operation='ASR'))
 def test_bad_settings_are_not_silently_reset(self):
  with self.assertRaises(ValueError):LanguageSettings.from_dict([])
 def test_hindi_and_arabic_word_boundaries(self):
  self.assertEqual(word_check('यह हिन्दी में परीक्षण है।','यह हिन्दी में परीक्षण है।',language='hi')['expected_word_count'],5);c=word_check('هٰذَا اِخْتِبَارٌ','هذا اختبار',language='ar');self.assertEqual(c['expected_word_count'],2);self.assertEqual(c['word_error_rate'],0)
 def test_chinese_script_mapping_keeps_raw_transcript(self):
  c=word_check('这是中文声音测试','這是中文聲音測試',language='zh-Hans');self.assertTrue(c['passed']);self.assertEqual(c['transcribed_text'],'這是中文聲音測試');self.assertEqual(c['comparison_transcribed_text'],'这是中文声音测试');self.assertIn('per-character',c['script_normalization'])
