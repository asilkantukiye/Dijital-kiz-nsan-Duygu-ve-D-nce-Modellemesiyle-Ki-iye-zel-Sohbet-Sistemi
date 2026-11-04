import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validate_training_artifacts import ArtifactValidationError, validate_artifacts  # noqa: E402


class TrainingArtifactValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sentiment_dir = self.root / "sentiment"
        self.sentiment_model = self.sentiment_dir / "model"
        self.qwen_dir = self.root / "qwen-lora"
        self.adapter_dir = self.qwen_dir / "adapter"
        self.qwen_tokenizer = self.qwen_dir / "tokenizer"
        for directory in (self.sentiment_model, self.adapter_dir, self.qwen_tokenizer):
            directory.mkdir(parents=True, exist_ok=True)

        self.sentiment = {
            "task": "Turkish sentiment polarity: negative/neutral/positive",
            "model": "dbmdz/bert-base-turkish-cased",
            "train_rows": 1500,
            "validation_rows": 150,
            "test_rows": 250,
            "train_source_sha256": "a" * 64,
            "test_source_sha256": "b" * 64,
            "test_metrics": {"accuracy": 0.81, "f1_macro": 0.79, "f1_weighted": 0.80},
        }
        self.qwen = {
            "task": "Turkish instruction SFT with QLoRA",
            "base_model": "Qwen/Qwen3-4B-Instruct-2507",
            "train_rows_encoded": 1499,
            "validation_rows_encoded": 150,
            "test_rows_encoded": 250,
            "base_model_test_loss": 3.4,
            "finetuned_model_test_loss": 3.1,
            "validation_loss": 3.2,
            "test_loss_improvement": 0.3,
        }
        self.write_json(self.sentiment_dir / "metrics.json", self.sentiment)
        self.write_json(self.qwen_dir / "metrics.json", self.qwen)
        self.write_json(self.sentiment_model / "config.json", {"model_type": "bert"})
        self.write_json(self.sentiment_model / "tokenizer_config.json", {"tokenizer_class": "BertTokenizer"})
        (self.sentiment_model / "model.safetensors").write_bytes(b"sentiment-weights")
        self.write_json(self.adapter_dir / "adapter_config.json", {"base_model_name_or_path": "Qwen/Qwen3-4B-Instruct-2507"})
        (self.adapter_dir / "adapter_model.safetensors").write_bytes(b"adapter-weights")
        self.write_json(self.qwen_tokenizer / "tokenizer_config.json", {"tokenizer_class": "Qwen2Tokenizer"})

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=True), encoding="utf-8")

    def test_valid_artifacts_pass(self):
        reports = validate_artifacts(self.root)
        self.assertIn("sentiment/metrics.json", reports)
        self.assertIn("qwen-lora/metrics.json", reports)

    def test_missing_qwen_report_fails(self):
        (self.qwen_dir / "metrics.json").unlink()
        with self.assertRaisesRegex(ArtifactValidationError, "Missing required trained-task metrics"):
            validate_artifacts(self.root)

    def test_non_finite_metric_fails(self):
        self.sentiment["test_metrics"]["accuracy"] = float("nan")
        self.write_json(self.sentiment_dir / "metrics.json", self.sentiment)
        with self.assertRaisesRegex(ArtifactValidationError, "Invalid JSON"):
            validate_artifacts(self.root)

    def test_out_of_range_f1_fails(self):
        self.sentiment["test_metrics"]["f1_macro"] = 1.2
        self.write_json(self.sentiment_dir / "metrics.json", self.sentiment)
        with self.assertRaisesRegex(ArtifactValidationError, "above the allowed maximum"):
            validate_artifacts(self.root)

    def test_loss_improvement_must_match(self):
        self.qwen["test_loss_improvement"] = 5.0
        self.write_json(self.qwen_dir / "metrics.json", self.qwen)
        with self.assertRaisesRegex(ArtifactValidationError, "does not match"):
            validate_artifacts(self.root)

    def test_qwen_weights_are_mandatory(self):
        (self.adapter_dir / "adapter_model.safetensors").unlink()
        with self.assertRaisesRegex(ArtifactValidationError, "Qwen adapter weights"):
            validate_artifacts(self.root)

    def test_provenance_hash_must_be_sha256(self):
        self.sentiment["train_source_sha256"] = "not-a-hash"
        self.write_json(self.sentiment_dir / "metrics.json", self.sentiment)
        with self.assertRaisesRegex(ArtifactValidationError, "SHA-256"):
            validate_artifacts(self.root)

    def test_empty_test_split_fails(self):
        self.sentiment["test_rows"] = 0
        self.write_json(self.sentiment_dir / "metrics.json", self.sentiment)
        with self.assertRaisesRegex(ArtifactValidationError, "test_rows"):
            validate_artifacts(self.root)


if __name__ == "__main__":
    unittest.main()
