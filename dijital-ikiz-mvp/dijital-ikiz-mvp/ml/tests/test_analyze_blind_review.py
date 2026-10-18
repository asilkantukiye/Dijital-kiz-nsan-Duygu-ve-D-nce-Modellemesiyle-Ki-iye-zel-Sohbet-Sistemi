from __future__ import annotations

import sys
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from analyze_blind_review import analyze_blind_review_rows  # noqa: E402


def fixture_key():
    rows = []
    # Two anonymised participants, two paired prompts each.
    for participant_index, participant_id in enumerate(("P001", "P002")):
        for prompt_index in range(2):
            case_id = f"case-{participant_index}-{prompt_index}"
            if (participant_index + prompt_index) % 2 == 0:
                variants = (("A", "personalized"), ("B", "baseline"))
            else:
                variants = (("A", "baseline"), ("B", "personalized"))
            for label, variant in variants:
                rows.append({
                    "case_id": case_id,
                    "response_label": label,
                    "variant": variant,
                    "participant_id": participant_id,
                })
    return rows


def fixture_ratings():
    rows = []
    for key_row in fixture_key():
        for rater_id, delta in (("R1", 0), ("R2", -1)):
            if key_row["variant"] == "personalized":
                scores = (5 + delta, 4 + delta, 4 + delta)
            else:
                scores = (3 + delta, 2 + delta, 2 + delta)
            rows.append({
                "rater_id": rater_id,
                "case_id": key_row["case_id"],
                "response_label": key_row["response_label"],
                "helpfulness_1_5": str(scores[0]),
                "style_fit_1_5": str(scores[1]),
                "emotion_fit_1_5": str(scores[2]),
            })
    return rows


class AnalyzeBlindReviewTests(unittest.TestCase):
    def test_analyzes_paired_blind_ratings_without_exposing_ids(self):
        report = analyze_blind_review_rows(
            fixture_ratings(),
            fixture_key(),
            seed=1,
            bootstrap_repetitions=100,
            permutation_repetitions=100,
        )

        self.assertEqual(report["reviewer_count"], 2)
        self.assertEqual(report["rating_rows"], 16)
        metric = report["metrics"]["helpfulness_1_5"]
        self.assertEqual(metric["paired_participant_count"], 2)
        self.assertEqual(metric["paired_case_count"], 4)
        self.assertAlmostEqual(
            metric["difference_personalized_minus_baseline"]["mean"],
            2.0,
        )
        self.assertAlmostEqual(
            metric["variant_summary"]["personalized"]["mean_participant_score"],
            4.5,
        )
        self.assertAlmostEqual(
            metric["variant_summary"]["baseline"]["mean_participant_score"],
            2.5,
        )
        serialized = str(report)
        self.assertNotIn("P001", serialized)
        self.assertNotIn("case-0-0", serialized)

    def test_rejects_duplicate_rater_response_score(self):
        key = fixture_key()
        ratings = fixture_ratings()
        ratings.append(dict(ratings[0]))
        with self.assertRaisesRegex(ValueError, "birden fazla kez"):
            analyze_blind_review_rows(ratings, key)

    def test_rejects_rating_outside_one_to_five(self):
        ratings = fixture_ratings()
        ratings[0]["helpfulness_1_5"] = "6"
        with self.assertRaisesRegex(ValueError, "1–5 arasında tam sayı"):
            analyze_blind_review_rows(ratings, fixture_key())

    def test_rejects_unknown_case_label_pair(self):
        ratings = fixture_ratings()
        ratings[0]["case_id"] = "not-in-key"
        with self.assertRaisesRegex(ValueError, "anahtarında bulunamadı"):
            analyze_blind_review_rows(ratings, fixture_key())

    def test_rejects_malformed_condition_key(self):
        key = fixture_key()
        key.pop()
        with self.assertRaisesRegex(ValueError, "tam A ve B"):
            analyze_blind_review_rows(fixture_ratings(), key)


if __name__ == "__main__":
    unittest.main(verbosity=2)
