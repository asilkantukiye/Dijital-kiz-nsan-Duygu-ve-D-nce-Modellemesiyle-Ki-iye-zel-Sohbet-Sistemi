from __future__ import annotations

import csv
import sys
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ML_DIR / "data"
sys.path.insert(0, str(ML_DIR))

from data.validate_dataset import required_columns_for_task  # noqa: E402


class DatasetTemplateTests(unittest.TestCase):
    def assert_template(self, filename: str, task: str) -> None:
        path = DATA_DIR / filename
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = set(reader.fieldnames or [])
            rows = list(reader)

        self.assertEqual(columns, required_columns_for_task(task))
        self.assertEqual(rows, [], "Depoda örnek/gerçek kullanıcı satırı bulunmamalı.")

    def test_vad_template_matches_validator_and_is_empty(self):
        self.assert_template("vad_template.csv", "vad")

    def test_big_five_template_matches_validator_and_is_empty(self):
        self.assert_template("big_five_template.csv", "big-five")

    def test_style_template_matches_validator_and_is_empty(self):
        self.assert_template("style_template.csv", "style")


if __name__ == "__main__":
    unittest.main(verbosity=2)
