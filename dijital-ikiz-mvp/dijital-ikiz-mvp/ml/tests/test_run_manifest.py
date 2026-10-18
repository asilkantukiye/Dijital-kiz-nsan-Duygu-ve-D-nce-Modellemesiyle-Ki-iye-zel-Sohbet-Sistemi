from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from data.run_manifest import build_split_manifest, sha256_file


class RunManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "train.csv"
        self.path.write_text(
            "sample_id,participant_id,text,source,license_or_consent,valence\n"
            "sample-1,private-person-1,private text one,source-a,consent-a,0.2\n"
            "sample-2,private-person-2,private text two,source-b,consent-a,0.8\n",
            encoding="utf-8",
        )
        self.rows = [
            {
                "sample_id": "sample-1",
                "participant_id": "private-person-1",
                "text": "private text one",
                "source": "source-a",
                "license_or_consent": "consent-a",
                "valence": 0.2,
            },
            {
                "sample_id": "sample-2",
                "participant_id": "private-person-2",
                "text": "private text two",
                "source": "source-b",
                "license_or_consent": "consent-a",
                "valence": 0.8,
            },
        ]

    def test_hash_matches_exact_file_bytes(self):
        self.assertEqual(
            sha256_file(self.path),
            hashlib.sha256(self.path.read_bytes()).hexdigest(),
        )

    def test_manifest_is_reproducible_and_counts_rows(self):
        first = build_split_manifest(self.path, self.rows, ["valence"])
        second = build_split_manifest(self.path, self.rows, ["valence"])

        self.assertEqual(first, second)
        self.assertEqual(first["file_name"], "train.csv")
        self.assertEqual(first["row_count"], 2)
        self.assertEqual(first["unique_sample_count"], 2)
        self.assertEqual(first["unique_participant_count"], 2)
        self.assertEqual(first["label_columns"], ["valence"])
        self.assertEqual(first["distinct_source_value_count"], 2)
        self.assertEqual(first["distinct_license_or_consent_value_count"], 1)

    def test_report_does_not_copy_ids_or_text(self):
        report = json.dumps(
            build_split_manifest(self.path, self.rows, ["valence"]),
            ensure_ascii=False,
        )
        for private_value in (
            "private-person-1",
            "private text one",
            "sample-1",
            "source-a",
            "consent-a",
        ):
            self.assertNotIn(private_value, report)

    def test_changed_file_changes_fingerprint(self):
        before = sha256_file(self.path)
        self.path.write_text(
            self.path.read_text(encoding="utf-8") + "# revised\n",
            encoding="utf-8",
        )
        self.assertNotEqual(before, sha256_file(self.path))


if __name__ == "__main__":
    unittest.main()
