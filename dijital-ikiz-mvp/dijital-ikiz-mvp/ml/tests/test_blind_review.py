from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from prepare_blind_review import prepare_blind_review  # noqa: E402


def paired_rows():
    return [
        {
            "pair_id": "case-source-1",
            "prompt_text": "Kısa bir cevap ver.",
            "response_text": "A kısa yanıt.",
            "variant": "personalized",
            "participant_id": "must-not-leak",
        },
        {
            "pair_id": "case-source-1",
            "prompt_text": "  Kısa bir cevap ver.  ",
            "response_text": "B kısa yanıt.",
            "variant": "baseline",
            "participant_id": "must-not-leak",
        },
        {
            "pair_id": "case-source-2",
            "prompt_text": "Bir konu öner.",
            "response_text": "Bir kitap oku.",
            "variant": "baseline",
            "participant_id": "must-not-leak",
        },
        {
            "pair_id": "case-source-2",
            "prompt_text": "Bir konu öner.",
            "response_text": "Bir bilim kitabı deneyebilirsin.",
            "variant": "personalized",
            "participant_id": "must-not-leak",
        },
    ]


def read_csv(path: Path):
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


class BlindReviewTests(unittest.TestCase):
    def test_writes_separate_reviewer_packet_and_condition_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            review_path = root / "review.csv"
            key_path = root / "private" / "key.csv"

            count = prepare_blind_review(
                paired_rows(), review_path, key_path, seed=42
            )

            self.assertEqual(count, 2)
            review = read_csv(review_path)
            key = read_csv(key_path)
            self.assertEqual(len(review), 4)
            self.assertEqual(len(key), 4)
            self.assertEqual(
                set(review[0]),
                {"case_id", "response_label", "prompt_text", "response_text"},
            )
            self.assertEqual(
                set(key[0]),
                {"case_id", "response_label", "variant"},
            )
            self.assertNotIn("variant", review[0])
            self.assertNotIn("pair_id", review[0])
            self.assertNotIn("participant_id", review[0])
            self.assertNotIn("must-not-leak", review_path.read_text(encoding="utf-8"))

            for case_id in {row["case_id"] for row in review}:
                review_rows = [row for row in review if row["case_id"] == case_id]
                key_rows = [row for row in key if row["case_id"] == case_id]
                self.assertEqual({row["response_label"] for row in review_rows}, {"A", "B"})
                self.assertEqual({row["response_label"] for row in key_rows}, {"A", "B"})
                self.assertEqual({row["variant"] for row in key_rows}, {"personalized", "baseline"})

    def test_rejects_pair_with_missing_variant(self):
        rows = [paired_rows()[0]]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "tam olarak bir personalized ve bir baseline"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv", seed=1)

    def test_rejects_duplicate_variant_in_pair(self):
        rows = paired_rows()[:2] + [{
            **paired_rows()[0],
            "response_text": "Duplicate response.",
        }]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "aynı varyant birden fazla"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv", seed=1)

    def test_rejects_different_prompts_for_a_pair(self):
        rows = paired_rows()[:2]
        rows[1]["prompt_text"] = "Başka bir istem."
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "istemi aynı olmalı"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv", seed=1)

    def test_refuses_to_overwrite_outputs_by_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            review = root / "review.csv"
            key = root / "key.csv"
            review.write_text("existing", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                prepare_blind_review(paired_rows(), review, key)

            self.assertEqual(review.read_text(encoding="utf-8"), "existing")
            self.assertFalse(key.exists())

    def test_rejects_same_path_for_packet_and_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "same.csv"
            with self.assertRaisesRegex(ValueError, "farklı dosyalar"):
                prepare_blind_review(paired_rows(), path, path)

    def test_rejects_empty_prompt_or_response(self):
        rows = paired_rows()
        rows[0]["response_text"] = "  "
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "boş olamaz"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv")


if __name__ == "__main__":
    unittest.main(verbosity=2)
