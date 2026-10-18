from __future__ import annotations

import json
import re
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = PROJECT_DIR.parents[1]
NOTEBOOK_PATH = PROJECT_DIR / "ml" / "kaggle" / "sentiment_baseline.ipynb"
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "kaggle-sentiment-pilot.yml"


class KaggleArtifactContractTests(unittest.TestCase):
    def test_notebook_archive_path_matches_workflow_metrics_path(self):
        notebook = json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))
        code = "\n".join(
            "".join(cell.get("source", []))
            for cell in notebook["cells"]
            if cell.get("cell_type") == "code"
        )
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn("root_dir='/kaggle/working/artifacts'", code)
        output_dir_match = re.search(
            r"output_dir\s*=\s*Path\(['\"](/kaggle/working/artifacts/[^'\"]+)['\"]\)",
            code,
        )
        self.assertIsNotNone(output_dir_match, "Notebook output_dir sabit yolu bulunamadı.")
        output_dir = Path(output_dir_match.group(1))
        expected_metric_path = (output_dir / "metrics.json").relative_to(
            Path("/kaggle/working/artifacts")
        ).as_posix()

        unzip_match = re.search(
            r"unzip -p \"\$zip_path\" '([^']+)'",
            workflow,
        )
        self.assertIsNotNone(unzip_match, "Workflow metrics.json arşiv yolunu çıkarmıyor.")
        self.assertEqual(unzip_match.group(1), expected_metric_path)

    def test_archive_root_keeps_sentiment_folder(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "artifacts"
            sentiment = root / "sentiment"
            sentiment.mkdir(parents=True)
            (sentiment / "metrics.json").write_text('{"accuracy": 0.5}', encoding="utf-8")
            archive = shutil.make_archive(
                str(Path(temporary) / "test-artifact"),
                "zip",
                root_dir=str(root),
            )
            with zipfile.ZipFile(archive) as zipped:
                self.assertIn("sentiment/metrics.json", zipped.namelist())


if __name__ == "__main__":
    unittest.main(verbosity=2)
