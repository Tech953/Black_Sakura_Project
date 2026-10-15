"""Atomic, provenance-preserving chat imports and durable per-character memory."""
from __future__ import annotations
import base64, csv, hashlib, io, json, re, sqlite3, uuid
from datetime import datetime, timezone
from pathlib import Path

MAX_IMPORT_BYTES = 128 * 1024 * 1024
MAX_MESSAGES = 100_000
MAX_MESSAGE_BYTES = 1024 * 1024
ROLES = {"user", "assistant", "system", "tool"}

def now():
    return datetime.now(timezone.utc).isoformat()

def text_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)

def parse_history(data, filename, mapping=None):
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_IMPORT_BYTES:
        raise ValueError("Choose a nonempty chat log of at most 128 MiB.")
    text = data.decode("utf-8-sig", errors="strict")
    suffix = Path(filename).suffix.lower(); mapping = mapping or {}
    if suffix in (".json", ".jsonl"):
        value = [json.loads(line) for line in text.splitlines() if line.strip()] if suffix == ".jsonl" else json.loads(text)
        rows = value.get("messages", value.get("transcript")) if isinstance(value, dict) else value
        if not isinstance(rows, list):
            raise ValueError("JSON must contain a messages array or be an array of messages.")
    elif suffix == ".csv":
        if not mapping.get("role") or not mapping.get("content"):
            raise ValueError("CSV import needs explicit role and content column mappings.")
        rows = list(csv.DictReader(io.StringIO(text)))
    elif suffix in (".txt", ".md"):
        speakers = mapping.get("speakers")
        if not isinstance(speakers, dict) or not speakers or any(v not in ROLES for v in speakers.values()):
            raise ValueError("Text import needs a reviewed speaker-label mapping.")
        rows = []; current = None
        for line in text.splitlines(keepends=True):
            match = re.match(r"^([^:\n]{1,100}):[ \t]?(.*)", line)
            if match and match[1] in speakers:
                if current: rows.append(current)
                current = {"role": speakers[match[1]], "content": match[2] + ("\n" if line.endswith("\n") else ""), "speaker": match[1]}
            elif current: current["content"] += line
            elif line.strip(): raise ValueError("Unmapped text before the first speaker label.")
        if current: rows.append(current)
    else: raise ValueError("Choose JSON, JSONL, mapped CSV or reviewed TXT/MD.")
    if not 1 <= len(rows) <= MAX_MESSAGES:
        raise ValueError("A log must contain 1–100,000 messages; no messages were imported.")
    parsed = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict): raise ValueError(f"Message {index + 1} must be an object.")
        role = row.get(mapping.get("role", "role")); role = mapping.get("role_values", {}).get(role, role)
        content = row.get(mapping.get("content", "content"), row.get("text"))
        if role not in ROLES or not isinstance(content, str) or not content.strip() or len(content.encode("utf-8")) > MAX_MESSAGE_BYTES:
            raise ValueError(f"Message {index + 1} needs a supported role and nonempty text of at most 1 MiB.")
        source_id = str(row.get(mapping.get("id", "id"), row.get("msg_idx", index)))
        if len(source_id) > 2048: raise ValueError("Message identifier exceeds the limit.")
        parsed.append({"role": role, "content": content, "source_id": source_id,
                       "source_index": index, "timestamp": row.get(mapping.get("timestamp", "timestamp")), "original": row})
    return parsed

