from __future__ import annotations

import ast
import json
import unicodedata
import unittest
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
NOTEBOOK_PATH = ML_DIR / "kaggle" / "dijital_ikiz_training.ipynb"


def load_notebook():
    return json.loads(NOTEBOOK_PATH.read_text(encoding="utf-8"))


def load_split_helpers():
    notebook = load_notebook()
    source = "".join(notebook["cells"][8]["source"])
    tree = ast.parse(source)
    wanted = {"normalize_text", "group_participants_by_shared_text"}
    functions = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in wanted
    ]
    if {node.name for node in functions} != wanted:
        raise AssertionError("Kaggle notebook group-split helpers not found.")
    namespace = {"unicodedata": unicodedata}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(NOTEBOOK_PATH), "exec"), namespace)
    return namespace


def load_provenance_helper():
    notebook = load_notebook()
    source = "".join(notebook["cells"][6]["source"])
    tree = ast.parse(source)
    wanted_vars = {"PROVENANCE_FIELDS", "UNVERIFIED_MARKERS", "INVALID_VALUES"}
    assignments = []
    found_vars = set()
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = {
            target.id for target in node.targets
            if isinstance(target, ast.Name)
        }
        relevant = names & wanted_vars
        if relevant:
            assignments.append(node)
            found_vars.update(relevant)

    function = next(
        (
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "validate_provenance_rows"
        ),
        None,
    )
    if found_vars != wanted_vars or function is None:
        raise AssertionError("Kaggle notebook provenance helper/constants not found.")

    namespace = {}
    module = ast.Module(body=[*assignments, function], type_ignores=[])
    exec(compile(module, str(NOTEBOOK_PATH), "exec"), namespace)
    return namespace["validate_provenance_rows"]


def load_file_hash_helper():
    notebook = load_notebook()
    source = "".join(notebook["cells"][11]["source"])
    tree = ast.parse(source)
    function = next(
        (
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "sha256_file"
        ),
        None,
    )
    if function is None:
        raise AssertionError("Kaggle notebook sha256_file helper not found.")
    namespace = {"hashlib": __import__("hashlib"), "Path": Path}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(NOTEBOOK_PATH), "exec"), namespace)
    return namespace["sha256_file"]


class KaggleNotebookGuardrailTests(unittest.TestCase):
    def test_same_text_with_unicode_case_and_whitespace_differences_is_normalized(self):
        helpers = load_split_helpers()
        self.assertEqual(
            helpers["normalize_text"]("  ＨＥＬＬＯ   DÜNYA  "),
            "hello dünya",
        )

    def test_participants_connected_by_duplicate_text_stay_in_one_group(self):
        group_participants = load_split_helpers()["group_participants_by_shared_text"]
        rows = [
            {"participant_id": "p1", "text": "Hello   WORLD"},
            {"participant_id": "p2", "text": " hello world "},
            {"participant_id": "p2", "text": "Second text"},
            {"participant_id": "p3", "text": "SECOND   TEXT"},
            {"participant_id": "p4", "text": "independent sample"},
        ]
        self.assertEqual(
            group_participants(rows),
            [["p1", "p2", "p3"], ["p4"]],
        )

    def test_blank_text_and_participant_id_are_rejected(self):
        helpers = load_split_helpers()
        with self.assertRaisesRegex(ValueError, "Metin boş"):
            helpers["normalize_text"]("  ")
        with self.assertRaisesRegex(ValueError, "participant_id"):
            helpers["group_participants_by_shared_text"]([
                {"participant_id": " ", "text": "a real text"},
            ])

    def test_notebook_rejects_unverified_provenance_and_does_not_drop_missing_rows(self):
        notebook = load_notebook()
        validation_source = "".join(notebook["cells"][6]["source"])

        for marker in (
            "unknown", "unverified", "tbd", "bilinmiyor", "doğrulanmadı"
        ):
            self.assertIn(marker, validation_source.casefold())

        self.assertIn("license_or_consent", validation_source)
        self.assertNotIn(".dropna(", validation_source)
        self.assertIn("frame.copy()", validation_source)

    def test_provenance_helper_rejects_placeholders_and_accepts_explicit_values(self):
        validate = load_provenance_helper()
        validate([{
            "source": "Example dataset, version 2",
            "license_or_consent": "CC BY 4.0; consent confirmed in study protocol",
        }])

        bad_rows = [
            {"source": "unknown", "license_or_consent": "CC BY 4.0"},
            {"source": "Dataset v1", "license_or_consent": "TBD"},
            {"source": "unverified source", "license_or_consent": "consent approved"},
            {"source": "Bilinmiyor", "license_or_consent": "consent approved"},
            {"source": "Dataset v1", "license_or_consent": "lisans bilinmiyor"},
            {"source": "", "license_or_consent": "CC BY 4.0"},
        ]
        for row in bad_rows:
            with self.subTest(row=row):
                with self.assertRaises(ValueError):
                    validate([row], source_label="synthetic-test")

    def test_provenance_helper_rejects_placeholders_and_accepts_explicit_values(self):
        validate = load_provenance_helper()
        validate([{
            "source": "Example dataset, version 2",
            "license_or_consent": "CC BY 4.0; consent confirmed in study protocol",
        }])

        bad_rows = [
            {"source": "unknown", "license_or_consent": "CC BY 4.0"},
            {"source": "Dataset v1", "license_or_consent": "TBD"},
            {"source": "unverified source", "license_or_consent": "consent approved"},
            {"source": "Bilinmiyor", "license_or_consent": "consent approved"},
            {"source": "Dataset v1", "license_or_consent": "lisans bilinmiyor"},
            {"source": "", "license_or_consent": "CC BY 4.0"},
        ]
        for row in bad_rows:
            with self.subTest(row=row):
                with self.assertRaises(ValueError):
                    validate([row], source_label="synthetic-test")

    def test_kaggle_report_has_dataset_hashes_runtime_and_train_mean_baseline(self):
        notebook = load_notebook()
        training_source = "".join(notebook["cells"][11]["source"])

        for marker in (
            "source_file_sha256",
            "dataset_manifest",
            "model_revision_pinned",
            "platform.python_version()",
            "per_target_train_mean",
            "mae_improvement_over_train_mean_baseline",
        ):
            self.assertIn(marker, training_source)

    def test_kaggle_source_file_hash_helper_tracks_exact_file_bytes(self):
        import hashlib
        import tempfile

        digest_file = load_file_hash_helper()
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.csv"
            source.write_bytes(b"a,b\n1,2\n")
            first = digest_file(source)
            self.assertEqual(first, hashlib.sha256(source.read_bytes()).hexdigest())
            source.write_bytes(b"a,b\n1,3\n")
            self.assertNotEqual(first, digest_file(source))

    def test_notebook_contains_final_cross_split_text_leakage_assertion(self):
        notebook = load_notebook()
        split_source = "".join(notebook["cells"][8]["source"])

        self.assertIn("group_participants_by_shared_text", split_source)
        self.assertIn("normalize_text(value)", split_source)
        self.assertIn("if shared:", split_source)
        self.assertIn("metin sızıntısı", split_source.casefold())


if __name__ == "__main__":
    unittest.main(verbosity=2)
