from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
from collections import defaultdict
from itertools import product
from pathlib import Path
from typing import Iterable, Mapping

VARIANTS = ("personalized", "baseline")


def validate_feedback_rows(rows: Iterable[Mapping[str, object]]) -> list[dict[str, object]]:
    """Validate pseudonymised ratings without retaining identifiers in the report."""
    cleaned: list[dict[str, object]] = []
    seen_message_ratings: set[tuple[str, str]] = set()

    for row_number, row in enumerate(rows, start=2):
        participant_id = str(row.get("participant_id") or "").strip()
        variant = str(row.get("variant") or "").strip().lower()
        raw_rating = str(row.get("rating") if row.get("rating") is not None else "").strip()

        if not participant_id:
            raise ValueError(
                f"CSV satırı {row_number}: participant_id boş olamaz; önce takma ada çevir."
            )
        if variant not in VARIANTS:
            raise ValueError(
                f"CSV satırı {row_number}: variant personalized veya baseline olmalı."
            )
        try:
            rating = int(raw_rating)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"CSV satırı {row_number}: rating 1–5 arasında tam sayı olmalı."
            ) from exc
        if str(rating) != raw_rating or not 1 <= rating <= 5:
            raise ValueError(
                f"CSV satırı {row_number}: rating 1–5 arasında tam sayı olmalı."
            )

        # Optional message_id is used only for duplicate checks, never output.
        message_id = str(row.get("message_id") or "").strip()
        if message_id:
            key = (participant_id, message_id)
            if key in seen_message_ratings:
                raise ValueError(
                    f"CSV satırı {row_number}: aynı participant_id/message_id birden fazla kez var."
                )
            seen_message_ratings.add(key)

        cleaned.append({
            "participant_id": participant_id,
            "variant": variant,
            "rating": rating,
        })

    if not cleaned:
        raise ValueError("CSV içinde geçerli geri bildirim satırı bulunamadı.")
    return cleaned


