from __future__ import annotations

from collections.abc import Iterable, Mapping
import unicodedata


REQUIRED_SPLITS = ("train", "validation", "test")


def _normalise_ids(values: Iterable[object], *, split: str, field: str) -> list[str]:
    result: list[str] = []
    for index, value in enumerate(values, start=1):
        if value is None:
            raise ValueError(f"{split}: {field} boş değer içeriyor (satır {index}).")
        value_text = str(value).strip()
        if value_text.casefold() in {"", "nan", "none", "null"}:
            raise ValueError(f"{split}: {field} boş değer içeriyor (satır {index}).")
        result.append(value_text)
    if not result:
        raise ValueError(f"{split}: {field} listesi boş.")
    return result


def validate_split_integrity(
    splits: Mapping[str, tuple[Iterable[object], Iterable[object]]],
) -> None:
    """Reject participant or sample leakage across train/validation/test.

    Each mapping value is (participant_ids, sample_ids). This helper deliberately
    uses only the Python standard library so CI can test it without installing
    the full ML/GPU dependency stack.
    """
    missing = [name for name in REQUIRED_SPLITS if name not in splits]
    if missing:
        raise ValueError(f"Eksik veri bölümleri: {', '.join(missing)}")

    participants_by_split: dict[str, set[str]] = {}
    samples_by_split: dict[str, set[str]] = {}

    for name in REQUIRED_SPLITS:
        participant_values, sample_values = splits[name]
        participant_ids = _normalise_ids(
            participant_values, split=name, field="participant_id"
        )
        sample_ids = _normalise_ids(sample_values, split=name, field="sample_id")

        if len(sample_ids) != len(set(sample_ids)):
            raise ValueError(f"{name}: tekrarlanan sample_id bulundu.")

        participants_by_split[name] = set(participant_ids)
        samples_by_split[name] = set(sample_ids)

    for index, left in enumerate(REQUIRED_SPLITS):
        for right in REQUIRED_SPLITS[index + 1 :]:
            participant_overlap = participants_by_split[left] & participants_by_split[right]
            if participant_overlap:
                raise ValueError(
                    f"Katılımcı sızıntısı: {left}/{right} arasında "
                    f"{len(participant_overlap)} ortak participant_id var."
                )

            sample_overlap = samples_by_split[left] & samples_by_split[right]
            if sample_overlap:
                raise ValueError(
                    f"Örnek sızıntısı: {left}/{right} arasında "
                    f"{len(sample_overlap)} ortak sample_id var."
                )



def normalize_text(value: object, *, split: str, index: int) -> str:
    """Normalize harmless Unicode, case, and whitespace differences."""
    if value is None:
        raise ValueError(f"{split}: text boş değer içeriyor (satır {index}).")
    value_text = str(value).strip()
    if value_text.casefold() in {"", "nan", "none", "null"}:
        raise ValueError(f"{split}: text boş değer içeriyor (satır {index}).")

    normalized = unicodedata.normalize("NFKC", value_text).casefold()
    normalized = " ".join(normalized.split())
    if not normalized:
        raise ValueError(f"{split}: text boş değer içeriyor (satır {index}).")
    return normalized


def validate_text_split_integrity(splits: Mapping[str, Iterable[object]]) -> None:
    """Reject exact normalized text appearing in multiple data splits.

    Text is never included in the error message. Repeated examples inside one
    split are allowed, but the same normalized example must not cross
    train/validation/test because that can inflate held-out metrics.
    """
    missing = [name for name in REQUIRED_SPLITS if name not in splits]
    if missing:
        raise ValueError(f"Eksik veri bölümleri: {', '.join(missing)}")

    texts_by_split: dict[str, set[str]] = {}
    for name in REQUIRED_SPLITS:
        values = list(splits[name])
        if not values:
            raise ValueError(f"{name}: text listesi boş.")
        normalized_values = [
            normalize_text(value, split=name, index=index)
            for index, value in enumerate(values, start=1)
        ]
        texts_by_split[name] = set(normalized_values)

    for index, left in enumerate(REQUIRED_SPLITS):
        for right in REQUIRED_SPLITS[index + 1 :]:
            overlap = texts_by_split[left] & texts_by_split[right]
            if overlap:
                raise ValueError(
                    f"Metin sızıntısı: {left}/{right} arasında "
                    f"{len(overlap)} ortak normalize edilmiş metin var. "
                    "Yinelenen metinleri tek bir bölümde tut veya yinelenen örnekleri incele."
                )