class HistoryStore:
    def __init__(self, root, initialize=True):
        self.root = Path(root).resolve()
        self.path = self.root / "companion" / "history.sqlite3"
        if not initialize:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS imports (
              id TEXT PRIMARY KEY, character_id TEXT NOT NULL, source_sha256 TEXT NOT NULL,
              filename TEXT NOT NULL, created_at TEXT NOT NULL, original BLOB NOT NULL,
              mapping TEXT NOT NULL, count INTEGER NOT NULL, UNIQUE(character_id, source_sha256));
            CREATE TABLE IF NOT EXISTS messages (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL,
              message_id TEXT NOT NULL UNIQUE, role TEXT NOT NULL, content TEXT NOT NULL,
              timestamp TEXT, provenance TEXT NOT NULL, imported INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS by_character ON messages(character_id, sequence);
            CREATE TABLE IF NOT EXISTS turns (
              id TEXT PRIMARY KEY, character_id TEXT NOT NULL, status TEXT NOT NULL,
              receipt TEXT NOT NULL, created_at TEXT NOT NULL);
            ''')
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30); db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=DELETE"); db.execute("PRAGMA foreign_keys=ON")
        return db
    @staticmethod
    def valid_id(character_id):
        if not isinstance(character_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", character_id):
            raise ValueError("Invalid character binding.")
    def import_log(self, character_id, data, filename, mapping=None):
        self.valid_id(character_id); rows = parse_history(data, filename, mapping)
        sha = hashlib.sha256(data).hexdigest(); import_id = "import_" + uuid.uuid4().hex
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT id,count FROM imports WHERE character_id=? AND source_sha256=?", (character_id, sha)).fetchone()
            if previous: return {"import_id": previous["id"], "message_count": previous["count"], "source_sha256": sha, "already_imported": True}
            db.execute("INSERT INTO imports VALUES (?,?,?,?,?,?,?,?)", (import_id, character_id, sha, Path(filename).name, now(), data, text_json(mapping or {}), len(rows)))
            for row in rows:
                provenance = {"import_id": import_id, "source_sha256": sha, "source_message_id": row["source_id"],
                              "source_span": {"message_index": row["source_index"]}, "original_fields": row["original"], "is_executable_policy": False}
                db.execute("INSERT INTO messages(character_id,message_id,role,content,timestamp,provenance,imported) VALUES(?,?,?,?,?,?,1)",
                           (character_id, f"{import_id}:{row['source_index']}", row["role"], row["content"], text_json(row["timestamp"]), text_json(provenance)))
        return {"import_id": import_id, "message_count": len(rows), "source_sha256": sha, "already_imported": False}
    def preview_import(self, character_id, data, filename, mapping=None):
        self.valid_id(character_id); rows = parse_history(data, filename, mapping)
        sha = hashlib.sha256(data).hexdigest()
        previous = None
        if self.path.is_file():
            try:
                with sqlite3.connect(self.path.as_uri() + "?mode=ro", uri=True) as db:
                    db.row_factory = sqlite3.Row
                    previous = db.execute(
                        "SELECT id,count FROM imports WHERE character_id=? AND source_sha256=?",
                        (character_id, sha),
                    ).fetchone()
            except sqlite3.OperationalError:
                previous = None
        roles = {}
        for row in rows:
            roles[row["role"]] = roles.get(row["role"], 0) + 1
        return {
            "profile_id": character_id,
            "filename": Path(filename).name,
            "source_sha256": sha,
            "message_count": len(rows),
            "role_counts": roles,
            "already_imported": previous is not None,
            "sample": [
                {"role": row["role"], "content": row["content"][:240]}
                for row in rows[:3]
            ],
        }
    def imports(self, character_id):
        self.valid_id(character_id)
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,source_sha256,filename,created_at,mapping,count "
                "FROM imports WHERE character_id=? ORDER BY created_at,id",
                (character_id,),
            ).fetchall()
        return [
            {
                "import_id": row["id"],
                "source_sha256": row["source_sha256"],
                "filename": row["filename"],
                "created_at": row["created_at"],
                "mapping": json.loads(row["mapping"]),
                "message_count": row["count"],
            }
            for row in rows
        ]
    def rollback_import(self, character_id, import_id):
        self.valid_id(character_id)
        if not isinstance(import_id, str) or not re.fullmatch(r"import_[a-f0-9]{32}", import_id):
            raise ValueError("Invalid history import ID.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            imported = db.execute(
                "SELECT source_sha256,count FROM imports WHERE id=? AND character_id=?",
                (import_id, character_id),
            ).fetchone()
            if imported is None:
                return {"rolled_back": False, "import_id": import_id, "removed_message_count": 0}
            rows = db.execute(
                "SELECT message_id,provenance FROM messages WHERE character_id=? AND imported=1",
                (character_id,),
            ).fetchall()
            message_ids = [
                row["message_id"]
                for row in rows
                if json.loads(row["provenance"]).get("import_id") == import_id
            ]
            db.executemany(
                "DELETE FROM messages WHERE character_id=? AND message_id=? AND imported=1",
                [(character_id, message_id) for message_id in message_ids],
            )
            for turn in db.execute(
                "SELECT id,receipt FROM turns WHERE character_id=?",
                (character_id,),
            ).fetchall():
                receipt = json.loads(turn["receipt"])
                excerpts = receipt.get("context_excerpts")
                if not isinstance(excerpts, list):
                    continue
                retained = [
                    item for item in excerpts
                    if not isinstance(item, dict) or item.get("import_id") != import_id
                ]
                if len(retained) == len(excerpts):
                    continue
                receipt["context_excerpts"] = retained
                receipt["context_message_ids"] = [
                    item.get("message_id") for item in retained if isinstance(item, dict)
                ]
                receipt["truncated_message_ids"] = [
                    item.get("message_id")
                    for item in retained
                    if isinstance(item, dict) and item.get("context_excerpt_truncated")
                ]
                receipt.setdefault("rolled_back_import_ids", []).append(import_id)
                db.execute(
                    "UPDATE turns SET receipt=? WHERE id=? AND character_id=?",
                    (text_json(receipt), turn["id"], character_id),
                )
            db.execute(
                "DELETE FROM imports WHERE id=? AND character_id=?",
                (import_id, character_id),
            )
        return {
            "rolled_back": True,
            "import_id": import_id,
            "source_sha256": imported["source_sha256"],
            "removed_message_count": len(message_ids),
            "source_bytes_removed": True,
        }
    def interrupt_job(self,job_id):
        with self.connect() as db:
            for row in db.execute("SELECT id,character_id,receipt FROM turns WHERE status='generating_reply'").fetchall():
                receipt=json.loads(row['receipt'])
                if receipt.get('job_id')==job_id:
                    receipt['error']='Processing was interrupted.'
                    db.execute("UPDATE turns SET status='interrupted',receipt=? WHERE id=?",(text_json(receipt),row['id']))
    def count(self, character_id):
        self.valid_id(character_id)
        with self.connect() as db: return db.execute("SELECT count(*) FROM messages WHERE character_id=?", (character_id,)).fetchone()[0]
    def messages(self, character_id, limit=200, offset=0):
        self.valid_id(character_id)
        if type(limit) is not int or not 1 <= limit <= 100_000 or type(offset) is not int or offset < 0: raise ValueError("Invalid history page.")
        with self.connect() as db:
            rows = db.execute("SELECT * FROM messages WHERE character_id=? ORDER BY sequence LIMIT ? OFFSET ?", (character_id, limit, offset)).fetchall()
        return [dict(r, timestamp=json.loads(r["timestamp"]) if r["imported"] and r["timestamp"] is not None else r["timestamp"], provenance=json.loads(r["provenance"])) for r in rows]
    def retrieve(self, character_id, query, recent=8, selected=8, max_chars=9000):
        self.valid_id(character_id); terms = set(re.findall(r"\w{3,}", query.casefold()))
        with self.connect() as db:
            tail = db.execute("SELECT * FROM messages WHERE character_id=? ORDER BY sequence DESC LIMIT ?", (character_id, recent)).fetchall()
            # Stream the full archive: persistent storage is never truncated to the context window.
            best = []
            for row in db.execute("SELECT * FROM messages WHERE character_id=? ORDER BY sequence", (character_id,)):
                score = len(terms & set(re.findall(r"\w{3,}", row["content"].casefold())))
                if score:
                    best.append((score, row["sequence"], row)); best.sort(key=lambda x: (x[0], x[1]), reverse=True); del best[selected:]
        candidates = {r["sequence"]: r for r in tail}
        candidates.update({r["sequence"]: r for _, _, r in best})
        result = []; used = 0
        for row in sorted(candidates.values(), key=lambda r: r["sequence"], reverse=True):
            excerpt = row["content"][:min(3000, max_chars-used)]
            if not excerpt: break
            provenance = json.loads(row["provenance"])
            result.append({"message_id": row["message_id"], "role": row["role"], "content": excerpt,
                           "context_excerpt_truncated": len(excerpt) != len(row["content"]), "sequence": row["sequence"],
                           "import_id": provenance.get("import_id"), "source_sha256": provenance.get("source_sha256"),
                           "source_span": provenance.get("source_span")})
            used += len(excerpt)
        return list(reversed(result))
    def retrieve_with_receipt(self, character_id, query, receipt_id, recent=8, selected=8, max_chars=6500):
        excerpts = self.retrieve(character_id, query, recent, selected, max_chars)
        receipt = {
            "context_message_ids": [row["message_id"] for row in excerpts],
            "context_excerpts": excerpts,
            "truncated_message_ids": [
                row["message_id"] for row in excerpts if row["context_excerpt_truncated"]
            ],
            "context_character_budget": max_chars,
            "full_history_retained": True,
            "imported_system_role_is_executable_policy": False,
        }
        if receipt_id:
            self.save_turn(receipt_id, character_id, "context_retrieved", receipt)
        return receipt
    def append(self, character_id, role, content, provenance=None):
        self.valid_id(character_id)
        if role not in ROLES or not isinstance(content,str) or not content.strip() or len(content.encode())>MAX_MESSAGE_BYTES: raise ValueError("Invalid live message.")
        mid = "message_" + uuid.uuid4().hex
        with self.connect() as db:
            db.execute("INSERT INTO messages(character_id,message_id,role,content,timestamp,provenance,imported) VALUES(?,?,?,?,?,?,0)",
                       (character_id, mid, role, content, now(), text_json(provenance or {})))
        return mid
    def save_turn(self, turn_id, character_id, status, receipt):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO turns VALUES(?,?,?,?,?)", (turn_id, character_id, status, text_json(receipt), now()))
    def export(self, character_id, path):
        self.valid_id(character_id)
        def portable_receipt(value):
            if isinstance(value, dict):
                result = {}
                for key, item in value.items():
                    if key == "audio_path" and isinstance(item, str):
                        candidate = Path(item).resolve()
                        result[key] = (
                            candidate.relative_to(self.root).as_posix()
                            if candidate.is_relative_to(self.root)
                            else None
                        )
                    else:
                        result[key] = portable_receipt(item)
                return result
            if isinstance(value, list):
                return [portable_receipt(item) for item in value]
            return value

        with self.connect() as db, Path(path).open("w",encoding="utf-8") as out:
            out.write('{"schema_version":"1.1.0","character_id":'+text_json(character_id)+',"imports":[')
            first_import = True
            for row in db.execute(
                "SELECT id,source_sha256,filename,created_at,original,mapping,count "
                "FROM imports WHERE character_id=? ORDER BY created_at,id",
                (character_id,),
            ):
                original = bytes(row["original"])
                if hashlib.sha256(original).hexdigest() != row["source_sha256"]:
                    raise ValueError("A stored history source failed its SHA256 integrity check.")
                record = {
                    "import_id": row["id"],
                    "source_sha256": row["source_sha256"],
                    "filename": row["filename"],
                    "created_at": row["created_at"],
                    "mapping": json.loads(row["mapping"]),
                    "message_count": row["count"],
                    "original_bytes_base64": base64.b64encode(original).decode("ascii"),
                }
                if not first_import:
                    out.write(",")
                out.write(text_json(record))
                first_import = False
            out.write('],"messages":[')
            first=True
            for row in db.execute("SELECT * FROM messages WHERE character_id=? ORDER BY sequence", (character_id,)):
                value=dict(row); value["provenance"]=json.loads(value["provenance"])
                if value["imported"] and value["timestamp"] is not None:
                    value["timestamp"] = json.loads(value["timestamp"])
                if not first:out.write(',')
                out.write(text_json(value));first=False
            out.write('],"turns":[')
            first = True
            for row in db.execute(
                "SELECT id,status,receipt,created_at FROM turns WHERE character_id=? ORDER BY created_at,id",
                (character_id,),
            ):
                record = {
                    "turn_id": row["id"],
                    "status": row["status"],
                    "receipt": portable_receipt(json.loads(row["receipt"])),
                    "created_at": row["created_at"],
                }
                if not first:
                    out.write(",")
                out.write(text_json(record))
                first = False
            out.write(']}')
        return Path(path)
