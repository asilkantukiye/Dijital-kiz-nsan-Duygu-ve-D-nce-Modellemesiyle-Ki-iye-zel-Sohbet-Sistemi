from __future__ import annotations

import unittest
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = PROJECT_DIR.parents[1]
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "publish-kaggle-lora.yml"
PUBLISHER_PATH = PROJECT_DIR / "ml" / "kaggle" / "publish_lora_to_hf.py"


class KagglePublisherWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        cls.publisher = PUBLISHER_PATH.read_text(encoding="utf-8")

    def test_source_run_and_workflow_name_match_validated_training_run(self):
        self.assertIn('default: "40897581853"', self.workflow)
        self.assertIn(
            "run.workflowName !== 'Trigger Kaggle End-to-End Model Training'",
            self.workflow,
        )
        self.assertIn(
            '"source_training_workflow": "Trigger Kaggle End-to-End Model Training"',
            self.publisher,
        )

    def test_artifact_metadata_is_written_as_parseable_json(self):
        self.assertIn(
            "}), { mode: 0o600 });",
            self.workflow,
        )
        self.assertIn(
            'copy_file(scientific_report_path, release / scientific_report_path.name)',
            self.publisher,
        )
        self.assertNotIn(
            "}) + '\\\\n', { mode: 0o600 });",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
