from __future__ import annotations

import sys
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from analyze_feedback import analyze_feedback_rows, sign_flip_permutation_test


class FeedbackAnalysisTests(unittest.TestCase):
    def test_computes_paired_mean_difference_without_emitting_identifiers(self):
        rows = [
            {"participant_id": "p1", "variant": "baseline", "rating": "2"},
            {"participant_id": "p1", "variant": "baseline", "rating": "4"},
            {"participant_id": "p1", "variant": "personalized", "rating": "4"},
            {"participant_id": "p1", "variant": "personalized", "rating": "4"},
            {"participant_id": "p2", "variant": "baseline", "rating": "3"},
            {"participant_id": "p2", "variant": "personalized", "rating": "5"},
            {"participant_id": "p3", "variant": "baseline", "rating": "2"},
        ]
        report = analyze_feedback_rows(
            rows, seed=7, bootstrap_repetitions=500, permutation_repetitions=500
        )

        self.assertEqual(report["participants_total"], 3)
        self.assertEqual(report["paired_participants"], 2)
        self.assertAlmostEqual(
            report["paired_difference_personalized_minus_baseline"]["mean"],
            1.5,
        )
        self.assertEqual(report["participants_with_baseline_only"], 1)
        self.assertNotIn("participant_ids", report)
        self.assertNotIn("p1", str(report))

    def test_returns_none_for_paired_statistics_when_no_participant_rates_both(self):
        report = analyze_feedback_rows([
            {"participant_id": "p1", "variant": "baseline", "rating": 4},
            {"participant_id": "p2", "variant": "personalized", "rating": 5},
        ])
        paired = report["paired_difference_personalized_minus_baseline"]
        self.assertIsNone(paired["mean"])
        self.assertIsNone(paired["bootstrap_95_percent_ci_mean"])
        self.assertIsNone(paired["permutation_test"])
        self.assertEqual(report["paired_participants"], 0)

    def test_rejects_invalid_rating(self):
        with self.assertRaisesRegex(ValueError, "rating 1–5"):
            analyze_feedback_rows([
                {"participant_id": "p1", "variant": "baseline", "rating": 6}
            ])

    def test_rejects_unknown_variant(self):
        with self.assertRaisesRegex(ValueError, "variant personalized"):
            analyze_feedback_rows([
                {"participant_id": "p1", "variant": "control", "rating": 3}
            ])

    def test_rejects_blank_participant_alias(self):
        with self.assertRaisesRegex(ValueError, "participant_id boş"):
            analyze_feedback_rows([
                {"participant_id": "", "variant": "baseline", "rating": 3}
            ])

    def test_rejects_duplicate_message_rating_when_message_id_provided(self):
        rows = [
            {"participant_id": "p1", "variant": "baseline", "rating": 3, "message_id": "m1"},
            {"participant_id": "p1", "variant": "baseline", "rating": 4, "message_id": "m1"},
        ]
        with self.assertRaisesRegex(ValueError, "message_id birden fazla"):
            analyze_feedback_rows(rows)

    def test_exact_permutation_test_is_two_sided(self):
        result = sign_flip_permutation_test([1.0, 1.0], seed=42)
        self.assertEqual(result["method"], "exact paired sign-flip permutation")
        self.assertAlmostEqual(result["p_value_two_sided"], 0.5)
        self.assertEqual(result["permutations"], 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
