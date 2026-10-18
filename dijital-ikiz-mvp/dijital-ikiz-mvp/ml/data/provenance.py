from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

PROVENANCE_FIELDS = ("source", "license_or_consent")
UNVERIFIED_MARKERS = (
    "unknown",
    "unspecified",
    "unverified",
    "not verified",
    "not confirmed",
    "to be determined",
    "tbd",
    "todo",
    "belirsiz",
    "bilinmiyor",
    "doğrulanmadı",
    "doğrulanmadi",
    "belirlenecek",
    "lisans yok",
    "lisans bilinmiyor",
)


def validate_provenance(
    fieldnames: Iterable[str],
    rows: Iterable[Mapping[str, Any]],
    source_label: str = "dataset",
) -> None:
    """Require non-placeholder source and license/consent descriptions per row.

    This is a fail-closed completeness check, not a legal/license verification
    service. Dataset terms and provenance still require human review.
    """
    columns = set(fieldnames)
    missing = set(PROVENANCE_FIELDS) - columns
    if missing:
        raise ValueError(
            f"{source_label}: kaynak/lisans kolonları eksik: {', '.join(sorted(missing))}"
        )

    for row_number, row in enumerate(rows, start=2):
        for field in PROVENANCE_FIELDS:
            value = str(row.get(field) or "").strip()
            normalized = value.casefold()
            if not normalized or normalized in {"nan", "none", "null", "n/a", "na"}:
                raise ValueError(
                    f"{source_label}: {field} boş olamaz (CSV satırı {row_number})."
                )

            marker = next(
                (item for item in UNVERIFIED_MARKERS if item in normalized),
                None,
            )
            if marker is not None:
                raise ValueError(
                    f"{source_label}: {field} doğrulanmamış/yer tutucu bilgi içeriyor "
                    f"(CSV satırı {row_number}); gerçek kaynak ve izin/lisans durumunu doğrula."
                )
