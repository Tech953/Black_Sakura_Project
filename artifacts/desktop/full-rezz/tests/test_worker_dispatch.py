import contextlib
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from voice_studio.worker import run
from voice_studio import models

class WorkerDispatchTests(unittest.TestCase):
    def test_health_does_not_initialize_project(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace=Path(directory)/'uncreated'
            for status in ({'passed':True},{'passed':False}):
                with patch('voice_studio.worker.enforce_offline'),patch('full_rezz_companion.worker_lifetime.attach'),patch('voice_studio.runtime.health',return_value=status),patch('voice_studio.engine.Studio',side_effect=AssertionError('must not initialize')):
                    self.assertEqual(run({'workspace':str(workspace),'operation':'health'}),status)
            self.assertFalse(workspace.exists())
    def test_transcription_is_ephemeral(self):
        with patch('voice_studio.worker.enforce_offline'),patch('full_rezz_companion.worker_lifetime.attach'),patch('voice_studio.audio.read_audio',return_value=(16000,np.zeros((1600,1)))),patch('voice_studio.models.transcribe',return_value={'segments':[{'text':'review draft'}],'language':'en'}) as transcribe,patch('voice_studio.engine.Studio',side_effect=AssertionError('must not import')):
            value=run({'workspace':'/unused','operation':'transcribe_clip','args':{'path':'clip.audio','language':'fr'}})
            self.assertEqual(value['text'],'review draft');self.assertEqual(transcribe.call_args.kwargs['language'],'fr')
    def test_duration_limit_before_inference(self):
        with patch('voice_studio.worker.enforce_offline'),patch('full_rezz_companion.worker_lifetime.attach'),patch('voice_studio.audio.read_audio',return_value=(1000,np.zeros((61000,1)))),patch('voice_studio.models.transcribe') as transcribe:
            with self.assertRaisesRegex(ValueError,'60 seconds'):run({'workspace':'/unused','operation':'transcribe_clip','args':{'path':'clip.audio'}})
            transcribe.assert_not_called()
    def test_missing_optional_models(self):
        with patch.object(models,'model_path',side_effect=ValueError('missing')):
            value=models.capabilities();self.assertFalse(value['pyannote']);self.assertFalse(value['separation']);self.assertFalse(value['separation_high_fidelity'])
    def test_nonempty_diarization(self):
        class Tensor:
            def reshape(self,*args):return self
            def cpu(self):return self
            def numpy(self):return np.array([1.,0.,0.])
        speaker=types.ModuleType('speechbrain.inference.speaker');speaker.EncoderClassifier=types.SimpleNamespace(from_hparams=lambda **kwargs:types.SimpleNamespace(encode_batch=lambda _:Tensor()))
        fetching=types.ModuleType('speechbrain.utils.fetching');fetching.LocalStrategy=types.SimpleNamespace(COPY='copy')
        torch=types.SimpleNamespace(inference_mode=contextlib.nullcontext,from_numpy=lambda x:x)
        with patch.dict('sys.modules',{'speechbrain.inference.speaker':speaker,'speechbrain.utils.fetching':fetching}),patch.object(models,'threads',return_value=torch),patch.object(models,'model_path',return_value=Path('/local/speaker')),patch.object(models,'activity_regions',return_value=[(0.,1.)]):
            value=models.diarize(np.zeros((16000,1),np.float32),16000)
            self.assertEqual(value['segments'][0]['speaker'],'SPEAKER_00');self.assertEqual(len(value['embeddings']),1)
