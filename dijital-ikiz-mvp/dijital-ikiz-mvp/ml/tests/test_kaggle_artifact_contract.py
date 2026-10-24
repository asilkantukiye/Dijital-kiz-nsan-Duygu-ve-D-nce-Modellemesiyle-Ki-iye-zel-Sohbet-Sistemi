from __future__ import annotations

import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = PROJECT_DIR.parents[1]
NOTEBOOK_PATH = PROJECT_DIR / "ml" / "kaggle" / "dijital_ikiz_training.ipynb"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "download-kaggle-sentiment-pilot.yml"


class KaggleArtifactContractTests(unittest.TestCase):
    def test_single_notebook_packs_all_model_tasks(self):
        notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        code = "\n".join(
            "".join(cell.get("source", []))
            for cell in notebook["cells"]
            if cell.get("cell_type") == "code"
        )
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("/artifacts/sentiment", code)
        self.assertIn("dijital-ikiz-model-artifacts", code)
        self.assertIn("vad", code)
        self.assertIn("big-five", code)
        self.assertIn("dijital-ikiz-model-artifacts.zip", workflow)
        self.assertIn("rglob(\"metrics.json\")", workflow)
        self.assertIn("metrics-summary.json", workflow)

    def test_archive_keeps_each_task_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "artifacts"
            for task in ("sentiment", "vad", "big-five"):
                directory = root / task
                directory.mkdir(parents=True)
                (directory / "metrics.json").write_text(
                    json.dumps({"task": task}), encoding="utf-8"
                )
            archive = shutil.make_archive(
                str(Path(temporary) / "test-artifact"),
                "zip",
                root_dir=str(root),
            )
            with zipfile.ZipFile(archive) as zipped:
                names = zipped.namelist()
                for task in ("sentiment", "vad", "big-five"):
                    self.assertIn(f"{task}/metrics.json", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
