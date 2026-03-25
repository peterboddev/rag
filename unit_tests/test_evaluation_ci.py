"""
CI/CD Evaluation Test Suite

Runs evaluations against a fixed test dataset of claim summaries using
the Strands Evals SDK (OutputEvaluator) when available, falling back to
FaithfulnessEvaluator, CompletenessEvaluator, and AnomalyAccuracyEvaluator
directly (no AgentCore service dependency). Asserts scores meet configurable
thresholds and produces a JSON report.

REQUIRES: AWS Bedrock access (calls real LLM for evaluation scoring).
Run separately from unit tests using: pytest -m evaluation unit_tests/test_evaluation_ci.py

Environment Variable Overrides for Thresholds:
    EVAL_THRESHOLD_FAITHFULNESS: float (default from get_score_thresholds)
    EVAL_THRESHOLD_COMPLETENESS: float (default from get_score_thresholds)
    EVAL_THRESHOLD_ANOMALY_ACCURACY: float (default from get_score_thresholds)

Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
"""

import json
import os
import logging
from pathlib import Path
from datetime import datetime, timezone

import pytest

from evaluators.faithfulness_evaluator import FaithfulnessEvaluator, FAITHFULNESS_PROMPT
from evaluators.completeness_evaluator import CompletenessEvaluator, COMPLETENESS_PROMPT
from evaluators.anomaly_accuracy_evaluator import AnomalyAccuracyEvaluator, ANOMALY_ACCURACY_PROMPT
from evaluators.evaluation_config import get_score_thresholds

logger = logging.getLogger(__name__)

# Conditional import for strands-agents-evals SDK
try:
    from strands_evals import Case, Experiment
    from strands_evals.evaluators import OutputEvaluator
    from strands_evals.types import EvaluationData
    _STRANDS_EVALS_AVAILABLE = True
except ImportError:
    _STRANDS_EVALS_AVAILABLE = False
    logger.warning("strands-agents-evals not installed, using custom evaluator fallback for CI")

HELPFULNESS_PROMPT = """Evaluate the helpfulness of this insurance claim summary.
Score 1.0 if the summary is clear, actionable, and provides all information needed for claim processing.
Score 0.5 if the summary is partially helpful but missing some useful details.
Score 0.0 if the summary is unhelpful or confusing."""

# Paths
TEST_DATA_PATH = Path(__file__).resolve().parent.parent / "evaluators" / "test_data" / "test_cases.json"
REPORT_PATH = Path(__file__).resolve().parent.parent / "evaluators" / "test_data" / "evaluation_report.json"


def _load_test_cases() -> list[dict]:
    """Load test cases from the test dataset JSON file."""
    with open(TEST_DATA_PATH, "r") as f:
        data = json.load(f)
    return data["test_cases"]


def _get_thresholds() -> dict[str, float]:
    """
    Get score thresholds with environment variable overrides.

    Environment variables take precedence over defaults from
    get_score_thresholds().
    """
    thresholds = get_score_thresholds()

    env_overrides = {
        "faithfulness": "EVAL_THRESHOLD_FAITHFULNESS",
        "completeness": "EVAL_THRESHOLD_COMPLETENESS",
        "anomaly_accuracy": "EVAL_THRESHOLD_ANOMALY_ACCURACY",
    }

    for key, env_var in env_overrides.items():
        val = os.environ.get(env_var)
        if val is not None:
            thresholds[key] = float(val)

    return thresholds


def _evaluate_test_case(test_case: dict) -> dict:
    """
    Run all evaluators on a single test case and return scores.

    Uses the Strands Evals SDK (OutputEvaluator with rubrics) when
    available, falling back to custom evaluator classes otherwise.

    Args:
        test_case: A test case dict from the test dataset.

    Returns:
        dict with faithfulness, completeness, anomaly_accuracy scores
        and their reasoning.

    Requirements: 5.1, 5.2, 5.3, 5.6
    """
    summary = test_case["summary"]
    source_documents = test_case["source_documents"]
    anomalies = test_case.get("anomalies", [])

    if _STRANDS_EVALS_AVAILABLE:
        # SDK path: use OutputEvaluator instances with rubrics
        faithfulness_evaluator = OutputEvaluator(rubric=FAITHFULNESS_PROMPT, include_inputs=True)
        completeness_evaluator = OutputEvaluator(rubric=COMPLETENESS_PROMPT, include_inputs=True)
        anomaly_evaluator = OutputEvaluator(rubric=ANOMALY_ACCURACY_PROMPT, include_inputs=True)

        # Evaluate each metric
        faith_data = EvaluationData(actual_output=summary, input=source_documents)
        faith_output = faithfulness_evaluator.evaluate(faith_data)

        comp_data = EvaluationData(actual_output=summary, input=source_documents)
        comp_output = completeness_evaluator.evaluate(comp_data)

        anomaly_text = json.dumps(anomalies, indent=2) if anomalies else "[]"
        anomaly_data = EvaluationData(actual_output=summary, input=anomaly_text)
        anomaly_output = anomaly_evaluator.evaluate(anomaly_data)

        return {
            "faithfulness": max(0.0, min(1.0, float(faith_output.score))),
            "faithfulness_reasoning": getattr(faith_output, "reason", "") or "",
            "completeness": max(0.0, min(1.0, float(comp_output.score))),
            "completeness_reasoning": getattr(comp_output, "reason", "") or "",
            "anomaly_accuracy": max(0.0, min(1.0, float(anomaly_output.score))),
            "anomaly_accuracy_reasoning": getattr(anomaly_output, "reason", "") or "",
        }
    else:
        # Fallback path: use existing custom evaluator classes
        logger.warning("Using custom evaluator fallback for CI evaluation")

        faithfulness_eval = FaithfulnessEvaluator()
        completeness_eval = CompletenessEvaluator()
        anomaly_eval = AnomalyAccuracyEvaluator()

        faithfulness_result = faithfulness_eval.evaluate(
            summary=summary,
            source_documents=source_documents,
        )

        completeness_result = completeness_eval.evaluate(summary=summary)

        anomaly_result = anomaly_eval.evaluate(
            anomalies=anomalies,
            source_documents=source_documents,
        )

        return {
            "faithfulness": faithfulness_result["score"],
            "faithfulness_reasoning": faithfulness_result.get("reasoning", ""),
            "completeness": completeness_result["score"],
            "completeness_reasoning": completeness_result.get("reasoning", ""),
            "anomaly_accuracy": anomaly_result["score"],
            "anomaly_accuracy_reasoning": anomaly_result.get("reasoning", ""),
        }


