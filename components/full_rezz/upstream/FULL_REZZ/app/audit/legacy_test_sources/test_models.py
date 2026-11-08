"""Backend interface contracts without model downloads or torch requirements.

Real transcription and separation are additionally exercised in the audit
artifacts; Community-1 inference still requires model access.
"""
import contextlib
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from voice_studio import models


class Tensor:
    def __init__(self, data): self.data = np.asarray(data)
    def __getitem__(self, item): return Tensor(self.data[item])
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.data


class ModelContracts(unittest.TestCase):
    def setUp(self):
        self.sr = 24000
        self.data = np.stack([np.full(self.sr, .1, np.float32), np.full(self.sr, .3, np.float32)], axis=1)
        self.torch = types.SimpleNamespace(from_numpy=lambda x:x, inference_mode=contextlib.nullcontext)

    def test_diarization_resampling_exclusive_regions_and_embeddings(self):
        calls = []
        class Annotation:
            def itertracks(self, yield_label=False):
                yield types.SimpleNamespace(start=.1,end=.5), None, 'SPEAKER_00'
            def labels(self): return ['SPEAKER_00']
        class Pipeline:
            @staticmethod
            def from_pretrained(name, **kwargs):
                def run(source, **options):
                    calls.append((source,options))
                    return types.SimpleNamespace(speaker_diarization=Annotation(), exclusive_speaker_diarization=Annotation(), speaker_embeddings=np.array([[.5,.2]]))
                return run
        modules={'torch':self.torch,'pyannote':types.ModuleType('pyannote'),'pyannote.audio':types.SimpleNamespace(Pipeline=Pipeline)}
        with patch.dict('sys.modules',modules): result=models.diarize(self.data,self.sr,2,model='test-local-model')
        self.assertEqual((1,16000), calls[0][0]['waveform'].shape)
        self.assertAlmostEqual(.2,float(calls[0][0]['waveform'][0,500]),delta=1e-4)
        self.assertEqual({'num_speakers':2},calls[0][1])
        self.assertEqual([.5,.2],result['embeddings']['SPEAKER_00'])
        self.assertEqual('model_nonoverlap',result['segments'][0]['purity'])
        self.assertEqual('SPEAKER_00',result['exclusive_segments'][0]['speaker'])

    def test_provider_exception_does_not_expose_credentials(self):
        class Pipeline:
            @staticmethod
            def from_pretrained(*args, **kwargs): raise RuntimeError('private-token-123 private-provider-url')
        with patch.dict('sys.modules',{'torch':self.torch,'pyannote':types.ModuleType('pyannote'),'pyannote.audio':types.SimpleNamespace(Pipeline=Pipeline)}):
            with self.assertRaises(ValueError) as caught: models.diarize(self.data,self.sr)
        self.assertNotIn('private-token-123',str(caught.exception))

    def test_whisper_adapter_retains_words_probabilities_and_language(self):
        calls = []
        class WhisperModel:
            def __init__(self,name,**kwargs): calls.append((name,kwargs))
            def transcribe(self,waveform,**kwargs):
                calls.append((waveform,kwargs))
                word=types.SimpleNamespace(start=.1,end=.5,word=' Hello',probability=.98)
                row=types.SimpleNamespace(start=.1,end=.5,text=' Hello ',words=[word])
                return iter([row]),types.SimpleNamespace(language='en',language_probability=.99)
        with patch.dict('sys.modules',{'faster_whisper':types.SimpleNamespace(WhisperModel=WhisperModel),
                                     'onnxruntime':types.SimpleNamespace(disable_telemetry_events=lambda: None)}): result=models.transcribe(self.data,self.sr,'tiny.en','en')
        self.assertEqual('cpu',calls[0][1]['device'])
        self.assertEqual('int8',calls[0][1]['compute_type'])
        self.assertEqual(16000,len(calls[1][0]))
        self.assertTrue(calls[1][1]['word_timestamps'])
        self.assertEqual(.98,result['segments'][0]['words'][0]['probability'])
        self.assertEqual('Hello',result['segments'][0]['text'])

    def test_separation_uses_copy_cache_and_validates_two_sources(self):
        calls=[]
        class SepformerSeparation:
            @staticmethod
            def from_hparams(**kwargs): calls.append(kwargs);return SepformerSeparation()
            def separate_batch(self,data):
                self.input=data
                return Tensor(np.stack([data,data],axis=-1))
        modules={'torch':self.torch,'speechbrain':types.ModuleType('speechbrain'),
                 'speechbrain.inference':types.ModuleType('speechbrain.inference'),
                 'speechbrain.inference.separation':types.SimpleNamespace(SepformerSeparation=SepformerSeparation),
                 'speechbrain.utils':types.ModuleType('speechbrain.utils'),
                 'speechbrain.utils.fetching':types.SimpleNamespace(LocalStrategy=types.SimpleNamespace(COPY='copy'))}
        with tempfile.TemporaryDirectory() as temp,patch.dict('sys.modules',modules):
            sr,data=models.separate(self.data,self.sr,Path(temp))
        self.assertEqual(8000,sr)
        self.assertEqual((8000,2),data.shape)
        self.assertEqual('copy',calls[0]['local_strategy'])
        self.assertEqual({'device':'cpu'},calls[0]['run_opts'])

    def test_long_separation_input_is_rejected_before_loading_models(self):
        with self.assertRaisesRegex(ValueError,'30 seconds'):
            models.separate(np.zeros((24000*31,1),np.float32),self.sr,Path('unused'))

    def test_missing_optional_backends_fail_with_setup_instructions(self):
        for module,action in [('pyannote.audio',lambda:models.diarize(self.data,self.sr)),
                              ('faster_whisper',lambda:models.transcribe(self.data,self.sr)),
                              ('speechbrain.inference.separation',lambda:models.separate(self.data,self.sr,Path('unused')))]:
            with patch.dict('sys.modules',{'torch':self.torch,module:None}):
                with self.assertRaisesRegex(ValueError,'Setup_AI.cmd'): action()


if __name__=='__main__': unittest.main()
