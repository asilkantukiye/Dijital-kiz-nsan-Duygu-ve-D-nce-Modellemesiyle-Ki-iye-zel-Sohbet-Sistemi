from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from data.split_integrity import validate_split_integrity


def valid_splits():
    return {
        "train": (["p1", "p1", "p2"], ["s1", "s2", "s3"]),
        "validation": (["p3"], ["s4"]),
        "test": (["p4"], ["s5"]),
    }


class SplitIntegrityTests(unittest.TestCase):
    def test_accepts_disjoint_splits(self):
        validate_split_integrity(valid_splits())

    def test_rejects_participant_leakage(self):
        splits = valid_splits()
        splits["test"] = (["p2"], ["s5"])
        with self.assertRaisesRegex(ValueError, "Katılımcı sızıntısı"):
            validate_split_integrity(splits)

    def test_rejects_sample_leakage_when_participants_differ(self):
        splits = valid_splits()
        splits["validation"] = (["p3"], ["s1"])
        with self.assertRaisesRegex(ValueError, "Örnek sızıntısı"):
            validate_split_integrity(splits)

    def test_rejects_duplicate_sample_inside_a_split(self):
        splits = valid_splits()
        splits["train"] = (["p1", "p2"], ["same", "same"])
        with self.assertRaisesRegex(ValueError, "tekrarlanan sample_id"):
            validate_split_integrity(splits)

    def test_rejects_blank_identifiers(self):
        splits = valid_splits()
        splits["validation"] = ([" "], ["s4"])
        with self.assertRaisesRegex(ValueError, "participant_id boş"):
            validate_split_integrity(splits)

    def test_requires_all_three_splits(self):
        splits = valid_splits()
        del splits["test"]
        with self.assertRaisesRegex(ValueError, "Eksik veri bölümleri"):
            validate_split_integrity(splits)


if __name__ == "__main__":
    unittest.main(verbosity=2)
