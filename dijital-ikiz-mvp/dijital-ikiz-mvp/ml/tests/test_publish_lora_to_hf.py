import hashlib
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "kaggle"))
import publish_lora_to_hf as publisher


class PublisherIntegrityTests(unittest.TestCase):
    def test_manifest_hashes_every_release_file_and_detects_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            payload = root / "README.md"
            payload.write_text("release metadata\n", encoding="utf-8")

            manifest = publisher.build_manifest(root)
            self.assertEqual(manifest["README.md"]["bytes"], payload.stat().st_size)
            self.assertEqual(
                manifest["README.md"]["sha256"],
                hashlib.sha256(payload.read_bytes()).hexdigest(),
            )
            publisher.verify_local_manifest(root, manifest)

            payload.write_text("tampered metadata\n", encoding="utf-8")
            with self.assertRaises(SystemExit):
                publisher.verify_local_manifest(root, manifest)

    def test_manifest_excludes_itself(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "adapter_config.json").write_text("{}", encoding="utf-8")
            (root / "artifact-manifest.json").write_text("{}", encoding="utf-8")
            self.assertEqual(set(publisher.build_manifest(root)), {"adapter_config.json"})

    def test_safe_extract_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("../escape.txt", "unsafe")

            with self.assertRaises(SystemExit):
                publisher.safe_extract(archive, root / "out")
            self.assertFalse((root / "escape.txt").exists())

    def test_retry_retries_then_returns_without_printing_exception_message(self):
        attempts = {"count": 0}

        def flaky():
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise RuntimeError("sensitive response body must never be printed")
            return "ok"

        with patch.object(publisher.time, "sleep", return_value=None):
            self.assertEqual(publisher.retry_with_backoff(flaky, "unit operation", attempts=3), "ok")
        self.assertEqual(attempts["count"], 3)

    def test_remote_lfs_sha256_and_small_file_sha256_are_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = root / "adapter_config.json"
            config.write_text('{"r": 8}', encoding="utf-8")
            weights = root / "adapter_model.safetensors"
            weights.write_bytes(b"test-weights")

            manifest = {
                "adapter_config.json": {
                    "bytes": config.stat().st_size,
                    "sha256": hashlib.sha256(config.read_bytes()).hexdigest(),
                },
                "adapter_model.safetensors": {
                    "bytes": weights.stat().st_size,
                    "sha256": hashlib.sha256(weights.read_bytes()).hexdigest(),
                },
            }

            class FakeApi:
                def get_paths_info(self, **kwargs):
                    return [
                        SimpleNamespace(path="adapter_config.json", size=config.stat().st_size, lfs=None),
                        SimpleNamespace(
                            path="adapter_model.safetensors",
                            size=weights.stat().st_size,
                            lfs=SimpleNamespace(sha256=manifest["adapter_model.safetensors"]["sha256"]),
                        ),
                    ]

            download_calls = []

            def fake_download(**kwargs):
                download_calls.append(kwargs["filename"])
                return str(config)

            publisher.verify_remote_manifest(
                FakeApi(), "owner/model", "unused-test-token", manifest, fake_download
            )
            self.assertEqual(download_calls, ["adapter_config.json"])


if __name__ == "__main__":
    unittest.main()
