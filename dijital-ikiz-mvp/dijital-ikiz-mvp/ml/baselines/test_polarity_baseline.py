import tempfile
import unittest
from pathlib import Path

import pandas as pd

from run_polarity_baseline import canonical_label, clean_frame, run_baseline, stratified_limit


class PolarityBaselineTests(unittest.TestCase):
    def test_canonical_label_handles_turkish_aliases(self):
        self.assertEqual(canonical_label("OLUMLU"), "positive")
        self.assertEqual(canonical_label("olumsuz"), "negative")
        self.assertEqual(canonical_label("NÖTR"), "neutral")
        self.assertIsNone(canonical_label("unknown"))

    def test_clean_frame_removes_conflicting_and_duplicate_normalized_text(self):
        frame = pd.DataFrame({
            "text": ["Same text", " same TEXT ", "Unique positive", "Unique positive", ""],
            "label": ["positive", "negative", "positive", "positive", "neutral"],
        })
        cleaned = clean_frame(frame, "test")
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned.iloc[0]["text"], "Unique positive")
        self.assertEqual(cleaned.iloc[0]["label"], "positive")

    def test_stratified_limit_is_deterministic_and_keeps_every_class(self):
        frame = pd.DataFrame({
            "text": [f"{label} example {i}" for label in ("negative", "neutral", "positive") for i in range(20)],
            "label": [label for label in ("negative", "neutral", "positive") for _ in range(20)],
            "_key": [f"{label} example {i}".casefold() for label in ("negative", "neutral", "positive") for i in range(20)],
        })
        first = stratified_limit(frame, 12, seed=19)
        second = stratified_limit(frame, 12, seed=19)
        self.assertEqual(first["text"].tolist(), second["text"].tolist())
        self.assertEqual(first["label"].value_counts().to_dict(), {"negative": 4, "neutral": 4, "positive": 4})

    def test_tfidf_baseline_emits_finite_metrics_and_all_three_classes(self):
        labels = ("negative", "neutral", "positive")
        train_rows = []
        test_rows = []
        for label in labels:
            cue = {"negative": "awful terrible", "neutral": "ordinary factual", "positive": "great wonderful"}[label]
            for index in range(90):
                train_rows.append({"text": f"{cue} training sample {index}", "label": label})
            for index in range(30):
                test_rows.append({"text": f"{cue} heldout sample {index}", "label": label})

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            train_path = root / "train.csv"
            test_path = root / "test.csv"
            pd.DataFrame(train_rows).to_csv(train_path, index=False)
            pd.DataFrame(test_rows).to_csv(test_path, index=False)

            report = run_baseline(train_path, test_path)

        metrics = report["test_metrics"]
        self.assertEqual(report["train_rows"], 243)
        self.assertEqual(report["validation_rows"], 27)
        self.assertEqual(report["test_rows"], 90)
        self.assertTrue(0 <= metrics["accuracy"] <= 1)
        self.assertTrue(0 <= metrics["f1_macro"] <= 1)
        self.assertTrue(0 <= metrics["f1_weighted"] <= 1)
        self.assertEqual(len(metrics["confusion_matrix_negative_neutral_positive"]), 3)
        self.assertEqual(set(metrics["per_class"]) - {"accuracy", "macro avg", "weighted avg"}, set(labels))


if __name__ == "__main__":
    unittest.main()
