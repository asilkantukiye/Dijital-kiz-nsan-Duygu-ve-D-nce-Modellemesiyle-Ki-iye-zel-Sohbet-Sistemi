from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any


def _matrix(values: Sequence[Sequence[object]], name: str) -> list[list[float]]:
    if not values:
        raise ValueError(f"{name} boş olamaz.")

    result: list[list[float]] = []
    width: int | None = None
    for row_index, row in enumerate(values, start=1):
        if not isinstance(row, (list, tuple)) or not row:
            raise ValueError(f"{name} satır {row_index} geçerli bir hedef listesi olmalı.")
        converted: list[float] = []
        for column_index, raw in enumerate(row, start=1):
            try:
                value = float(raw)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"{name} satır {row_index}, kolon {column_index} sayısal olmalı."
                ) from exc
            if not math.isfinite(value):
                raise ValueError(
                    f"{name} satır {row_index}, kolon {column_index} sonlu bir sayı olmalı."
                )
            converted.append(value)

        if width is None:
            width = len(converted)
        elif len(converted) != width:
            raise ValueError(f"{name} satırlarının hedef sayısı aynı olmalı.")
        result.append(converted)

    return result


def _average_ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        # Ranks are 1-based. Equal values receive the mean of their tied ranks.
        average_rank = ((start + 1) + end) / 2
        for position in range(start, end):
            ranks[order[position]] = average_rank
        start = end
    return ranks


def _correlation(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    mean_left = sum(left) / len(left)
    mean_right = sum(right) / len(right)
    centered_left = [value - mean_left for value in left]
    centered_right = [value - mean_right for value in right]
    ss_left = sum(value * value for value in centered_left)
    ss_right = sum(value * value for value in centered_right)
    if ss_left <= 0 or ss_right <= 0:
        return None
    numerator = sum(a * b for a, b in zip(centered_left, centered_right))
    value = numerator / math.sqrt(ss_left * ss_right)
    if not math.isfinite(value):
        return None
    return max(-1.0, min(1.0, value))


def _single_target_metrics(
    actual: Sequence[float],
    predicted: Sequence[float],
) -> dict[str, float | None]:
    errors = [prediction - target for target, prediction in zip(actual, predicted)]
    absolute_errors = [abs(error) for error in errors]
    squared_errors = [error * error for error in errors]
    mae = sum(absolute_errors) / len(errors)
    rmse = math.sqrt(sum(squared_errors) / len(errors))

    target_mean = sum(actual) / len(actual)
    total_sum_squares = sum((target - target_mean) ** 2 for target in actual)
    residual_sum_squares = sum(squared_errors)
    r2 = (
        1 - residual_sum_squares / total_sum_squares
        if total_sum_squares > 0
        else None
    )
    pearson = _correlation(actual, predicted)
    spearman = _correlation(_average_ranks(actual), _average_ranks(predicted))

    return {
        "mae": mae,
        "rmse": rmse,
        "r2": r2,
        "pearson_r": pearson,
        "spearman_rho": spearman,
    }


def calculate_regression_metrics(
    y_true: Sequence[Sequence[object]],
    y_pred: Sequence[Sequence[object]],
    labels: Sequence[str],
) -> dict[str, Any]:
    """Calculate multi-target regression metrics with safe undefined correlations."""
    true_matrix = _matrix(y_true, "y_true")
    pred_matrix = _matrix(y_pred, "y_pred")

    if len(true_matrix) != len(pred_matrix):
        raise ValueError("y_true ve y_pred aynı örnek sayısına sahip olmalı.")
    if len(true_matrix[0]) != len(pred_matrix[0]):
        raise ValueError("y_true ve y_pred aynı hedef sayısına sahip olmalı.")
    if len(labels) != len(true_matrix[0]):
        raise ValueError("Etiket isimlerinin sayısı hedef kolonlarıyla eşleşmeli.")

    absolute_errors: list[float] = []
    squared_errors: list[float] = []
    per_label: dict[str, dict[str, float | None]] = {}

    for column_index, label in enumerate(labels):
        actual = [row[column_index] for row in true_matrix]
        predicted = [row[column_index] for row in pred_matrix]
        per_label[str(label)] = _single_target_metrics(actual, predicted)
        for target, prediction in zip(actual, predicted):
            error = prediction - target
            absolute_errors.append(abs(error))
            squared_errors.append(error * error)

    return {
        "mae": sum(absolute_errors) / len(absolute_errors),
        "rmse": math.sqrt(sum(squared_errors) / len(squared_errors)),
        "per_label": per_label,
    }
