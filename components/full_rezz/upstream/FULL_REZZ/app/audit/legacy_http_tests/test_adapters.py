"""Model API contract checks with fake providers; no weights or neural inference."""
import contextlib
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np

from voice_studio import models


class AdapterContractTests(unittest.TestCase):
    def setUp(self):
        self.sr = 24000
        self.data = np.ones((self.sr, 2), dtype=np.float32) * 0.1

    def pyannote_fixture(self, vector):
        turn = types.SimpleNamespace(start=0.1, end=0.9)
        annotation = MagicMock()
        annotation.itertracks.return_value = [(turn, None, "SPEAKER_00")]
        annotation.labels.return_value = ["SPEAKER_00"]
        output = types.SimpleNamespace(speaker_diarization=annotation,
            exclusive_speaker_diarization=annotation, speaker_embeddings=np.asarray([vector]))
        pipeline = MagicMock(return_value=output)
        provider = types.ModuleType("pyannote.audio")
        provider.Pipeline = types.SimpleNamespace(from_pretrained=MagicMock(return_value=pipeline))
        torch = types.ModuleType("torch")
        torch.Tensor = type("Tensor", (), {})
        torch.from_numpy = lambda x: x
        return provider, torch, pipeline

    def test_diarization_uses_16khz_waveform_and_preserves_embeddings(self):
        provider, torch, pipeline = self.pyannote_fixture([0.1, 0.2])
        with patch.dict("sys.modules", {"pyannote": types.ModuleType("pyannote"), "pyannote.audio": provider, "torch": torch}), patch.dict(os.environ, {"HF_TOKEN": "fixture-secret"}):
            result = models.diarize(self.data, self.sr, count=2)
        waveform = pipeline.call_args.args[0]
        self.assertEqual((1, 16000), waveform["waveform"].shape)
        self.assertEqual(16000, waveform["sample_rate"])
        self.assertEqual(2, pipeline.call_args.kwargs["num_speakers"])
        self.assertEqual([0.1, 0.2], result["embeddings"]["SPEAKER_00"])
        self.assertEqual("fixture-secret", provider.Pipeline.from_pretrained.call_args.kwargs["token"])

    def test_invalid_model_embedding_is_rejected_without_exposing_provider_details(self):
        provider, torch, _ = self.pyannote_fixture([float("nan")])
        with patch.dict("sys.modules", {"pyannote": types.ModuleType("pyannote"), "pyannote.audio": provider, "torch": torch}):
            with self.assertRaisesRegex(ValueError, "Speaker detection failed") as caught:
                models.diarize(self.data, self.sr)
        self.assertIn("Invalid speaker embedding", str(caught.exception.__cause__))

    def test_transcription_contract_uses_cpu_int8_and_word_timestamps(self):
        word = types.SimpleNamespace(start=0.1, end=0.9, word=" Hello", probability=0.8)
        segment = types.SimpleNamespace(start=0.1, end=0.9, text=" Hello", words=[word])
        engine = MagicMock()
        engine.transcribe.return_value = (iter([segment]), types.SimpleNamespace(language="en", language_probability=0.9))
        provider = types.ModuleType("faster_whisper")
        provider.WhisperModel = MagicMock(return_value=engine)
        with patch.dict("sys.modules", {"faster_whisper": provider}):
            result = models.transcribe(self.data, self.sr, model="fixture-model", language="en")
        self.assertEqual("cpu", provider.WhisperModel.call_args.kwargs["device"])
        self.assertEqual("int8", provider.WhisperModel.call_args.kwargs["compute_type"])
        self.assertEqual((16000,), engine.transcribe.call_args.args[0].shape)
        self.assertTrue(engine.transcribe.call_args.kwargs["word_timestamps"])
        self.assertEqual(0.8, result["segments"][0]["words"][0]["probability"])

    def test_separation_contract_keeps_model_caches_separate(self):
        tensor = MagicMock()
        tensor.__getitem__.return_value.detach.return_value.cpu.return_value.numpy.return_value = np.ones((8000, 2), dtype=np.float32) * 0.1
        separator = MagicMock()
        separator.separate_batch.return_value = tensor
        provider = types.ModuleType("speechbrain.inference.separation")
        provider.SepformerSeparation = types.SimpleNamespace(from_hparams=MagicMock(return_value=separator))
        torch = types.ModuleType("torch")
        torch.Tensor = type("Tensor", (), {})
        torch.from_numpy = lambda x: x
        torch.inference_mode = contextlib.nullcontext
        modules = {"speechbrain": types.ModuleType("speechbrain"), "speechbrain.inference": types.ModuleType("speechbrain.inference"), "speechbrain.inference.separation": provider, "torch": torch,
                   "speechbrain.utils": types.ModuleType("speechbrain.utils"),
                   "speechbrain.utils.fetching": types.SimpleNamespace(LocalStrategy=types.SimpleNamespace(COPY="copy"))}
        with tempfile.TemporaryDirectory() as tmp, patch.dict("sys.modules", modules):
            with patch.dict(os.environ, {"VOICE_STUDIO_SEPARATION_MODEL": "fixture/first"}):
                sr, sources = models.separate(self.data, self.sr, Path(tmp))
            first_cache = provider.SepformerSeparation.from_hparams.call_args.kwargs["savedir"]
            with patch.dict(os.environ, {"VOICE_STUDIO_SEPARATION_MODEL": "fixture/second"}):
                models.separate(self.data, self.sr, Path(tmp))
            second_cache = provider.SepformerSeparation.from_hparams.call_args.kwargs["savedir"]
        self.assertEqual(8000, sr)
        self.assertEqual((8000, 2), sources.shape)
        self.assertEqual((1, 8000), separator.separate_batch.call_args.args[0].shape)
        self.assertNotEqual(first_cache, second_cache)


if __name__ == "__main__":
    unittest.main()
