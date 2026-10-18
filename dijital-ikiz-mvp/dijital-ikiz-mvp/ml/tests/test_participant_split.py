from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
SPLITTER = ML_DIR / "data" / "split_by_participant.py"


def write_input(path: Path, participants: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["participant_id", "sample_id", "text"])
        writer.writeheader()
        for index, participant in enumerate(participants, start=1):
            writer.writerow({
                "participant_id": participant,
                "sample_id": f"s{index}",
                "text": f"synthetic sample {index}",
            })


class ParticipantSplitTests(unittest.TestCase):
    def run_split(self, participants: list[str]):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source = root / "input.csv"
        output = root / "splits"
        write_input(source, participants)
        result = subprocess.run(
            [sys.executable, str(SPLITTER), str(source), str(output)],
            capture_output=True,
            text=True,
            check=False,
        )
        return result, output

    def test_creates_all_three_files_and_keeps_participants_disjoint(self):
        source_participants = [
            "p1", "p1", "p2", "p2", "p3", "p3",
            "p4", "p4", "p5", "p5", "p6", "p6",
        ]
        result, output = self.run_split(source_participants)
        self.assertEqual(result.returncode, 0, result.stderr)

        split_participants = {}
        combined_sample_ids = []
        for name in ("train", "validation", "test"):
            path = output / f"{name}.csv"
            self.assertTrue(path.exists(), f"{path} oluşturulmadı.")
            with path.open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertTrue(rows, f"{name} bölümü boş.")
            split_participants[name] = {row["participant_id"] for row in rows}
            combined_sample_ids.extend(row["sample_id"] for row in rows)

        self.assertEqual(len(combined_sample_ids), len(set(combined_sample_ids)))
        self.assertEqual(set(combined_sample_ids), {f"s{i}" for i in range(1, 13)})
        self.assertFalse(split_participants["train"] & split_participants["validation"])
        self.assertFalse(split_participants["train"] & split_participants["test"])
        self.assertFalse(split_participants["validation"] & split_participants["test"])

    def test_rejects_fewer_than_three_participants(self):
        result, output = self.run_split(["p1", "p2"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("en az 3 farklı katılımcı", result.stderr)
        self.assertFalse(output.exists())

    def test_rejects_blank_participant(self):
        result, _ = self.run_split(["p1", "", "p3"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Boş participant_id", result.stderr)

    def test_rejects_duplicate_sample_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.csv"
            output = root / "splits"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["participant_id", "sample_id", "text"])
                writer.writeheader()
                writer.writerows([
                    {"participant_id": "p1", "sample_id": "duplicate", "text": "a"},
                    {"participant_id": "p2", "sample_id": "duplicate", "text": "b"},
                    {"participant_id": "p3", "sample_id": "s3", "text": "c"},
                ])
            result = subprocess.run(
                [sys.executable, str(SPLITTER), str(source), str(output)],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Tekrarlanan sample_id", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
