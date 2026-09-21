"""Synthetic schema tests only; no Jev performance data is used."""

from __future__ import annotations

import json
import unittest

from calibration import analyze, parse_record, wilson_interval


def record(
    choice: str, actual: str, confidence: float = 0.8, model: str = "fixture"
) -> str:
    return json.dumps(
        {
            "schema": "pokerface.round@1",
            "statements": [{"id": f"s{index}", "pLie": 0.5} for index in range(1, 4)],
            "pick": {
                "source": "jev",
                "choice": choice,
                "confidence": confidence,
                "model": model,
            },
            "actualLie": actual,
            "correct": choice == actual,
        }
    )


class CalibrationTests(unittest.TestCase):
    def test_per_model_accuracy_and_reliability(self) -> None:
        lines = [
            record("s2", "s2", 0.8),
            record("s1", "s3", 0.6),
            record("s3", "s3", 0.9, "other"),
        ]
        report = analyze(lines, bins=5)
        self.assertEqual(report["schema"], "pokerface.calibration@1")
        self.assertEqual(report["models"]["fixture"]["count"], 2)
        self.assertEqual(report["models"]["fixture"]["accuracy"], 0.5)
        selected = report["models"]["fixture"]["high_confidence"]
        self.assertEqual(selected["threshold_exclusive"], 0.7)
        self.assertEqual((selected["count"], selected["correct"]), (1, 1))
        self.assertEqual((selected["coverage"], selected["accuracy"]), (0.5, 1.0))
        self.assertEqual(report["models"]["other"]["high_confidence"]["count"], 1)
        self.assertAlmostEqual(report["models"]["fixture"]["binary_brier"], 0.2)
        self.assertEqual(report["models"]["other"]["count"], 1)
        self.assertEqual(
            sum(bin_["count"] for bin_ in report["models"]["fixture"]["reliability"]), 2
        )
        self.assertLessEqual(report["models"]["fixture"]["wilson_95"][0], 0.5)
        self.assertGreaterEqual(report["models"]["fixture"]["wilson_95"][1], 0.5)

    def test_high_confidence_is_strictly_above_point_seven_and_empty_is_null(
        self,
    ) -> None:
        report = analyze(
            [
                record("s1", "s1", 0.7),
                record("s1", "s2", 0.700001),
                record("s2", "s2", 1.0),
                record("s3", "s1", 0.4, "low-only"),
            ]
        )
        selected = report["models"]["fixture"]["high_confidence"]
        self.assertEqual((selected["count"], selected["correct"]), (2, 1))
        self.assertAlmostEqual(selected["coverage"], 2 / 3)
        self.assertEqual(selected["accuracy"], 0.5)
        self.assertLessEqual(selected["wilson_95"][0], 0.5)
        self.assertGreaterEqual(selected["wilson_95"][1], 0.5)
        empty = report["models"]["low-only"]["high_confidence"]
        self.assertEqual(empty["count"], 0)
        self.assertEqual(empty["coverage"], 0)
        self.assertIsNone(empty["accuracy"])
        self.assertIsNone(empty["wilson_95"])

    def test_fallback_is_counted_but_not_calibrated(self) -> None:
        fallback = json.dumps(
            {
                "schema": "pokerface.round@1",
                "statements": [
                    {"id": f"s{index}", "pLie": 0.5} for index in range(1, 4)
                ],
                "pick": {"source": "fallback", "choice": "s1", "confidence": 0},
                "actualLie": "s2",
                "correct": False,
            }
        )
        report = analyze([fallback])
        self.assertEqual(report["fallback_excluded"], 1)
        self.assertEqual(report["models"], {})
        self.assertIsNone(wilson_interval(0, 0))

    def test_fallback_cannot_smuggle_model_evidence_or_bool_confidence(self) -> None:
        fallback = {
            "schema": "pokerface.round@1",
            "statements": [{"id": f"s{index}", "pLie": 0.5} for index in range(1, 4)],
            "pick": {
                "source": "fallback",
                "choice": "s1",
                "confidence": 0,
                "style": "coin_flip",
            },
            "actualLie": "s2",
            "correct": False,
        }
        for bad_pick in (
            {"confidence": False},
            {"style": "confident"},
            {"topCue": "hedging"},
            {"thresholds": {"confident": 0.7}},
        ):
            with self.subTest(bad_pick=bad_pick):
                value = {**fallback, "pick": {**fallback["pick"], **bad_pick}}
                with self.assertRaisesRegex(ValueError, "fallback must have no model"):
                    parse_record(value, 1)

    def test_malformed_or_mislabelled_data_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid JSON"):
            analyze(["not-json"])
        with self.assertRaisesRegex(ValueError, "invalid choice or reveal"):
            parse_record(json.loads(record("s1", "s2")) | {"correct": True}, 1)
        with self.assertRaisesRegex(ValueError, "invalid confidence"):
            analyze([record("s1", "s1", float("nan"))])
        duplicate = record("s1", "s1").replace(
            '"confidence": 0.8', '"confidence": 0.8, "confidence": 0.1'
        )
        with self.assertRaisesRegex(ValueError, "line 1: duplicate JSON key"):
            analyze([duplicate])
        with self.assertRaisesRegex(ValueError, "bins"):
            analyze([], bins=1)


if __name__ == "__main__":
    unittest.main()