def _check_pass_fail(scores: dict, thresholds: dict, test_case: dict) -> list[str]:
    """
    Check whether scores meet thresholds for a test case.

    For test cases with no anomalies, the anomaly_accuracy threshold
    check is skipped (score 0.0 is expected).

    Args:
        scores: Evaluated scores dict.
        thresholds: Threshold dict from _get_thresholds().
        test_case: The original test case for context.

    Returns:
        List of failure message strings (empty if all pass).
    """
    failures = []
    anomalies = test_case.get("anomalies", [])

    for metric in ("faithfulness", "completeness"):
        threshold = thresholds.get(metric, 0.0)
        actual = scores.get(metric, 0.0)
        if actual < threshold:
            failures.append(
                f"{metric} score {actual:.3f} below threshold {threshold:.3f}"
            )

    # Only check anomaly_accuracy threshold when anomalies are present
    if anomalies:
        threshold = thresholds.get("anomaly_accuracy", 0.0)
        actual = scores.get("anomaly_accuracy", 0.0)
        if actual < threshold:
            failures.append(
                f"anomaly_accuracy score {actual:.3f} below threshold {threshold:.3f}"
            )

    return failures


def _build_report(results: list[dict]) -> dict:
    """
    Build the JSON evaluation report.

    Args:
        results: List of per-test-case result dicts.

    Returns:
        Report dict with test_cases, overall_status, and evaluated_at.
    """
    any_failure = any(r.get("failures") for r in results)

    return {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "overall_status": "fail" if any_failure else "pass",
        "thresholds": _get_thresholds(),
        "test_cases": results,
    }


def _write_report(report: dict) -> None:
    """Write the evaluation report JSON to disk."""
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
    logger.info(f"Evaluation report written to {REPORT_PATH}")


# ---------------------------------------------------------------------------
# Pytest tests
# ---------------------------------------------------------------------------

@pytest.mark.evaluation
class TestEvaluationCI:
    """CI/CD evaluation tests that invoke real Bedrock evaluators."""

    def test_evaluation_pipeline(self):
        """
        Run all evaluators against the test dataset, assert thresholds,
        and produce a JSON report.
        """
        test_cases = _load_test_cases()
        thresholds = _get_thresholds()
        all_results = []
        all_failures = []

        for tc in test_cases:
            tc_id = tc["id"]
            logger.info(f"Evaluating test case {tc_id} ({tc['strategy']})...")

            try:
                scores = _evaluate_test_case(tc)
                failures = _check_pass_fail(scores, thresholds, tc)
            except Exception as e:
                scores = {
                    "faithfulness": 0.0,
                    "completeness": 0.0,
                    "anomaly_accuracy": 0.0,
                }
                failures = [f"Evaluation error: {str(e)}"]

            result = {
                "id": tc_id,
                "claim_id": tc["claim_id"],
                "strategy": tc["strategy"],
                "scores": {
                    "faithfulness": scores["faithfulness"],
                    "completeness": scores["completeness"],
                    "anomaly_accuracy": scores["anomaly_accuracy"],
                },
                "failures": failures,
                "status": "fail" if failures else "pass",
            }
            all_results.append(result)

            if failures:
                all_failures.extend(
                    [f"[{tc_id}] {f}" for f in failures]
                )

        # Write report regardless of pass/fail
        report = _build_report(all_results)
        _write_report(report)

        # Assert all passed
        if all_failures:
            failure_msg = "Evaluation threshold failures:\n" + "\n".join(all_failures)
            pytest.fail(failure_msg)
