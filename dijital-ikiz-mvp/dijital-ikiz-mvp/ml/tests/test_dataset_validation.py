from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))
from data.validate_dataset import REQUIRED_COLUMNS  # noqa: E402

VALIDATOR = ML_DIR / "data" / "validate_dataset.py"


def valid_row(sample_id: str = "s1", participant_id: str = "p1") -> dict[str, str]:
    row = {column: "0.5" for column in REQUIRED_COLUMNS}
    row.update({
        "sample_id": sample_id,
        "participant_id": participant_id,
        "text": "Bu bir sentetik test örneğidir.",
        "source": "synthetic-test-fixture",
        "license_or_consent": "synthetic-fixture; no real user data",
    })
    return row


class DatasetValidationTests(unittest.TestCase):
    def run_validator(self, rows: list[dict[str, str]], columns=None):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "dataset.csv"
            fieldnames = list(columns or sorted(REQUIRED_COLUMNS))
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            return subprocess.run(
                [sys.executable, str(VALIDATOR), str(path)],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_accepts_finite_valid_synthetic_row(self):
        result = self.run_validator([valid_row()])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Veri şeması temel kontrollerden geçti", result.stdout)

    def test_rejects_nan_label(self):
        row = valid_row()
        row["valence"] = "NaN"
        result = self.run_validator([row])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sonlu bir sayı", result.stderr)

    def test_rejects_infinite_label(self):
        row = valid_row()
        row["arousal"] = "inf"
        result = self.run_validator([row])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sonlu bir sayı", result.stderr)

    def test_rejects_non_numeric_label(self):
        row = valid_row()
        row["dominance"] = "belirsiz"
        result = self.run_validator([row])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sayısal olmalıdır", result.stderr)

    def test_rejects_missing_data_provenance(self):
        row = valid_row()
        row["license_or_consent"] = ""
        result = self.run_validator([row])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("license_or_consent boş olamaz", result.stderr)

    def test_rejects_empty_text(self):
        row = valid_row()
        row["text"] = "  "
        result = self.run_validator([row])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Boş text", result.stderr)

    def test_rejects_duplicate_sample_ids(self):
        result = self.run_validator([
            valid_row("same", "p1"),
            valid_row("same", "p2"),
        ])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Tekrarlanan sample_id", result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
