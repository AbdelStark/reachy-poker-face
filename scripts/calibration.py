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
HIGH_CONFIDENCE_THRESHOLD = 0.7
CUE_KEYS = {"lie_now", "implausible", "hedged", "too_specific"}


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Reject ambiguous JSONL rather than silently accepting a later value."""
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def finite_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def check_composite(statement: dict[str, Any], line_number: int) -> None:
    """Check the exported meter against its recorded inputs when available."""
    if "cues" not in statement and "weights" not in statement:
        return  # Older minimal traces cannot be recomputed.
    cues, weights = statement.get("cues"), statement.get("weights")
    if (
        not isinstance(cues, dict)
        or not isinstance(weights, dict)
        or set(cues) != CUE_KEYS
        or set(weights) != CUE_KEYS
    ):
        raise ValueError(f"line {line_number}: invalid composite evidence")
    if any(not finite_number(cues[key]) or not 0 <= cues[key] <= 1 for key in CUE_KEYS):
        raise ValueError(f"line {line_number}: invalid composite evidence")
    if any(not finite_number(weights[key]) or weights[key] < 0 for key in CUE_KEYS):
        raise ValueError(f"line {line_number}: invalid composite evidence")
    total = sum(weights.values())
    if not math.isfinite(total) or total <= 0:
        raise ValueError(f"line {line_number}: invalid composite evidence")
    expected = sum(cues[key] * weights[key] for key in CUE_KEYS) / total
    if not math.isfinite(expected) or abs(expected - statement["pLie"]) > 1e-9:
        raise ValueError(f"line {line_number}: inconsistent statement composite")


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
        if not finite_number(probability) or not 0 <= probability <= 1:
            raise ValueError(f"line {line_number}: invalid statement composite")
        check_composite(statement, line_number)
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
        if (
            type(pick.get("confidence")) not in (int, float)
            or pick["confidence"] != 0
            or pick.get("style") not in (None, "coin_flip")
            or any(
                key in pick
                for key in (
                    "model",
                    "modelCommitStyle",
                    "styleDisagrees",
                    "topCue",
                    "contradiction",
                    "thresholds",
                )
            )
        ):
            raise ValueError(
                f"line {line_number}: fallback must have no model evidence or confidence"
            )
        return "fallback", None, None, None
    model, confidence = pick.get("model"), pick.get("confidence")
    if not isinstance(model, str) or not model.strip() or len(model) > 80:
        raise ValueError(f"line {line_number}: missing model provenance")
    if not finite_number(confidence) or not 0 <= confidence <= 1:
        raise ValueError(f"line {line_number}: invalid confidence")
    if "thresholds" in pick:
        thresholds = pick["thresholds"]
        if (
            not isinstance(thresholds, dict)
            or set(thresholds) != {"hedge", "confident"}
            or any(
                not finite_number(item) or not 0 <= item <= 1
                for item in thresholds.values()
            )
            or thresholds["hedge"] >= thresholds["confident"]
        ):
            raise ValueError(f"line {line_number}: invalid commit thresholds")
        expected_style = (
            "confident"
            if confidence >= thresholds["confident"]
            else "hedge"
            if confidence >= thresholds["hedge"]
            else "coin_flip"
        )
        if pick.get("style") != expected_style:
            raise ValueError(f"line {line_number}: inconsistent rule-selected style")
    if ("modelCommitStyle" in pick or "styleDisagrees" in pick) and (
        pick.get("modelCommitStyle") not in {"confident", "hedge", "coin_flip"}
        or pick.get("style") not in {"confident", "hedge", "coin_flip"}
        or type(pick.get("styleDisagrees")) is not bool
        or pick["styleDisagrees"] is not (pick["modelCommitStyle"] != pick["style"])
    ):
        raise ValueError(f"line {line_number}: inconsistent model style evidence")
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
    high_confidence = [
        correct
        for confidence, correct in rows
        if confidence > HIGH_CONFIDENCE_THRESHOLD
    ]
    high_count = len(high_confidence)
    high_correct = sum(high_confidence)
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
        "high_confidence": {
            "threshold_exclusive": HIGH_CONFIDENCE_THRESHOLD,
            "count": high_count,
            "correct": high_correct,
            "coverage": high_count / count,
            "accuracy": high_correct / high_count if high_count else None,
            "wilson_95": wilson_interval(high_correct, high_count),
        },
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
            value = json.loads(line, object_pairs_hook=unique_object)
        except json.JSONDecodeError as exc:
            raise ValueError(f"line {number}: invalid JSON") from exc
        except ValueError as exc:
            raise ValueError(f"line {number}: {exc}") from exc
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
        "interpretation": "Descriptive, per-model final-pick diagnostics only; high-confidence uses confidence > 0.70 and is not a target pass/fail. No independently verified labels, sampling, or lie-detection claim is implied.",
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
