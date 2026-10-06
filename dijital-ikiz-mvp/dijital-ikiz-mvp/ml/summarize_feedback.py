from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()

    frame = pd.read_csv(args.csv_path)

    required = {"variant", "rating"}
    missing = required - set(frame.columns)
    if missing:
        raise SystemExit(f"Eksik kolonlar: {sorted(missing)}")

    frame["rating"] = pd.to_numeric(frame["rating"], errors="coerce")
    frame = frame.dropna(subset=["rating"])

    if frame.empty:
        raise SystemExit("Geçerli değerlendirme bulunamadı.")

    summary = (
        frame.groupby("variant")["rating"]
        .agg(["count", "mean", "std", "median"])
        .reset_index()
        .sort_values("variant")
    )

    print(summary.to_string(index=False))

    if set(summary["variant"]) >= {"baseline", "personalized"}:
        means = dict(zip(summary["variant"], summary["mean"]))
        print()
        print(
            "Ortalama puan farkı (personalized - baseline): "
            f"{means['personalized'] - means['baseline']:.3f}"
        )

    print()
    print("Bu özet yalnızca sağlanan değerlendirme verisini tanımlar; istatistiksel anlamlılık testi yapılmamıştır.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
