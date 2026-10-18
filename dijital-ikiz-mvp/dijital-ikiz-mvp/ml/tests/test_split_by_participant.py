from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from data.split_by_participant import group_participants_by_shared_text  # noqa: E402
from data.split_integrity import normalize_text  # noqa: E402

SPLITTER = ML_DIR / "data" / "split_by_participant.py"


class SplitByParticipantTests(unittest.TestCase):
    def test_groups_participants_who_share_normalized_text(self):
        rows = [
            {"participant_id": "p1", "text": "Hello   WORLD"},
            {"participant_id": "p2", "text": " hello world "},
            {"participant_id": "p3", "text": "ＡＢＣ"},
            {"participant_id": "p4", "text": "abc"},
            {"participant_id": "p5", "text": "unique fifth"},
        ]
        groups = group_participants_by_shared_text(rows)
        self.assertEqual(
            groups,
            [["p1", "p2"], ["p3", "p4"], ["p5"]],
        )

    def test_transitively_connected_participants_stay_in_one_group(self):
        rows = [
            {"participant_id": "p1", "text": "text A"},
            {"participant_id": "p2", "text": "text A"},
            {"participant_id": "p2", "text": "text B"},
            {"participant_id": "p3", "text": "text B"},
            {"participant_id": "p4", "text": "text C"},
        ]
        groups = group_participants_by_shared_text(rows)
        self.assertEqual(groups, [["p1", "p2", "p3"], ["p4"]])

    def test_grouping_rejects_blank_text(self):
        with self.assertRaisesRegex(ValueError, "text boş"):
            group_participants_by_shared_text([
                {"participant_id": "p1", "text": ""},
            ])

    def test_cli_keeps_shared_text_out_of_multiple_splits(self):
        rows = [
            {"sample_id": "s1", "participant_id": "p1", "text": "shared one"},
            {"sample_id": "s2", "participant_id": "p2", "text": "SHARED   ONE"},
            {"sample_id": "s3", "participant_id": "p3", "text": "shared two"},
            {"sample_id": "s4", "participant_id": "p4", "text": "shared TWO"},
            {"sample_id": "s5", "participant_id": "p5", "text": "unique five"},
            {"sample_id": "s6", "participant_id": "p6", "text": "unique six"},
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "dataset.csv"
            output_dir = root / "splits"
            with input_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["sample_id", "participant_id", "text"])
                writer.writeheader()
                writer.writerows(rows)

            result = subprocess.run(
                [
                    sys.executable,
                    str(SPLITTER),
                    str(input_path),
                    str(output_dir),
                    "--seed",
                    "unit-test-seed",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

            locations: dict[str, set[str]] = {}
            for split_name in ("train", "validation", "test"):
                split_path = output_dir / f"{split_name}.csv"
                self.assertTrue(split_path.exists())
                with split_path.open("r", encoding="utf-8", newline="") as handle:
                    for index, row in enumerate(csv.DictReader(handle), start=2):
                        normalized = normalize_text(
                            row["text"], split=split_name, index=index
                        )
                        locations.setdefault(normalized, set()).add(split_name)

            self.assertTrue(locations)
            self.assertTrue(
                all(len(split_names) == 1 for split_names in locations.values()),
                "Aynı normalize edilmiş metin farklı split dosyalarına dağılmış.",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
