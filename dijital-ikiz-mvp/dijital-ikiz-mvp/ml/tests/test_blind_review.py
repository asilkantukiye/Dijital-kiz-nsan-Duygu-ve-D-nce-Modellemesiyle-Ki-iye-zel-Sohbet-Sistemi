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
                {"case_id", "response_label", "variant", "participant_id"},
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
                self.assertEqual({row["participant_id"] for row in key_rows}, {"must-not-leak"})

    def test_same_seed_reproduces_identical_blind_packet_and_condition_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            review_one = root / "review-one.csv"
            key_one = root / "key-one.csv"
            review_two = root / "review-two.csv"
            key_two = root / "key-two.csv"

            prepare_blind_review(paired_rows(), review_one, key_one, seed=73)
            prepare_blind_review(paired_rows(), review_two, key_two, seed=73)

            self.assertEqual(review_one.read_bytes(), review_two.read_bytes())
            self.assertEqual(key_one.read_bytes(), key_two.read_bytes())

    def test_different_seeds_change_randomized_blind_packet(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            review_one = root / "review-one.csv"
            key_one = root / "key-one.csv"
            review_two = root / "review-two.csv"
            key_two = root / "key-two.csv"

            prepare_blind_review(paired_rows(), review_one, key_one, seed=11)
            prepare_blind_review(paired_rows(), review_two, key_two, seed=99)

            # Order and A/B labels are randomized; no sensitive IDs are used as case IDs.
            self.assertNotEqual(review_one.read_bytes(), review_two.read_bytes())
            for row in read_csv(review_one):
                self.assertRegex(row["case_id"], r"^[0-9a-f]{32}$")
                self.assertNotIn("case-source", row["case_id"])

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



    def test_blind_input_template_matches_required_columns_and_is_empty(self):
        template_path = ML_DIR / "data" / "blind_review_input_template.csv"
        with template_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = set(reader.fieldnames or [])
            rows = list(reader)

        self.assertEqual(fields, {
            "pair_id", "participant_id", "prompt_text", "response_text", "variant"
        })
        self.assertEqual(rows, [], "Girdi şablonu örnek katılımcı verisi içermemeli.")

    def test_rating_template_has_blind_scoring_columns_and_no_data(self):
        template_path = ML_DIR / "data" / "blind_review_rating_template.csv"
        with template_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = set(reader.fieldnames or [])
            rows = list(reader)

        self.assertEqual(fields, {
            "rater_id", "case_id", "response_label", "helpfulness_1_5",
            "style_fit_1_5", "emotion_fit_1_5"
        })
        self.assertEqual(rows, [], "Şablonda gerçek değerlendirici puanı bulunmamalı.")


    def test_rejects_missing_pseudonymous_participant_id(self):
        rows = paired_rows()
        rows[0]["participant_id"] = ""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "participant_id boş olamaz"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv", seed=1)

    def test_rejects_pair_with_different_participant_ids(self):
        rows = paired_rows()[:2]
        rows[1]["participant_id"] = "another-participant"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "aynı takma participant_id"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv", seed=1)

    def test_rejects_empty_prompt_or_response(self):
        rows = paired_rows()
        rows[0]["response_text"] = "  "
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "boş olamaz"):
                prepare_blind_review(rows, root / "review.csv", root / "key.csv")


if __name__ == "__main__":
    unittest.main(verbosity=2)
