import unittest

from ml.analyze_interrater_reliability import (
    clustered_bootstrap_ci,
    krippendorff_alpha_ordinal,
    quadratic_weighted_cohen_kappa,
)


class QuadraticWeightedCohenKappaTests(unittest.TestCase):
    def test_perfect_agreement_with_score_variation(self):
        result = quadratic_weighted_cohen_kappa([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
        self.assertEqual(result["status"], "estimated")
        self.assertAlmostEqual(result["kappa"], 1.0, places=12)
        self.assertEqual(result["weighting"], "quadratic")

    def test_weighted_disagreement_is_below_one(self):
        result = quadratic_weighted_cohen_kappa([1, 2, 3, 4, 5], [2, 2, 4, 4, 5])
        self.assertEqual(result["status"], "estimated")
        self.assertLess(result["kappa"], 1.0)

    def test_zero_expected_disagreement_is_not_estimable(self):
        result = quadratic_weighted_cohen_kappa([3, 3, 3], [3, 3, 3])
        self.assertEqual(result["status"], "not_estimable")
        self.assertIsNone(result["kappa"])

    def test_requires_paired_rating_lengths(self):
        with self.assertRaisesRegex(ValueError, "same number of items"):
            quadratic_weighted_cohen_kappa([1, 2], [1])

    def test_rejects_scores_outside_likert_scale(self):
        with self.assertRaisesRegex(ValueError, "integer ratings from 1 to 5"):
            quadratic_weighted_cohen_kappa([1, 6], [1, 5])


class OrdinalKrippendorffAlphaTests(unittest.TestCase):
    def test_perfect_agreement_with_score_variation(self):
        result = krippendorff_alpha_ordinal({
            "u1": [1, 1, 1], "u2": [2, 2, 2], "u3": [3, 3, 3],
            "u4": [4, 4, 4], "u5": [5, 5, 5],
        })
        self.assertEqual(result["status"], "estimated")
        self.assertAlmostEqual(result["alpha"], 1.0, places=12)

    def test_disagreement_is_below_one(self):
        result = krippendorff_alpha_ordinal({
            "u1": [1, 2, 2], "u2": [2, 3, 2], "u3": [3, 4, 3],
            "u4": [4, 5, 4], "u5": [5, 4, 5],
        })
        self.assertEqual(result["status"], "estimated")
        self.assertLess(result["alpha"], 1.0)

    def test_zero_expected_disagreement_is_not_estimable(self):
        result = krippendorff_alpha_ordinal({"u1": [3, 3], "u2": [3, 3, 3]})
        self.assertEqual(result["status"], "not_estimable")
        self.assertIsNone(result["alpha"])

    def test_cluster_bootstrap_ci(self):
        units, clusters = {}, {}
        for prompt in range(1, 8):
            for profile in range(1, 4):
                case = f"p{prompt}-s{profile}"
                for response in (1, 2):
                    item = f"{case}::r{response}"
                    units[item] = [1 + prompt % 5, 1 + prompt % 5]
                    clusters[item] = str(prompt)
        result = clustered_bootstrap_ci(units, clusters, seed=7, repetitions=300)
        self.assertEqual(result["status"], "estimated")
        self.assertLessEqual(result["lower"], result["upper"])
        self.assertEqual(result["clusters"], 7)

    def test_one_cluster_has_no_interval(self):
        result = clustered_bootstrap_ci({"u1": [1, 1]}, {"u1": "only"}, repetitions=300)
        self.assertEqual(result["status"], "not_estimable")


if __name__ == "__main__":
    unittest.main()
