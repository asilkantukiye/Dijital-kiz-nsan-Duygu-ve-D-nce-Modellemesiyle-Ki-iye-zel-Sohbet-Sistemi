from __future__ import annotations

import unittest
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from data.provenance import validate_provenance


class ProvenanceTests(unittest.TestCase):
    def test_accepts_declared_source_and_license_reference(self):
        validate_provenance(
            ["sample_id", "source", "license_or_consent"],
            [{
                "sample_id": "s-1",
                "source": "winvoker/turkish-sentiment-analysis-dataset@ef87c7a2",
                "license_or_consent": "CC BY-SA 4.0; terms reviewed on 2026-10-18",
            }],
            "fixture.csv",
        )

    def test_rejects_missing_provenance_columns(self):
        with self.assertRaisesRegex(ValueError, "kolonları eksik"):
            validate_provenance(
                ["sample_id", "source"],
                [{"sample_id": "s-1", "source": "dataset"}],
                "fixture.csv",
            )

    def test_rejects_blank_source_or_license(self):
        for row in (
            {"source": "", "license_or_consent": "CC BY-SA 4.0"},
            {"source": "dataset", "license_or_consent": "  "},
            {"source": None, "license_or_consent": "consent reference"},
        ):
            with self.assertRaises(ValueError):
                validate_provenance(["source", "license_or_consent"], [row], "fixture.csv")

    def test_rejects_unknown_or_unverified_provenance(self):
        for value in ("unknown", "license unknown", "not verified", "bilinmiyor", "doğrulanmadı", "TBD"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "doğrulanmamış/yer tutucu"):
                    validate_provenance(
                        ["source", "license_or_consent"],
                        [{"source": "dataset", "license_or_consent": value}],
                        "fixture.csv",
                    )

    def test_errors_do_not_echo_the_sensitive_source_value(self):
        secret_reference = "private-consent-record-ABC123"
        with self.assertRaises(ValueError) as context:
            validate_provenance(
                ["source", "license_or_consent"],
                [{"source": secret_reference, "license_or_consent": "unknown"}],
                "fixture.csv",
            )
        self.assertNotIn(secret_reference, str(context.exception))


if __name__ == "__main__":
    unittest.main(verbosity=2)
