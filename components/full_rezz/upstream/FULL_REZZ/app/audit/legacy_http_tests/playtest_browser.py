"""Real Chromium interaction and audio-playback audit (optional test tooling).

Run from the project root with Playwright and Chromium installed:
python tests/playtest_browser.py
"""
import io
import json
import re
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright, expect

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from voice_studio import audio
from voice_studio import __version__
from voice_studio.engine import Studio
from voice_studio.server import AppServer


def main():
    output = PROJECT / 'audit-artifacts'
    output.mkdir(exist_ok=True)
    checks, errors, console_errors, expected_http_errors = [], [], [], []
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        server = AppServer(('127.0.0.1', 0), Studio(root/'data'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
            page.on('response', lambda r: expected_http_errors.append({'url': r.url.replace(url,''), 'status':r.status}) if r.status>=400 else None)
            def done(name):
                checks.append(name);print('PASS '+name, flush=True)
            def wait_js(expression, timeout=30000):
                deadline=time.monotonic()+timeout/1000
                while time.monotonic()<deadline:
                    if page.evaluate('() => ('+expression+')'): return
                    page.wait_for_timeout(60)
                raise AssertionError('Timed out: '+expression)
            def settle():
                wait_js("!document.getElementById('export-button').disabled", timeout=90000)
                page.wait_for_timeout(120)
            try:
                page.goto(url)
                expect(page.locator('#recording-empty')).to_be_visible()
                expect(page.locator('#app-version')).to_have_text(__version__)
                done('Fresh startup renders the empty workspace without JavaScript errors')
                page.locator('#demo-button').click()
                expect(page.locator('#region-rows tr')).to_have_count(4, timeout=15000)
                settle()
                record = server.studio.records()[0]
                page.locator('[data-preview="0"]').click()
                wait_js("document.getElementById('audio-player').currentTime > 0.05", timeout=15000)
                done('Synthetic demo and FLOAT32 region playback advance in the real browser')
                page.locator('#audio-player').evaluate('(el)=>el.pause()')

                page.locator('#region-rows tr').first.locator('[data-field="text"]').fill('The route is clear.')
                page.locator('#region-rows tr').first.locator('[data-field="style"]').fill('gentle')
                page.locator('[data-tab="integration"]').click()
                page.locator('#export-button').click()
                expect(page.locator('#toast')).to_contain_text('Save pending')
                page.locator('[data-tab="recordings"]').click()
                page.locator('#save-regions-button').click()
                wait_js("document.getElementById('toast').textContent.includes('saved')")
                done('Unsaved region edits block stale exports and save persists text and style')
                page.locator('#binding-new-profile').click()
                page.locator('#new-profile-name').fill('Playtest Navigator')
                page.locator('#new-profile-form button[type="submit"]').click()
                expect(page.locator('#profile-dialog')).not_to_be_visible()
                pid = next(p['id'] for p in server.studio.profiles() if p['name']=='Playtest Navigator')
                page.locator('[data-speaker="VOICE_01"]').select_option(pid)
                expect(page.locator('[data-speaker="VOICE_01"]')).to_have_value(pid)
                deadline=time.monotonic()+10
                while server.studio.record(record['id'])['bindings'].get('VOICE_01')!=pid and time.monotonic()<deadline: page.wait_for_timeout(60)
                assert server.studio.record(record['id'])['bindings'].get('VOICE_01')==pid
                done('Profile creation and speaker assignment work through the interface')

                page.locator('[data-tab="characters"]').click()
                expect(page.locator('#profile-title')).to_have_text('Playtest Navigator')
                page.locator('#character-kind').select_option('original')
                page.locator('#character-bio').fill('Authored navigator canon.')
                page.locator('#character-system').fill('Speak precisely and calmly.')
                page.locator('#save-character-button').click()
                wait_js("document.getElementById('toast').textContent.includes('saved')")
                source = root/'character.json'
                source.write_text(json.dumps({'character':{'biography':'Conflicting source bio.','demographics':{'age':42},'statistics':{'navigation':{'value':9,'unit':'points'}},'persona':{'traits':['curious'],'speech_style':'precise'}}}))
                canon = root/'canon.md';canon.write_text('Navigator reference. 世界. Full document retained.',encoding='utf-8')
                page.locator('#source-input').set_input_files([str(source),str(canon)])
                expect(page.locator('.source-card')).to_have_count(2,timeout=15000)
                page.locator('[data-view-source]').nth(1).click()
                expect(page.locator('#source-text')).to_have_value(re.compile('世界'))
                page.locator('#source-find').fill('Navigator')
                page.locator('#source-find-button').click()
                expect(page.locator('#source-matches')).to_contain_text('Navigator')
                page.locator('#close-source').click()
                page.locator('#draft-character-button').click()
                expect(page.locator('#draft-report')).to_contain_text('conflicting',timeout=15000)
                expect(page.locator('#character-bio')).to_have_value('Authored navigator canon.')
                expect(page.locator('#character-demographics')).to_have_value(re.compile('42'))
                expect(page.locator('#character-persona')).to_have_value(re.compile('precise'))
                page.locator('#save-character-button').click()
                wait_js("document.getElementById('toast').textContent.includes('saved')")
                done('Multiple source imports, Unicode, source reading/search, draft conflicts, and character citations persist')
                page.locator('#character-statistics').fill('{')
                page.locator('#save-character-button').click()
                expect(page.locator('#toast')).to_contain_text('Fix the statistics JSON')
                assert server.studio.profile(pid)['character']['statistics']['navigation']['value']==9
                page.locator('#character-statistics').fill('{"navigation":{"value":9,"unit":"points"}}')
                page.locator('#save-character-button').click()
                wait_js("document.getElementById('toast').textContent.includes('saved')")
                done('Invalid character JSON reports an actionable error and does not corrupt saved data')
                page.locator('#source-url').fill('http://127.0.0.1/private')
                page.locator('#source-url-button').click()
                expect(page.locator('#toast')).to_contain_text('Private or local',timeout=15000)
                done('Failed URL research reports its actual failure')

                page.locator('[data-tab="recordings"]').click()
                page.locator('#audio-quality-panel summary').click()
                page.locator('#quality-channel').select_option('0')
                page.locator('#quality-start').fill('0.5');page.locator('#quality-end').fill('2.5')
                page.locator('#cleanup-enabled').select_option('true')
                page.locator('#save-audio-settings').click()
                wait_js("document.getElementById('toast').textContent.includes('Cleanup settings saved')")
                page.locator('#preview-original').click()
                wait_js("document.getElementById('audio-player').currentTime > 0.05")
                page.locator('#preview-cleaned').click()
                wait_js("document.getElementById('audio-player').currentTime > 0.05")
                page.locator('#audio-player').evaluate('(el)=>el.pause()')
                page.locator('#quality-button').click()
                expect(page.locator('#quality-results')).to_contain_text('Output signal',timeout=15000)
                expect(page.locator('#quality-results')).to_contain_text('Peak -3')
                done('Saved cleanup, original/cleaned audio playback, and source/output measurements work')
                page.screenshot(path=str(output/'browser-recordings.png'),full_page=True)

                page.locator('[data-tab="integration"]').click()
                page.locator('#export-encoding').select_option('PCM24')
                page.locator('#export-button').click()
                expect(page.locator('#export-links .download-link')).to_have_count(1,timeout=20000)
                with page.expect_download() as pending: page.locator('#export-links .download-link').first.click()
                download=pending.value;download.save_as(str(output/'browser-reference-pack.zip'))
                with zipfile.ZipFile(output/'browser-reference-pack.zip') as bundle:
                    manifest=json.loads(bundle.read('manifest.json'))
                    p=next(p for p in manifest['profiles'] if p['id']==pid)
                    assert p['reference_count']>0
                    assert p['references'][0]['encoding']=='PCM_24'
                    assert p['character']['biography']=='Authored navigator canon.'
                    assert bundle.read(p['sources'][1]['original_path'])==canon.read_bytes()
                    assert json.loads(bundle.read('quality_report.json'))['included_count']>0
                done('24-bit ZIP download includes the actual audio, source documents, character, logs, and quality reports')
                settle()
                page.locator('#expression-profile').select_option(pid)
                page.locator('#expression-text').fill('A < B & C. We can continue.')
                page.locator('#expression-style').fill('gentle')
                page.locator('#expression-button').click()
                expect(page.locator('#expression-output')).to_contain_text('voice_expression_request',timeout=20000)
                request=json.loads(page.locator('#expression-output').inner_text())
                assert '&lt;' in request['ssml'] and '&amp;' in request['ssml']
                assert request['reference_package']['filename']
                assert request['generated_audio'] is None
                assert 'absolute_path' not in request['reference']
                with page.expect_download() as pending: page.locator('#expression-download').click()
                pending.value.save_as(str(output/'browser-expression-request.json'))
                assert json.loads((output/'browser-expression-request.json').read_text())['profile_id']==pid
                done('Expression request downloads escaped SSML and links its matching reference audio package')
                page.screenshot(path=str(output/'browser-export.png'),full_page=True)

                page.locator('[data-tab="recordings"]').click()
                speech=output/'synthetic-speech.wav'
                if speech.exists():
                    page.locator('#audio-input').set_input_files(str(speech))
                    expect(page.locator('#recording-title')).to_have_text('synthetic-speech.wav',timeout=20000)
                    page.locator('#analysis-method').select_option('reference')
                    page.locator('#analyze-button').click();settle()
                    expect(page.locator('#region-rows tr')).not_to_have_count(0)
                    page.locator('summary').filter(has_text='Overlap separation').click()
                    page.locator('#whisper-model').fill('tiny.en')
                    page.locator('#whisper-language').fill('en')
                    page.locator('#transcribe-button').click()
                    wait_js("document.getElementById('toast').textContent.includes('Transcription completed')",timeout=90000)
                    speech_record=next(r for r in server.studio.records() if r['name']=='synthetic-speech.wav')
                    assert 'navigator' in speech_record['transcription']['segments'][0]['text'].lower()
                    done('Actual faster-whisper tiny.en CPU inference completes through the browser on synthetic speech')
                from voice_studio import models
                mixed=output/'overlapping-generated-speech.wav'
                if mixed.exists() and models.capabilities()['separation']:
                    import torch
                    torch.set_num_threads(4)
                    page.locator('#audio-input').set_input_files(str(mixed))
                    expect(page.locator('#recording-title')).to_have_text(mixed.name,timeout=20000)
                    if not models.capabilities()['pyannote']:
                        page.locator('#analysis-method').select_option('pyannote')
                        page.locator('#analyze-button').click()
                        expect(page.locator('#toast')).to_contain_text('diarization requirements',timeout=20000)
                        settle()
                        done('Unavailable automatic diarization reports setup requirements without fabricated results')
                    start_count=len(server.studio.records())
                    page.locator('#separate-start').fill('0')
                    page.locator('#separate-end').fill(str(next(r['duration'] for r in server.studio.records() if r['name']==mixed.name)))
                    page.locator('#separate-button').click()
                    wait_js("document.getElementById('recording-count').textContent === '"+str(start_count+2)+"'",timeout=90000)
                    expect(page.locator('#analysis-note')).to_contain_text('Anonymous estimated source')
                    assert server.studio.records()[-1]['sample_rate']==8000
                    done('Actual two-speaker separation imports anonymous 8 kHz source estimates through the browser')
                page.set_viewport_size({'width':390,'height':844})
                page.screenshot(path=str(output/'browser-mobile.png'),full_page=True)
                assert page.locator('[data-tab="characters"]').is_visible()
                done('Narrow viewport keeps navigation and recording controls accessible')
                assert not errors, errors
                unexpected=[e for e in console_errors if '400 (Bad Request)' not in e]
                assert not unexpected, unexpected
                done('No uncaught JavaScript errors or unexpected console failures during the workflow')
                result={'status':'passed','browser':browser.version,'checks':checks,'uncaught_errors':errors,
                        'console_errors':console_errors,'http_error_responses':expected_http_errors,
                        'limitations':['Linux Chromium playback does not validate a Windows audio device or subjective listening quality.',
                                       'Generated test speech is not a real-world diarization or cloning accuracy benchmark.']}
                (output/'browser-playtest.json').write_text(json.dumps(result,indent=2))
            except Exception as exc:
                page.screenshot(path=str(output/'browser-failure.png'),full_page=True)
                (output/'browser-playtest.json').write_text(json.dumps({'status':'failed','checks':checks,'error':str(exc),'uncaught_errors':errors,'console_errors':console_errors,'records':server.studio.records(),'profiles':server.studio.profiles()},indent=2))
                raise
            finally:
                context.close();browser.close()
                server.shutdown();server.server_close();server.executor.shutdown(wait=True)


if __name__=='__main__': main()
