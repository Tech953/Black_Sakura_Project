"""Loopback-only web interface; no hosted service and no uploaded audio telemetry."""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import secrets
import tempfile
import threading
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import __version__, models, research, offline, portable_import, render_store
from .engine import Studio, identifier, now
from .sdk import VoiceLibrary
from .project_lock import ProjectLock

WEB = Path(__file__).parent / "web"


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "VoiceProfileStudio"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "voice-profile-studio"


class AppServer(ThreadingHTTPServer):
    daemon_threads = False
    def __init__(self, address, studio: Studio):
        self.project_lock = ProjectLock(studio.root)
        self.studio = studio
        self.token = secrets.token_urlsafe(32)
        self.jobs = {}
        self.jobs_lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=1)
        try:
            super().__init__(address, Handler)
        except Exception:
            self.executor.shutdown(wait=True, cancel_futures=True)
            self.project_lock.close()
            raise

    def server_close(self):
        super().server_close()
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.project_lock.close()

    def job(self, kind, body):
        with self.jobs_lock:
            if any(j["status"] in ("queued", "running") for j in self.jobs.values()):
                raise ValueError("A processing task is already running. Wait for it to finish.")
            jid = identifier("job")
            self.jobs[jid] = {"id": jid, "kind": kind, "status": "queued", "created_at": now()}
        def execute():
            with self.jobs_lock:
                self.jobs[jid]["status"] = "running"
            try:
                studio = self.studio
                if kind == "analyze":
                    result = studio.analyze(body["recording_id"], body.get("method", "reference"), body.get("speaker_count"))
                    result = {"recording_id": result["id"], "regions": len(result["segments"])}
                elif kind == "transcribe":
                    result = studio.transcribe(body["recording_id"], body.get("model", "small"), body.get("language"))
                    result = {"recording_id": result["id"], "language": result["transcription"]["language"]}
                elif kind == "separate":
                    result = {"recording_ids": [r["id"] for r in studio.separate(body["recording_id"], body["start"], body["end"])]}
                elif kind == "export":
                    archive = studio.export(body.get("profile_ids"), body.get("encoding", "FLOAT32"), body.get("quality_policy", "high_fidelity"))
                    quality_report = json.loads((archive.with_suffix("") / "quality_report.json").read_text(encoding="utf-8"))
                    result = {"filename": archive.name, "included_count": quality_report["included_count"], "excluded_count": quality_report["excluded_count"]}
                elif kind == "quality":
                    result = studio.audio_quality(body["recording_id"], body.get("start", 0), body.get("end"), body.get("channel"))
                elif kind == "expression":
                    archive = studio.export([body["profile_id"]], body.get("encoding", "FLOAT32"), body.get("quality_policy", "high_fidelity"))
                    library = VoiceLibrary(archive.with_suffix(""))
                    result = library.expression_request(body["profile_id"], body["text"], body.get("style", "neutral"),
                                                        body.get("rate", 1), body.get("pitch", 0), body.get("volume", 0))
                    result["reference_package"] = {"filename": archive.name, "download_path": "/api/exports/" + archive.name,
                                                   "reference_path": result["reference"]["path"]}
                    result["reference"].pop("absolute_path", None)
                elif kind == "render":
                    result = render_store.generate(studio, body)
                elif kind == "rebecca":
                    result = portable_import.restore(studio, WEB.parent.parent / 'examples' / 'Rebecca_Reference.zip')
                elif kind == "research":
                    if offline.enabled():
                        raise ValueError('Offline mode: import a local reference document.')
                    result = research.search_character(body["query"])
                elif kind == "source":
                    result = studio.collect_source(body["profile_id"], body["provider"], body["key"])
                elif kind == "character_draft":
                    result = studio.draft_character(body["profile_id"])
                elif kind == "demo":
                    result = {"recording_ids": [r["id"] for r in studio.demo()]}
                else:
                    raise ValueError("Unknown processing task.")
                with self.jobs_lock:
                    self.jobs[jid].update({"status": "completed", "result": result, "finished_at": now()})
            except (ValueError, KeyError, TypeError) as exc:
                with self.jobs_lock:
                    self.jobs[jid].update({"status": "failed", "error": str(exc), "finished_at": now()})
            except Exception as exc:
                # Keep provider errors and secrets out of user-visible traces.
                with self.jobs_lock:
                    self.jobs[jid].update({"status": "failed", "error": "Processing failed (" + type(exc).__name__ + "). Check the setup and recording format.", "finished_at": now()})
            with self.jobs_lock:
                if len(self.jobs) > 30:
                    oldest = next(iter(self.jobs))
                    if oldest != jid:
                        self.jobs.pop(oldest)
        self.executor.submit(execute)
        with self.jobs_lock:
            return copy.deepcopy(self.jobs[jid])


