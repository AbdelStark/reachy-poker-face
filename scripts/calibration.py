"""Descriptive calibration from consented Poker Face JSONL exports.

Only Jev-backed final picks are scored. Random fallback rounds are counted but
excluded. This does not establish lie-detection ability or benchmark validity.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

SCHEMA = "pokerface.round@1"
IDS = {"s1", "s2", "s3"}


def parse_record(
    value: Any, line_number: int
) -> tuple[str, str | None, float | None, bool | None]:
    """Return source, model, confidence, correctness without retaining text."""
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError(f"line {line_number}: unsupported trace schema")
    statements = value.get("statements")
    if (
        not isinstance(statements, list)
        or len(statements) != 3
        or [item.get("id") if isinstance(item, dict) else None for item in statements]
        != ["s1", "s2", "s3"]
    ):
        raise ValueError(f"line {line_number}: expected three ordered statements")
    for statement in statements:
        probability = statement.get("pLie")
        if (
            isinstance(probability, bool)
            or not isinstance(probability, (int, float))
            or not math.isfinite(probability)
            or not 0 <= probability <= 1
        ):
            raise ValueError(f"line {line_number}: invalid statement composite")
    pick = value.get("pick")
    if not isinstance(pick, dict) or pick.get("source") not in {"jev", "fallback"}:
        raise ValueError(f"line {line_number}: missing pick provenance")
    choice, actual = pick.get("choice"), value.get("actualLie")
    if (
        choice not in IDS
        or actual not in IDS
        or value.get("correct") is not (choice == actual)
    ):
        raise ValueError(f"line {line_number}: invalid choice or reveal")
    if pick["source"] == "fallback":
        if pick.get("confidence") != 0 or "model" in pick:
            raise ValueError(
                f"line {line_number}: fallback must have no model confidence"
            )
        return "fallback", None, None, None
    model, confidence = pick.get("model"), pick.get("confidence")
    if not isinstance(model, str) or not model.strip() or len(model) > 80:
        raise ValueError(f"line {line_number}: missing model provenance")
    if (
        isinstance(confidence, bool)
        or not isinstance(confidence, (float, int))
        or not math.isfinite(confidence)
        or not 0 <= confidence <= 1
    ):
        raise ValueError(f"line {line_number}: invalid confidence")
    return "jev", model, float(confidence), choice == actual


def wilson_interval(successes: int, count: int) -> list[float] | None:
    if count == 0:
        return None
    z = 1.959963984540054
    p = successes / count
    denominator = 1 + z * z / count
    centre = (p + z * z / (2 * count)) / denominator
    radius = (
        z * math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator
    )
    return [max(0.0, centre - radius), min(1.0, centre + radius)]


def model_report(rows: list[tuple[float, bool]], bins: int) -> dict[str, Any]:
    count = len(rows)
    successes = sum(correct for _, correct in rows)
    reliability = []
    ece = 0.0
    for index in range(bins):
        members = [
            (confidence, correct)
            for confidence, correct in rows
            if min(int(confidence * bins), bins - 1) == index
        ]
        if not members:
            continue
        mean_confidence = sum(confidence for confidence, _ in members) / len(members)
        accuracy = sum(correct for _, correct in members) / len(members)
        ece += len(members) / count * abs(accuracy - mean_confidence)
        reliability.append(
            {
                "lower": index / bins,
                "upper": (index + 1) / bins,
                "count": len(members),
                "mean_confidence": mean_confidence,
                "accuracy": accuracy,
            }
        )
    return {
        "count": count,
        "correct": successes,
        "accuracy": successes / count,
        "wilson_95": wilson_interval(successes, count),
        "mean_confidence": sum(confidence for confidence, _ in rows) / count,
        "binary_brier": sum(
            (confidence - int(correct)) ** 2 for confidence, correct in rows
        )
        / count,
        "ece": ece,
        "reliability": reliability,
    }


def analyze(lines: list[str], bins: int = 10) -> dict[str, Any]:
    if not 2 <= bins <= 20:
        raise ValueError("bins must be between 2 and 20")
    by_model: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    fallback = 0
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {number}: invalid JSON") from exc
        source, model, confidence, correct = parse_record(value, number)
        if source == "fallback":
            fallback += 1
        else:
            assert model is not None and confidence is not None and correct is not None
            by_model[model].append((confidence, correct))
    return {
        "schema": "pokerface.calibration@1",
        "fallback_excluded": fallback,
        "bins": bins,
        "models": {
            model: model_report(rows, bins) for model, rows in sorted(by_model.items())
        },
        "interpretation": "Descriptive, per-model final-pick calibration only; not lie detection or a validated benchmark.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path, help="Poker Face session JSONL export")
    parser.add_argument("--bins", type=int, default=10, help="Reliability bins, 2..20")
    args = parser.parse_args()
    try:
        report = analyze(args.trace.read_text(encoding="utf-8").splitlines(), args.bins)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
