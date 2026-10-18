from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from data.regression_metrics import calculate_regression_metrics


class RegressionMetricsTests(unittest.TestCase):
    def test_perfect_predictions_have_zero_error_and_unit_correlations(self):
        result = calculate_regression_metrics(
            [[0.0, 0.2], [0.5, 0.4], [1.0, 0.8]],
            [[0.0, 0.2], [0.5, 0.4], [1.0, 0.8]],
            ["valence", "arousal"],
        )
        self.assertEqual(result["mae"], 0.0)
        self.assertEqual(result["rmse"], 0.0)
        self.assertAlmostEqual(result["per_label"]["valence"]["r2"], 1.0)
        self.assertAlmostEqual(result["per_label"]["valence"]["pearson_r"], 1.0)
        self.assertAlmostEqual(result["per_label"]["valence"]["spearman_rho"], 1.0)

    def test_constant_predictions_return_null_correlations_instead_of_nan(self):
        result = calculate_regression_metrics(
            [[0.0], [0.5], [1.0]],
            [[0.5], [0.5], [0.5]],
            ["valence"],
        )
        metrics = result["per_label"]["valence"]
        self.assertIsNone(metrics["pearson_r"])
        self.assertIsNone(metrics["spearman_rho"])
        self.assertAlmostEqual(metrics["mae"], 1 / 3)
        self.assertTrue(all(
            value is None or math.isfinite(value)
            for value in metrics.values()
        ))

    def test_constant_target_returns_null_r2(self):
        result = calculate_regression_metrics(
            [[0.5], [0.5], [0.5]],
            [[0.5], [0.4], [0.6]],
            ["dominance"],
        )
        self.assertIsNone(result["per_label"]["dominance"]["r2"])

    def test_spearman_uses_average_ranks_for_ties(self):
        result = calculate_regression_metrics(
            [[1.0], [1.0], [2.0], [3.0]],
            [[2.0], [2.0], [1.0], [0.0]],
            ["target"],
        )
        self.assertAlmostEqual(result["per_label"]["target"]["spearman_rho"], -1.0)

    def test_rejects_different_row_counts(self):
        with self.assertRaisesRegex(ValueError, "aynı örnek sayısı"):
            calculate_regression_metrics([[0.1], [0.2]], [[0.1]], ["valence"])

    def test_rejects_non_finite_inputs(self):
        with self.assertRaisesRegex(ValueError, "sonlu bir sayı"):
            calculate_regression_metrics([[float("nan")]], [[0.1]], ["valence"])

    def test_rejects_label_count_mismatch(self):
        with self.assertRaisesRegex(ValueError, "Etiket isimlerinin sayısı"):
            calculate_regression_metrics([[0.1, 0.2]], [[0.1, 0.2]], ["valence"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
