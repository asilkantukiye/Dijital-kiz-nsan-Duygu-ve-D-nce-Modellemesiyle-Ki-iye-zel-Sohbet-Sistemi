from __future__ import annotations

import sys
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from analyze_blind_review import analyze_blind_review_rows, holm_adjust_pvalues  # noqa: E402


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
        for rater_id, delta in (("R1", 0), ("R2", 0)):
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
            5.0,
        )
        self.assertAlmostEqual(
            metric["variant_summary"]["baseline"]["mean_participant_score"],
            3.0,
        )
        self.assertAlmostEqual(
            report["inter_rater_agreement"]["helpfulness_1_5"]["mean"],
            1.0,
        )
        self.assertIn(
            "p_value_holm_adjusted",
            metric["difference_personalized_minus_baseline"]["permutation_test"],
        )
        serialized = str(report)
        self.assertNotIn("P001", serialized)
        self.assertNotIn("case-0-0", serialized)


    def test_holm_adjustment_controls_familywise_inflation(self):
        adjusted = holm_adjust_pvalues({
            "helpfulness": 0.01,
            "style": 0.04,
            "emotion": 0.03,
            "not_available": None,
        })

        self.assertAlmostEqual(adjusted["helpfulness"], 0.03)
        self.assertAlmostEqual(adjusted["emotion"], 0.06)
        self.assertAlmostEqual(adjusted["style"], 0.06)
        self.assertIsNone(adjusted["not_available"])

    def test_quadratic_weighted_agreement_is_reported_for_multiple_raters(self):
        report = analyze_blind_review_rows(
            fixture_ratings(),
            fixture_key(),
            seed=1,
            bootstrap_repetitions=100,
            permutation_repetitions=100,
        )
        agreement = report["inter_rater_agreement"]["style_fit_1_5"]
        self.assertEqual(agreement["rater_pair_count"], 1)
        self.assertEqual(agreement["defined_pair_count"], 1)
        self.assertAlmostEqual(agreement["mean"], 1.0)


    def test_paired_difference_uses_only_the_same_cases_in_both_conditions(self):
        key = [
            {"case_id": "pair-1", "response_label": "A", "variant": "personalized", "participant_id": "P01"},
            {"case_id": "pair-1", "response_label": "B", "variant": "baseline", "participant_id": "P01"},
            {"case_id": "pair-2", "response_label": "A", "variant": "personalized", "participant_id": "P01"},
            {"case_id": "pair-2", "response_label": "B", "variant": "baseline", "participant_id": "P01"},
        ]
        ratings = [
            {"rater_id": "R1", "case_id": "pair-1", "response_label": "A", "helpfulness_1_5": "3", "style_fit_1_5": "", "emotion_fit_1_5": ""},
            {"rater_id": "R1", "case_id": "pair-1", "response_label": "B", "helpfulness_1_5": "3", "style_fit_1_5": "", "emotion_fit_1_5": ""},
            # A score for personalized exists for pair-2, but baseline's
            # helpfulness score is missing. It must not enter the paired delta.
            {"rater_id": "R1", "case_id": "pair-2", "response_label": "A", "helpfulness_1_5": "5", "style_fit_1_5": "", "emotion_fit_1_5": ""},
            {"rater_id": "R1", "case_id": "pair-2", "response_label": "B", "helpfulness_1_5": "", "style_fit_1_5": "3", "emotion_fit_1_5": ""},
        ]

        report = analyze_blind_review_rows(
            ratings,
            key,
            seed=1,
            bootstrap_repetitions=100,
            permutation_repetitions=100,
        )
        metric = report["metrics"]["helpfulness_1_5"]

        self.assertEqual(metric["paired_participant_count"], 1)
        self.assertEqual(metric["paired_case_count"], 1)
        self.assertAlmostEqual(
            metric["difference_personalized_minus_baseline"]["mean"],
            0.0,
        )
        # Descriptive condition summaries still show all available scores.
        self.assertAlmostEqual(
            metric["variant_summary"]["personalized"]["mean_participant_score"],
            4.0,
        )
        self.assertAlmostEqual(
            metric["variant_summary"]["baseline"]["mean_participant_score"],
            3.0,
        )

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
