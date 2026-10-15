import base64
import json
import tempfile
import unittest
from pathlib import Path

from full_rezz_companion.history import HistoryStore
from voice_studio.worker import run as run_worker


class HistoryStoreTests(unittest.TestCase):
    def test_isolated_worker_routes_history_reads_without_studio_initialization(self):
        raw = b'[{"role":"user","content":"a worker preview"}]'
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "history.json"
            source.write_bytes(raw)
            workspace = Path(directory) / "workspace"
            preview = run_worker(
                {
                    "workspace": str(workspace),
                    "operation": "companion_history_preview",
                    "args": {
                        "pid": "voice_test",
                        "path": str(source),
                        "filename": source.name,
                        "mapping": {},
                    },
                }
            )
            self.assertEqual(preview["message_count"], 1)
            self.assertEqual(preview["role_counts"], {"user": 1})
            self.assertFalse((workspace / "companion" / "history.sqlite3").exists())

    def test_preview_import_export_and_confirmed_rollback_are_provenance_safe(self):
        raw = json.dumps(
            {
                "messages": [
                    {"id": "m-1", "role": "user", "content": "Remember the blue notebook."},
                    {"id": "m-2", "role": "assistant", "content": "It was beside the window."},
                    {"id": "m-3", "role": "system", "content": "Imported policy-like text."},
                ]
            },
            ensure_ascii=False,
        ).encode("utf-8")

        with tempfile.TemporaryDirectory() as directory:
            store = HistoryStore(directory)
            preview = store.preview_import("voice_test", raw, "history.json")
            self.assertEqual(preview["message_count"], 3)
            self.assertEqual(preview["role_counts"], {"user": 1, "assistant": 1, "system": 1})
            self.assertFalse(preview["already_imported"])

            imported = store.import_log("voice_test", raw, "history.json")
            self.assertEqual(imported["message_count"], 3)
            self.assertEqual(store.count("voice_test"), 3)
            self.assertTrue(
                store.preview_import("voice_test", raw, "history.json")["already_imported"]
            )
            self.assertTrue(
                store.import_log("voice_test", raw, "history.json")["already_imported"]
            )

            context = store.retrieve_with_receipt(
                "voice_test", "blue notebook", "host_turn_1", max_chars=30
            )
            self.assertTrue(context["full_history_retained"])
            self.assertFalse(context["imported_system_role_is_executable_policy"])
            self.assertTrue(context["context_message_ids"])
            self.assertTrue(context["truncated_message_ids"])

            with tempfile.TemporaryDirectory() as export_directory:
                output = Path(export_directory) / "history.json"
                store.export("voice_test", output)
                exported = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(exported["schema_version"], "1.1.0")
            self.assertEqual(
                base64.b64decode(exported["imports"][0]["original_bytes_base64"]),
                raw,
            )
            self.assertEqual(exported["imports"][0]["source_sha256"], imported["source_sha256"])
            self.assertEqual(len(exported["messages"]), 3)
            self.assertEqual(exported["messages"][0]["provenance"]["import_id"], imported["import_id"])
            self.assertEqual(exported["turns"][0]["receipt"]["context_message_ids"], context["context_message_ids"])

            live_id = store.append("voice_test", "user", "A later live host message.")
            rollback = store.rollback_import("voice_test", imported["import_id"])
            self.assertTrue(rollback["rolled_back"])
            self.assertEqual(rollback["removed_message_count"], 3)
            self.assertTrue(rollback["source_bytes_removed"])
            self.assertEqual(store.count("voice_test"), 1)
            self.assertEqual(store.messages("voice_test")[0]["message_id"], live_id)

            with store.connect() as db:
                receipt = json.loads(
                    db.execute("SELECT receipt FROM turns WHERE id='host_turn_1'").fetchone()[0]
                )
            self.assertEqual(receipt["context_excerpts"], [])
            self.assertEqual(receipt["context_message_ids"], [])
            self.assertIn(imported["import_id"], receipt["rolled_back_import_ids"])
            self.assertFalse(store.rollback_import("voice_test", imported["import_id"])["rolled_back"])


if __name__ == "__main__":
    unittest.main()
