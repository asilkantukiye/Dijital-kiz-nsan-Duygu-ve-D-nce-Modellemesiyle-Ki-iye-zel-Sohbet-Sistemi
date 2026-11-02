import csv
import json
import tempfile
import unittest
from pathlib import Path

from ml.analyze_interrater_reliability import (
    analyze,
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



class InterRaterAnalysisReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir()
        blind = [
            {"case_id": "case-01", "prompt": "İlk ortak Türkçe istem"},
            {"case_id": "case-02", "prompt": "İkinci ortak Türkçe istem"},
        ]
        (self.run_dir / "blind-evaluation.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in blind),
            encoding="utf-8",
        )
        self.scores_path = self.root / "scores.csv"

    def write_scores(self, evaluators):
        columns = [
            "evaluator_id",
            "case_id",
            "response_1_style_fit",
            "response_2_style_fit",
            "response_1_relevance",
            "response_2_relevance",
            "response_1_coherence",
            "response_2_coherence",
        ]
        rows = []
        base_scores = {
            "case-01": (1, 2),
            "case-02": (4, 5),
        }
        for evaluator_index, evaluator in enumerate(evaluators):
            for case_id, (first, second) in base_scores.items():
                offset = evaluator_index % 2
                rows.append({
                    "evaluator_id": evaluator,
                    "case_id": case_id,
                    "response_1_style_fit": min(5, first + offset),
                    "response_2_style_fit": second,
                    "response_1_relevance": first,
                    "response_2_relevance": second,
                    "response_1_coherence": first,
                    "response_2_coherence": min(5, second + offset),
                })
        with self.scores_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)

    def test_two_evaluators_report_weighted_cohen_kappa(self):
        self.write_scores(["E01", "E02"])
        report = analyze(self.run_dir, self.scores_path, repetitions=200)
        for dimension in ("style_fit", "relevance", "coherence"):
            result = report["dimensions"][dimension]["quadratic_weighted_cohen_kappa"]
            self.assertEqual(result["status"], "estimated")
            self.assertEqual(result["raters"], 2)
            self.assertEqual(result["items"], 4)

    def test_three_evaluators_use_multi_rater_alpha_without_cohen_kappa(self):
        self.write_scores(["E01", "E02", "E03"])
        report = analyze(self.run_dir, self.scores_path, repetitions=200)
        for dimension in ("style_fit", "relevance", "coherence"):
            result = report["dimensions"][dimension]["quadratic_weighted_cohen_kappa"]
            self.assertEqual(result["status"], "not_applicable")
            self.assertIsNone(result["kappa"])
            self.assertEqual(
                report["dimensions"][dimension]["point_estimate"]["status"],
                "estimated",
            )


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
