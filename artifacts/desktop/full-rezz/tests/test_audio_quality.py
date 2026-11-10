"""Regression checks against independent signal and file-format properties."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile

from voice_studio import audio, quality
from voice_studio.engine import Studio
from voice_studio.sdk import VoiceLibrary


class AudioQualityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sr = 48000
        self.t = np.arange(self.sr * 3) / self.sr
        self.x = (.2 * np.sin(2 * np.pi * 220 * self.t)).astype(np.float32)

    def tearDown(self):
        self.temp.cleanup()

    def profile_pack(self, x=None, sr=None, encoding='FLOAT32', policy='high_fidelity', processing=None):
        studio = Studio(self.root / 'studio')
        path = self.root / 'input.wav'
        audio.write_audio(path, sr or self.sr, self.x if x is None else x)
        r = studio.import_audio(path)
        p = studio.new_profile('Audio audit')
        studio.save_segments(r['id'], [{'start': 0, 'end': r['duration'], 'speaker': 'A',
                                       'channel': 0, 'purity': 'reviewed_single_voice'}])
        studio.bind(r['id'], 'A', p['id'])
        if processing is not None:
            studio.save_audio_settings(r['id'], processing)
        archive = studio.export(encoding=encoding, quality_policy=policy)
        return studio, r, p, VoiceLibrary(archive.with_suffix(''))

    def test_float32_wav_preserves_every_working_sample(self):
        values = np.random.default_rng(12).uniform(-.4, .4, (50001, 2)).astype(np.float32)
        values[:3, 0] = [1e-9, -1e-9, 0]
        path = self.root / 'float.wav'
        audio.write_audio(path, 96000, values)
        sr, decoded = audio.read_audio(path)
        self.assertEqual(96000, sr)
        np.testing.assert_array_equal(values, decoded)
        self.assertEqual(32, quality.source_format(path)['bits_per_sample'])

    def test_pcm24_error_is_bounded_and_native_rate_retained(self):
        path = self.root / '24.wav'
        audio.write_audio(path, self.sr, self.x, 'PCM24')
        sr, decoded = audio.read_audio(path)
        self.assertEqual(self.sr, sr)
        self.assertEqual(24, quality.source_format(path)['bits_per_sample'])
        self.assertLessEqual(np.max(np.abs(decoded[:, 0] - self.x)), 1.6 / 2 ** 23)

    def test_pcm16_signed_full_scale_and_reproducible_dither(self):
        x = np.array([-1, 1, 0, -.5, .5], dtype=np.float32)
        a, b = self.root / 'a.wav', self.root / 'b.wav'
        audio.write_audio(a, self.sr, x, 'PCM16')
        audio.write_audio(b, self.sr, x, 'PCM16')
        self.assertEqual(a.read_bytes(), b.read_bytes())
        _, decoded = audio.read_audio(a)
        self.assertEqual(-1, decoded[0, 0])
        self.assertEqual(32767 / 32768, decoded[1, 0])
        self.assertLessEqual(np.max(np.abs(x - decoded[:, 0])), 1.6 / 32768)

    def test_integer_encoding_refuses_silent_over_range_clipping(self):
        x = np.array([0, 1.2, -1.1], np.float32)
        for fmt in ('PCM16', 'PCM24'):
            with self.assertRaisesRegex(ValueError, 'over-range'):
                audio.write_audio(self.root / 'over.wav', self.sr, x, fmt)
        audio.write_audio(self.root / 'float.wav', self.sr, x)
        np.testing.assert_array_equal(x, audio.read_audio(self.root / 'float.wav')[1][:, 0])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg needed for alternate decoder checks')
    def test_pyav_and_ffmpeg_keep_96khz_and_high_frequency_detail(self):
        sr = 96000
        t = np.arange(sr) / sr
        x = (.2 * np.sin(2 * np.pi * 30000 * t)).astype(np.float32)
        source, flac = self.root / '96.wav', self.root / '96.flac'
        audio.write_audio(source, sr, x, 'PCM24')
        subprocess.run([shutil.which('ffmpeg'), '-v', 'error', '-i', str(source), '-c:a', 'flac', '-y', str(flac)], check=True)
        native = audio.read_audio(source)[1]
        pyav_sr, pyav = audio.read_audio(flac)
        with patch.dict(sys.modules, {'av': None}):
            ff_sr, fallback = audio.read_audio(flac)
        self.assertEqual((sr, sr), (pyav_sr, ff_sr))
        np.testing.assert_array_equal(native, pyav)
        np.testing.assert_array_equal(native, fallback)
        self.assertAlmostEqual(-16.9897, audio.acoustics(fallback, sr)['rms_dbfs'], delta=.01)

    def test_default_export_is_bit_exact_and_reports_actual_wav(self):
        _, _, p, pack = self.profile_pack()
        ref = pack.reference(p['id'])
        sr, exported = audio.read_audio(Path(ref['absolute_path']))
        np.testing.assert_array_equal(self.x, exported[:, 0])
        self.assertEqual('FLOAT_32', ref['encoding'])
        self.assertEqual(audio.acoustics(exported, sr), ref['measurements'])
        self.assertEqual(quality.inspect(exported, sr), ref['quality'])

    def test_compatibility_exports_report_delivered_quantized_samples(self):
        _, _, p, pack = self.profile_pack(encoding='PCM24')
        ref = pack.reference(p['id'])
        sr, exported = audio.read_audio(Path(ref['absolute_path']))
        self.assertEqual('PCM_24', ref['encoding'])
        self.assertEqual(audio.acoustics(exported, sr), ref['measurements'])
        self.assertEqual(quality.inspect(exported, sr), ref['quality'])

    def test_silence_and_dc_only_are_excluded_even_after_gain(self):
        for x in (np.zeros(self.sr, np.float32), np.full(self.sr, .2, np.float32)):
            with tempfile.TemporaryDirectory() as other:
                old = self.root; self.root = Path(other)
                try:
                    _, _, p, pack = self.profile_pack(x=x, processing={'enabled': True})
                    self.assertEqual(0, pack.profile(p['id'])['reference_count'])
                    report = json.loads((pack.root / 'quality_report.json').read_text())
                    self.assertEqual('no_useful_signal', report['clips'][0]['exclusion_reasons'][0]['code'])
                finally: self.root = old

    def test_gain_reduction_does_not_hide_source_clipping(self):
        clipped = np.clip(self.x * 8, -1, 1)
        _, _, p, pack = self.profile_pack(x=clipped, processing={'enabled': True})
        self.assertEqual(0, pack.profile(p['id'])['reference_count'])
        report = json.loads((pack.root / 'quality_report.json').read_text())
        self.assertIn('clipping', [q['code'] for q in report['clips'][0]['exclusion_reasons']])
        self.assertLess(report['clips'][0]['output_quality']['peak_dbfs'], -2.9)

    def test_unclipped_float_over_range_is_recoverable_with_headroom_cleanup(self):
        # Smooth model-like float estimates retain their waveform above 1.0;
        # they are not the flat, full-scale plateaus in the clipping test.
        over_range = (self.x * 40).astype(np.float32)
        inspection = quality.inspect(over_range, self.sr)
        codes = [q['code'] for q in inspection['issues']]
        self.assertIn('over_range', codes)
        self.assertNotIn('clipping', codes)
        studio, record, profile, raw_pack = self.profile_pack(x=over_range)
        self.assertEqual(0, raw_pack.profile(profile['id'])['reference_count'])
        before = studio.samples(record['id'])[1].copy()
        original_hash = hashlib.sha256((studio.record_path(record['id']) / 'original.wav').read_bytes()).hexdigest()
        studio.save_audio_settings(record['id'], {'enabled': True})
        cleaned = VoiceLibrary(studio.export(encoding='PCM24').with_suffix(''))
        self.assertEqual(1, cleaned.profile(profile['id'])['reference_count'])
        ref = cleaned.reference(profile['id'])
        self.assertAlmostEqual(-3, ref['quality']['peak_dbfs'], places=3)
        self.assertEqual(0, ref['quality']['over_range_fraction'])
        np.testing.assert_array_equal(before, studio.samples(record['id'])[1])
        self.assertEqual(original_hash, hashlib.sha256((studio.record_path(record['id']) / 'original.wav').read_bytes()).hexdigest())

    def test_low_rate_requires_explicit_standard_screening(self):
        x = (.2 * np.sin(2 * np.pi * 220 * np.arange(8000) / 8000)).astype(np.float32)
        studio, _, p, pack = self.profile_pack(x=x, sr=8000)
        self.assertEqual(0, pack.profile(p['id'])['reference_count'])
        standard = VoiceLibrary(studio.export(quality_policy='standard').with_suffix(''))
        self.assertEqual(1, standard.profile(p['id'])['reference_count'])
        self.assertIn('limited_bandwidth', [q['code'] for q in standard.reference(p['id'])['quality']['issues']])

    def test_disabled_cleanup_is_exact(self):
        y, result = quality.condition(self.x, self.sr, dict(quality.DEFAULT_PROCESSING))
        np.testing.assert_array_equal(self.x, y)
        self.assertEqual([], result['steps'])

    def test_cleanup_removes_dc_fades_boundaries_and_keeps_headroom(self):
        x = self.x + .07
        s = quality.validate_processing({'enabled': True}, 3)
        y, r = quality.condition(x, self.sr, s)
        self.assertEqual(len(x), len(y))
        self.assertEqual((0, 0), (y[0], y[-1]))
        self.assertLess(abs(y.mean()), .001)
        self.assertAlmostEqual(-3, r['output_quality']['peak_dbfs'], places=3)
        self.assertEqual(0, r['output_quality']['over_range_fraction'])

    def test_rumble_filter_attenuates_20hz_and_preserves_voice_harmonic(self):
        x = self.x + .1 * np.sin(2 * np.pi * 20 * self.t)
        s = quality.validate_processing({'enabled': True, 'remove_dc': False, 'fade_ms': 0, 'highpass_hz': 50}, 3)
        y, r = quality.condition(x, self.sr, s)
        gain = 10 ** (r['gain_db'] / 20)
        window = (self.t > .2) & (self.t < 2.8)
        def amp(x, f): return abs(2 * np.mean(x[window] * np.exp(-2j * np.pi * f * self.t[window])))
        attenuation = 20 * np.log10(amp(y, 20) / gain / amp(x, 20))
        voice = 20 * np.log10(amp(y, 220) / gain / amp(x, 220))
        self.assertLess(attenuation, -25)
        self.assertLess(abs(voice), .15)

    def test_selected_noise_profile_reduces_noise_without_losing_length(self):
        noise = np.random.default_rng(25).normal(0, .02, len(self.t)).astype(np.float32)
        x = (.15 * np.sin(2 * np.pi * 220 * self.t) * (self.t > .8) + noise + .025).astype(np.float32)
        s = quality.validate_processing({'enabled': True, 'denoise_db': 9, 'noise_start': .1, 'noise_end': .6}, 3)
        y, r = quality.condition(x, self.sr, s, x[int(.1*self.sr):int(.6*self.sr)])
        gain = 10 ** (r['gain_db'] / 20)
        span = slice(int(.2*self.sr), int(.6*self.sr))
        self.assertLess(20*np.log10(np.std(y[span])/gain/np.std(x[span])), -5)
        self.assertEqual(len(x), len(y))
        self.assertTrue(np.isfinite(y).all())

    def test_invalid_noise_ranges_and_nan_settings_are_rejected(self):
        for v in [{'enabled': 'yes'}, {'highpass_hz': float('nan')}, {'denoise_db': 13},
                  {'denoise_db': 6}, {'denoise_db': 6, 'noise_start': -1, 'noise_end': .5},
                  {'denoise_db': 6, 'noise_start': 0, 'noise_end': 9}, {'highpass_hz': True},
                  {'denoise_db': 6, 'noise_start': False, 'noise_end': .5}]:
            with self.assertRaises(ValueError): quality.validate_processing(v, 3)

    def test_screening_checks_quantization_induced_full_scale_runs(self):
        hot = self.x.copy()
        hot[10::20] = .99996
        hot[11::20] = .99996
        self.assertNotIn('clipping', [q['code'] for q in quality.inspect(hot, self.sr)['issues']])
        _, _, profile, pack = self.profile_pack(x=hot, encoding='PCM16')
        self.assertEqual(0, pack.profile(profile['id'])['reference_count'])
        report = json.loads((pack.root / 'quality_report.json').read_text())
        self.assertEqual(0, report['included_count'])
        self.assertIn('clipping', [q['code'] for q in report['clips'][0]['exclusion_reasons']])
        self.assertEqual([], list((pack.root / 'clips').glob('*.wav')))

    def test_noise_floor_is_unknown_without_a_quiet_baseline(self):
        report = quality.inspect(self.x, self.sr)
        self.assertFalse(report['noise_estimate_available'])
        self.assertIsNone(report['estimated_snr_db'])

    def test_phase_cancelling_stereo_stays_visible_and_is_not_a_reference(self):
        stereo = np.stack([self.x, -self.x], axis=1)
        self.assertGreater(max(audio.waveform(stereo)), .1)
        self.assertEqual('reject', quality.inspect(audio.mono(stereo), self.sr)['status'])

    def test_processing_does_not_change_original_or_decoded_audio(self):
        studio, r, p, pack = self.profile_pack(processing={'enabled': True})
        directory = studio.record_path(r['id'])
        self.assertEqual(r['original_sha256'], hashlib.sha256((directory/r['original_file']).read_bytes()).hexdigest())
        np.testing.assert_array_equal(self.x, studio.samples(r['id'])[1][:, 0])
        ref = pack.reference(p['id'])
        self.assertTrue(ref['processing']['enabled'])
        self.assertEqual((0, len(self.x)), (ref['source_sample_start'], ref['source_sample_end']))

    def test_changed_reference_checksum_is_detected(self):
        _, _, p, pack = self.profile_pack()
        ref = pack.reference(p['id'])
        path = Path(ref['absolute_path']);path.write_bytes(path.read_bytes()+b'tamper')
        with self.assertRaisesRegex(ValueError, 'checksum'): pack.reference(p['id'])

    def test_preview_retains_native_precision_and_rejects_empty_samples(self):
        studio, r, _, _ = self.profile_pack()
        import io
        sr, raw = wavfile.read(io.BytesIO(studio.preview(r['id'], .1, .2, 0)))
        self.assertEqual(self.sr, sr)
        np.testing.assert_array_equal(self.x[4800:9600], raw)
        with self.assertRaisesRegex(ValueError, 'sample'): studio.preview(r['id'], 0, 1e-8, 0)
        with self.assertRaises(ValueError): studio.preview(r['id'], 0, 1, True)

    def test_expression_rejects_nonfinite_and_boolean_prosody(self):
        _, _, p, pack = self.profile_pack()
        for rate in (float('nan'), float('inf'), True, 'fast'):
            with self.assertRaises(ValueError): pack.expression_request(p['id'], 'Hello', rate=rate)

    def test_cli_quality_cleanup_and_pcm24_export(self):
        studio, r, _, _ = self.profile_pack()
        base = [sys.executable, '-m', 'voice_studio', '--data-dir', str(studio.root)]
        check = subprocess.run(base+['quality', r['id'], '--channel', '0'], capture_output=True, text=True)
        self.assertEqual(0, check.returncode, check.stderr)
        self.assertEqual(self.sr, json.loads(check.stdout)['source_quality']['sample_rate_hz'])
        settings = self.root/'cleanup.json';settings.write_text('{"enabled":true}')
        self.assertEqual(0, subprocess.run(base+['cleanup', r['id'], str(settings)], capture_output=True).returncode)
        result = subprocess.run(base+['export', '--encoding', 'PCM24'], capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
        pack = VoiceLibrary(Path(result.stdout.strip()).with_suffix(''))
        self.assertEqual('PCM_24', pack.manifest['profiles'][0]['references'][0]['encoding'])


if __name__ == '__main__': unittest.main()