def _quantile(sorted_values: list[float], probability: float) -> float:
    """Linear-interpolated quantile for an already sorted, non-empty sequence."""
    if not sorted_values:
        raise ValueError("Quantile için en az bir değer gerekli.")
    if len(sorted_values) == 1:
        return sorted_values[0]
    position = (len(sorted_values) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = position - lower
    return sorted_values[lower] * (1 - fraction) + sorted_values[upper] * fraction


def bootstrap_mean_ci(
    differences: list[float],
    *,
    seed: int = 42,
    repetitions: int = 10_000,
) -> list[float] | None:
    if not differences:
        return None
    if repetitions < 100:
        raise ValueError("Bootstrap repetitions en az 100 olmalı.")

    rng = random.Random(seed)
    count = len(differences)
    estimates = [
        statistics.mean(rng.choice(differences) for _ in range(count))
        for _ in range(repetitions)
    ]
    estimates.sort()
    return [
        _quantile(estimates, 0.025),
        _quantile(estimates, 0.975),
    ]


def sign_flip_permutation_test(
    differences: list[float],
    *,
    seed: int = 42,
    repetitions: int = 10_000,
) -> dict[str, object] | None:
    """Two-sided paired sign-flip test; exact through n=15, Monte Carlo otherwise."""
    if not differences:
        return None

    observed = abs(statistics.mean(differences))
    epsilon = 1e-12
    count = len(differences)

    if count <= 15:
        extreme = 0
        total = 2**count
        for signs in product((-1, 1), repeat=count):
            permuted_mean = abs(
                sum(delta * sign for delta, sign in zip(differences, signs)) / count
            )
            if permuted_mean + epsilon >= observed:
                extreme += 1
        return {
            "method": "exact paired sign-flip permutation",
            "p_value_two_sided": extreme / total,
            "permutations": total,
        }

    if repetitions < 100:
        raise ValueError("Monte Carlo repetitions en az 100 olmalı.")
    rng = random.Random(seed)
    extreme = 0
    for _ in range(repetitions):
        permuted_mean = abs(
            sum(delta * rng.choice((-1, 1)) for delta in differences) / count
        )
        if permuted_mean + epsilon >= observed:
            extreme += 1
    return {
        "method": "Monte Carlo paired sign-flip permutation",
        "p_value_two_sided": (extreme + 1) / (repetitions + 1),
        "permutations": repetitions,
    }


def analyze_feedback_rows(
    rows: Iterable[Mapping[str, object]],
    *,
    seed: int = 42,
    bootstrap_repetitions: int = 10_000,
    permutation_repetitions: int = 10_000,
) -> dict[str, object]:
    cleaned = validate_feedback_rows(rows)
    ratings_by_participant: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: {variant: [] for variant in VARIANTS}
    )

    for row in cleaned:
        ratings_by_participant[str(row["participant_id"])][str(row["variant"])].append(
            int(row["rating"])
        )

    participant_means: dict[str, dict[str, float]] = {}
    for participant_id, condition_ratings in ratings_by_participant.items():
        participant_means[participant_id] = {
            variant: statistics.mean(values)
            for variant, values in condition_ratings.items()
            if values
        }

    variant_summary: dict[str, dict[str, object]] = {}
    for variant in VARIANTS:
        means = [
            condition_means[variant]
            for condition_means in participant_means.values()
            if variant in condition_means
        ]
        variant_summary[variant] = {
            "rating_rows": sum(
                len(values[variant]) for values in ratings_by_participant.values()
            ),
            "participants_with_ratings": len(means),
            "mean_participant_rating": statistics.mean(means) if means else None,
            "median_participant_rating": statistics.median(means) if means else None,
        }

    complete_ids = [
        participant_id
        for participant_id, means in participant_means.items()
        if all(variant in means for variant in VARIANTS)
    ]
    differences = [
        participant_means[participant_id]["personalized"]
        - participant_means[participant_id]["baseline"]
        for participant_id in complete_ids
    ]

    mean_difference = statistics.mean(differences) if differences else None
    median_difference = statistics.median(differences) if differences else None
    ci = (
        bootstrap_mean_ci(
            differences,
            seed=seed,
            repetitions=bootstrap_repetitions,
        )
        if differences else None
    )
    permutation = (
        sign_flip_permutation_test(
            differences,
            seed=seed,
            repetitions=permutation_repetitions,
        )
        if differences else None
    )

    warnings = [
        "Bu analiz algılanan yanıt puanlarını özetler; psikolojik fayda, kişilik kopyalama doğruluğu veya VAD doğruluğu ölçmez.",
        "Koşullar aynı istemlerle ve uygun rastgele atamayla uygulanmadıysa fark nedensel kişiselleştirme etkisi olarak yorumlanmamalıdır.",
        "Katılımcı kimlikleri takma ada çevrilmiş olmalı; ham Supabase user_id, mesaj metni, yorum, e-posta veya başka tanımlayıcı bilgileri CSV'ye ekleme.",
    ]
    if len(complete_ids) < 10:
        warnings.append(
            "Her iki koşulu da puanlayan 10'dan az katılımcı var; sonuç yalnızca öncül/tanımlayıcı bulgu olarak sunulmalı."
        )
    elif len(complete_ids) < 30:
        warnings.append(
            "Katılımcı sayısı küçük; güven aralığı ve p-değeri temkinli yorumlanmalı."
        )

    return {
        "analysis_type": "exploratory within-participant rating comparison",
        "rating_scale": "1-5",
        "participants_total": len(ratings_by_participant),
        "paired_participants": len(complete_ids),
        "participants_with_baseline_only": sum(
            "baseline" in means and "personalized" not in means
            for means in participant_means.values()
        ),
        "participants_with_personalized_only": sum(
            "personalized" in means and "baseline" not in means
            for means in participant_means.values()
        ),
        "variant_summary": variant_summary,
        "paired_difference_personalized_minus_baseline": {
            "mean": mean_difference,
            "median": median_difference,
            "bootstrap_95_percent_ci_mean": ci,
            "permutation_test": permutation,
        },
        "warnings": warnings,
        "scientific_note": (
            "Positive difference means higher user ratings for personalized responses. "
            "Only participants who rated both variants contribute to the paired difference."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Exploratory analysis of pseudonymised personalized/baseline response ratings."
    )
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("--output", type=Path, default=Path("feedback_analysis.json"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-repetitions", type=int, default=10_000)
    parser.add_argument("--permutation-repetitions", type=int, default=10_000)
    args = parser.parse_args()

    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"participant_id", "variant", "rating"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"Eksik kolonlar: {', '.join(sorted(missing))}")
        rows = list(reader)

    try:
        report = analyze_feedback_rows(
            rows,
            seed=args.seed,
            bootstrap_repetitions=args.bootstrap_repetitions,
            permutation_repetitions=args.permutation_repetitions,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Rapor: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
