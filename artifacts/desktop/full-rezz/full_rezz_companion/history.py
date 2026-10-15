"""Atomic, provenance-preserving chat imports and durable per-character memory."""
from __future__ import annotations
import csv, hashlib, io, json, re, sqlite3, uuid
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
    def __init__(self, root):
        self.path = Path(root) / "companion" / "history.sqlite3"
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
            result.append({"message_id": row["message_id"], "role": row["role"], "content": excerpt,
                           "context_excerpt_truncated": len(excerpt) != len(row["content"]), "sequence": row["sequence"]})
            used += len(excerpt)
        return list(reversed(result))
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
        with self.connect() as db, Path(path).open("w",encoding="utf-8") as out:
            out.write('{"schema_version":"1.0.0","character_id":'+text_json(character_id)+',"messages":[')
            first=True
            for row in db.execute("SELECT * FROM messages WHERE character_id=? ORDER BY sequence", (character_id,)):
                value=dict(row); value["provenance"]=json.loads(value["provenance"])
                if not first:out.write(',')
                out.write(text_json(value));first=False
            out.write(']}')
        return Path(path)