class Handler(BaseHTTPRequestHandler):
    server: AppServer
    protocol_version = "HTTP/1.1"

    def setup(self):
        self.request.settimeout(30)
        super().setup()

    def log_message(self, fmt, *args):
        # No transcript text, file names, research queries, or tokens in access logs.
        pass

    def _check_origin(self, mutation=False):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            raise PermissionError("Invalid local host.")
        origin = self.headers.get("Origin")
        if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin not in {"http://" + h for h in hosts}):
            raise PermissionError("Only this local app can access the project.")
        if mutation and not secrets.compare_digest(self.headers.get("X-Studio-Token", ""), self.server.token):
            raise PermissionError("Reload the app to refresh the session token.")

    def send_bytes(self, data, content_type="application/json; charset=utf-8", status=200, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def json(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"), status=status)

    def read_body(self, limit):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid request size.") from exc
        if not 0 < size <= limit:
            raise ValueError("The upload is empty or exceeds this action's size limit.")
        self.connection.settimeout(120)
        chunks, remaining = [], size
        while remaining:
            chunk = self.rfile.read(min(1024 * 1024, remaining))
            if not chunk:
                raise ValueError("The upload ended early. Try again.")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def send_file(self, path, content_type, download=False):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        header = self.headers.get("Range", "")
        if header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
            if not match or (not match[1] and not match[2]):
                self.send_bytes(b"", status=416, extra={"Content-Range": f"bytes */{size}"})
                return
            if match[1]:
                start = int(match[1])
                end = min(end, int(match[2])) if match[2] else end
            else:
                start = max(0, size - int(match[2]))
            if start > end or start >= size:
                self.send_bytes(b"", status=416, extra={"Content-Range": f"bytes */{size}"})
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.end_headers()
        with path.open("rb") as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining:
                block = stream.read(min(65536, remaining))
                if not block:
                    break
                self.wfile.write(block)
                remaining -= len(block)

    def do_GET(self):
        try:
            self._check_origin()
            parsed = urlsplit(self.path)
            path, query = parsed.path, parse_qs(parsed.query)
            studio = self.server.studio
            if path == "/":
                html = (WEB / "index.html").read_text(encoding="utf-8").replace("__STUDIO_TOKEN__", self.server.token)
                self.send_bytes(html.encode("utf-8"), "text/html; charset=utf-8")
            elif path in ("/app.js", "/style.css"):
                self.send_file(WEB / path[1:], "text/javascript; charset=utf-8" if path.endswith("js") else "text/css; charset=utf-8")
            elif path in ('/guide', '/quick-start', '/animation'):
                target = WEB.parent.parent / ('examples/Rebecca_60fps_Player.html' if path == '/animation' else 'docs/User_Guide.html' if path == '/guide' else 'docs/Quick_Start.html')
                self.send_file(target, 'text/html; charset=utf-8')
            elif re.fullmatch(r'/api/renders/render_[a-f0-9]{16}/(speech.wav|reference.wav|receipt.json)', path):
                _, _, _, rid, filename = path.split('/')
                target = render_store.directory(studio, rid) / filename
                self.send_file(target, 'audio/wav' if filename.endswith('.wav') else 'application/json', query.get('download', ['0'])[0] == '1')
            elif path == "/api/state":
                with self.server.jobs_lock:
                    jobs = copy.deepcopy(list(self.server.jobs.values()))
                recordings = studio.records()
                for record in recordings:
                    record["transcript_rows"] = studio.transcript_rows(record)
                self.json({"version": __version__, "recordings": recordings, "profiles": studio.profiles(),
                           "capabilities": models.capabilities(), "jobs": jobs, "renders": render_store.receipts(studio)})
            elif path == "/api/source":
                self.json(studio.source_text(query.get("profile_id", [""])[0], query.get("source_id", [""])[0], query.get("q", [""])[0]))
            elif path == "/api/preview":
                channel = query.get("channel", [""])[0]
                self.send_bytes(studio.preview(query.get("recording_id", [""])[0], float(query.get("start", [0])[0]),
                                              float(query.get("end", [0])[0]), int(channel) if channel else None,
                                              query.get("processed", ["0"])[0] == "1"), "audio/wav")
            elif re.fullmatch(r"/api/audio/rec_[a-f0-9]{16}", path):
                self.send_file(studio.record_path(path.rsplit("/", 1)[-1]) / "playback.wav", "audio/wav")
            elif re.fullmatch(r"/api/exports/pack_[a-f0-9]{16}\.zip", path):
                target = studio.exports_dir / path.rsplit("/", 1)[-1]
                if not target.is_file():
                    raise ValueError("Export not found.")
                self.send_file(target, "application/zip", True)
            elif path == "/favicon.ico":
                self.send_bytes(b"", "image/x-icon", 204)
            else:
                self.json({"error": "Route not found."}, 404)
        except PermissionError as exc:
            self.close_connection = True
            self.json({"error": str(exc)}, 403)
        except (ValueError, KeyError, TypeError, FileNotFoundError) as exc:
            self.json({"error": str(exc)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.json({"error": "Request failed (" + type(exc).__name__ + ")."}, 500)

    def do_POST(self):
        try:
            self._check_origin(mutation=True)
            parsed = urlsplit(self.path)
            path, query = parsed.path, parse_qs(parsed.query)
            studio = self.server.studio
            if path == '/api/portable-import':
                with self.server.jobs_lock:
                    if any(j['status'] in ('queued', 'running') for j in self.server.jobs.values()):
                        raise ValueError('Wait for the processing task to finish.')
                    data = self.read_body(512 * 1024 * 1024)
                    with tempfile.TemporaryDirectory(dir=studio.root) as temp:
                        target = Path(temp) / 'upload.zip'
                        target.write_bytes(data)
                        self.json(portable_import.restore(studio, target), 201)
                return
            if path == "/api/import":
                filename = query.get("name", ["audio.wav"])[0]
                suffix = Path(filename).suffix.lower()
                if suffix not in (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".mp4", ".webm", ".aiff", ".aif", ".opus"):
                    raise ValueError("Choose a supported audio file.")
                data = self.read_body(250 * 1024 * 1024)
                with tempfile.TemporaryDirectory(dir=studio.root) as tmp:
                    target = Path(tmp) / ("uploaded" + suffix)
                    target.write_bytes(data)
                    self.json(studio.import_audio(target, filename), 201)
                return
            if path == "/api/source-import":
                data = self.read_body(research.MAX_SOURCE_BYTES)
                self.json(studio.import_source(query.get("profile_id", [""])[0], data,
                                              query.get("name", ["source.txt"])[0]), 201)
                return
            body = json.loads(self.read_body(3 * 1024 * 1024))
            if not isinstance(body, dict):
                raise ValueError("Send a JSON object.")
            if path == '/api/render-review':
                self.json(render_store.review(studio, body['render_id'], body['status'], body.get('notes', '')))
            elif path == "/api/profiles":
                self.json(studio.new_profile(body["name"], body.get("notes", ""), body.get("language", "")), 201)
            elif path == "/api/character":
                self.json(studio.update_character(body["profile_id"], body["character"], body.get("name"), body.get("notes"), body.get("language"), body.get("expected_revision")))
            elif path == "/api/segments":
                self.json(studio.save_segments(body["recording_id"], body["segments"], body.get("expected_revision")))
            elif path == "/api/audio-settings":
                self.json(studio.save_audio_settings(body["recording_id"], body["settings"], body.get("expected_revision")))
            elif path == "/api/bind":
                self.json(studio.bind(body["recording_id"], body["speaker"], body.get("profile_id"), body.get("expected_revision")))
            elif path == "/api/jobs":
                self.json(self.server.job(body["kind"], body), 202)
            else:
                self.json({"error": "Route not found."}, 404)
        except PermissionError as exc:
            self.close_connection = True
            self.json({"error": str(exc)}, 403)
        except (ValueError, KeyError, TypeError) as exc:
            self.close_connection = True
            self.json({"error": str(exc)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.close_connection = True
            self.json({"error": "Request failed (" + type(exc).__name__ + ")."}, 500)


def serve(root: Path, port: int = 8765, open_browser: bool = True):
    studio = Studio(root)
    try:
        server = AppServer(("127.0.0.1", port), studio)
    except OSError as exc:
        raise ValueError(f"Port {port} is in use. Close the other app or launch with --port 0.") from exc
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"FULL_REZZ {__version__}\nOpen {url}\nProject data: {studio.root}\nKeep this window open. Press Ctrl+C to stop.", flush=True)
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping FULL_REZZ…", flush=True)
    finally:
        server.shutdown()
        server.server_close()
        server.executor.shutdown(wait=False, cancel_futures=True)
