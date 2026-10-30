import csv
import json
import tempfile
import unittest
from pathlib import Path

from ml.analyze_style_ab_scores import analyze_style_ab_scores


class StyleAbScoreAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run_dir = self.root / "run"
        self.run_dir.mkdir()

        blind = [
            {
                "case_id": "friendly-01",
                "response_1": "Yanıt A",
                "response_2": "Yanıt B",
                "prompt": "Aynı soru 1",
                "target_style": "Samimi ve gündelik",
            },
            {
                "case_id": "formal-01",
                "response_1": "Yanıt A",
                "response_2": "Yanıt B",
                "prompt": "Aynı soru 1",
                "target_style": "Resmî ve ölçülü",
            },
            {
                "case_id": "friendly-02",
                "response_1": "Yanıt A",
                "response_2": "Yanıt B",
                "prompt": "Aynı soru 2",
                "target_style": "Samimi ve gündelik",
            },
            {
                "case_id": "formal-02",
                "response_1": "Yanıt A",
                "response_2": "Yanıt B",
                "prompt": "Aynı soru 2",
                "target_style": "Resmî ve ölçülü",
            },
        ]
        (self.run_dir / "blind-evaluation.jsonl").write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in blind),
            encoding="utf-8",
        )
        key = [
            {
                "case_id": "friendly-01",
                "response_1_condition": "baseline",
                "response_2_condition": "personalized",
            },
            {
                "case_id": "formal-01",
                "response_1_condition": "personalized",
                "response_2_condition": "baseline",
            },
            {
                "case_id": "friendly-02",
                "response_1_condition": "baseline",
                "response_2_condition": "personalized",
            },
            {
                "case_id": "formal-02",
                "response_1_condition": "personalized",
                "response_2_condition": "baseline",
            },
        ]
        (self.run_dir / "condition-key.json").write_text(
            json.dumps(key), encoding="utf-8"
        )
        (self.run_dir / "run-manifest.json").write_text(
            json.dumps({"model_alias": "dijital-ikiz", "cases_completed": 4}),
            encoding="utf-8",
        )
        self.scores_path = self.root / "scores.csv"
        self.write_scores()

    def write_scores(self, rows=None, extra_columns=None):
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
        if extra_columns:
            columns.extend(extra_columns)
        if rows is None:
            rows = []
            condition_map = {
                "friendly-01": ("baseline", "personalized"),
                "formal-01": ("personalized", "baseline"),
                "friendly-02": ("baseline", "personalized"),
                "formal-02": ("personalized", "baseline"),
            }
            for evaluator in ("E01", "E02"):
                for case_id, (first_condition, _) in condition_map.items():
                    first_style = 2 if first_condition == "baseline" else 4
                    second_style = 4 if first_condition == "baseline" else 2
                    rows.append({
                        "evaluator_id": evaluator,
                        "case_id": case_id,
                        "response_1_style_fit": first_style,
                        "response_2_style_fit": second_style,
                        "response_1_relevance": 4,
                        "response_2_relevance": 4,
                        "response_1_coherence": 5,
                        "response_2_coherence": 5,
                    })

        with self.scores_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)

    def test_clustered_paired_analysis_uses_prompt_not_individual_case_as_unit(self):
        report = analyze_style_ab_scores(
            self.run_dir,
            self.scores_path,
            bootstrap_repetitions=200,
            permutation_repetitions=200,
        )

        self.assertEqual(report["cases_scored"], 4)
        self.assertEqual(report["prompt_clusters"], 2)
        self.assertEqual(report["evaluators_total"], 2)
        self.assertEqual(
            report["primary_clustered_inference"]["cluster_count"], 2
        )
        self.assertEqual(
            report["primary_clustered_inference"][
                "mean_difference_personalized_minus_baseline"
            ],
            2,
        )
        self.assertEqual(
            report["dimensions"]["relevance"]["mean_prompt_cluster_difference"],
            0,
        )

        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("E01", serialized)
        self.assertNotIn("Aynı soru", serialized)
        self.assertNotIn("Yanıt A", serialized)

    def test_rejects_one_rater_per_pair(self):
        with self.scores_path.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.write_scores(rows=[row for row in rows if row["evaluator_id"] == "E01"])

        with self.assertRaisesRegex(ValueError, "en az iki bağımsız değerlendirici"):
            analyze_style_ab_scores(self.run_dir, self.scores_path)

    def test_rejects_unapproved_columns_that_could_contain_personal_data(self):
        self.write_scores(extra_columns=["email"])

        with self.assertRaisesRegex(ValueError, "izin verilmeyen"):
            analyze_style_ab_scores(self.run_dir, self.scores_path)

    def test_rejects_condition_key_that_does_not_match_blind_cases(self):
        key_path = self.run_dir / "condition-key.json"
        key = json.loads(key_path.read_text(encoding="utf-8"))
        key.pop()
        key_path.write_text(json.dumps(key), encoding="utf-8")

        with self.assertRaisesRegex(ValueError, "kümeleri eşleşmiyor"):
            analyze_style_ab_scores(self.run_dir, self.scores_path)


if __name__ == "__main__":
    unittest.main()
