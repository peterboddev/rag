"""
Property-Based Tests for Custom AgentCore Evaluators

Tests for:
- Property 18: Evaluation Score Structure

Uses pytest with hypothesis library for property-based testing.
Minimum 100 iterations per property test.

Validates: Requirements 10.1, 10.3
"""

import sys
import os
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from io import BytesIO

import pytest
from hypothesis import given, settings, strategies as st, assume

# Import evaluators using importlib to avoid path conflicts
import importlib.util as _ilu

_faith_path = os.path.join(
    os.path.dirname(__file__), "..", "evaluators", "faithfulness_evaluator.py"
)
_faith_spec = _ilu.spec_from_file_location("faithfulness_evaluator", _faith_path)
_faith_mod = _ilu.module_from_spec(_faith_spec)
_faith_spec.loader.exec_module(_faith_mod)
FaithfulnessEvaluator = _faith_mod.FaithfulnessEvaluator

_comp_path = os.path.join(
    os.path.dirname(__file__), "..", "evaluators", "completeness_evaluator.py"
)
_comp_spec = _ilu.spec_from_file_location("completeness_evaluator", _comp_path)
_comp_mod = _ilu.module_from_spec(_comp_spec)
_comp_spec.loader.exec_module(_comp_mod)
CompletenessEvaluator = _comp_mod.CompletenessEvaluator


# =============================================================================
# Helpers
# =============================================================================

def make_bedrock_response(score: float, reasoning: str, missing_elements=None):
    """Create a mock Bedrock response with the given evaluation result."""
    result = {"score": score, "reasoning": reasoning}
    if missing_elements is not None:
        result["missing_elements"] = missing_elements
    body_bytes = json.dumps({
        "output": {
            "message": {
                "content": [{"text": json.dumps(result)}]
            }
        }
    }).encode("utf-8")
    mock_body = MagicMock()
    mock_body.read.return_value = body_bytes
    return {"body": mock_body}


def create_mock_bedrock_client(score: float, reasoning: str, missing_elements=None):
    """Create a mock Bedrock client that returns a fixed evaluation score."""
    client = MagicMock()
    client.invoke_model.return_value = make_bedrock_response(
        score, reasoning, missing_elements
    )
    return client


# =============================================================================
# Hypothesis Strategies
# =============================================================================

# Strategy for generating scores in 0-1 range
score_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)

# Strategy for generating reasoning text
reasoning_strategy = st.text(min_size=1, max_size=200).filter(
    lambda x: len(x.strip()) > 0
)

# Strategy for generating summary text
summary_strategy = st.text(min_size=10, max_size=500).filter(
    lambda x: len(x.strip()) > 0
)

# Strategy for generating source document text
source_doc_strategy = st.text(min_size=10, max_size=500).filter(
    lambda x: len(x.strip()) > 0
)

# Strategy for generating missing element lists
missing_elements_strategy = st.lists(
    st.sampled_from(["patient", "diagnosis", "procedures", "dates", "provider", "amounts"]),
    min_size=0,
    max_size=6,
    unique=True,
)


# =============================================================================
# Property 18: Evaluation Score Structure
# =============================================================================

class TestProperty18EvaluationScoreStructure:
    """
    Property 18: Evaluation Score Structure

    For any summary response where includeEvaluation is true, the evaluation
    object shall contain: helpfulness (number 0-1), faithfulness (number 0-1),
    completeness (number 0-1), and evaluatedAt (valid ISO 8601 timestamp).

    Validates: Requirements 10.1, 10.3
    """

    @given(
        faithfulness_score=score_strategy,
        completeness_score=score_strategy,
        helpfulness_score=score_strategy,
        reasoning=reasoning_strategy,
        missing_elements=missing_elements_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_evaluation_scores_are_valid_numbers_in_range(
        self,
        faithfulness_score: float,
        completeness_score: float,
        helpfulness_score: float,
        reasoning: str,
        missing_elements: list,
    ):
        """
        **Validates: Requirements 10.1, 10.3**

        Generate evaluation responses, assert helpfulness, faithfulness,
        completeness are 0-1 numbers.
        """
        # Create mock bedrock that returns the faithfulness score
        faith_client = create_mock_bedrock_client(faithfulness_score, reasoning)
        comp_client = create_mock_bedrock_client(
            completeness_score, reasoning, missing_elements
        )

        faith_eval = FaithfulnessEvaluator(bedrock_client=faith_client)
        comp_eval = CompletenessEvaluator(bedrock_client=comp_client)

        faith_result = faith_eval.evaluate(
            summary="Test summary content here.",
            source_documents="Test source documents here.",
        )
        comp_result = comp_eval.evaluate(summary="Test summary content here.")

        # Build evaluation scores structure matching EvaluationScores interface
        scores = {
            "helpfulness": helpfulness_score,
            "faithfulness": faith_result["score"],
            "completeness": comp_result["score"],
            "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Assert all scores are numbers in 0-1 range
        assert isinstance(scores["helpfulness"], (int, float)), \
            f"helpfulness must be a number, got {type(scores['helpfulness'])}"
        assert 0.0 <= scores["helpfulness"] <= 1.0, \
            f"helpfulness {scores['helpfulness']} not in [0, 1]"

        assert isinstance(scores["faithfulness"], (int, float)), \
            f"faithfulness must be a number, got {type(scores['faithfulness'])}"
        assert 0.0 <= scores["faithfulness"] <= 1.0, \
            f"faithfulness {scores['faithfulness']} not in [0, 1]"

        assert isinstance(scores["completeness"], (int, float)), \
            f"completeness must be a number, got {type(scores['completeness'])}"
        assert 0.0 <= scores["completeness"] <= 1.0, \
            f"completeness {scores['completeness']} not in [0, 1]"

        # Assert evaluatedAt is valid ISO 8601 timestamp
        assert isinstance(scores["evaluatedAt"], str), \
            "evaluatedAt must be a string"
        parsed_dt = datetime.fromisoformat(scores["evaluatedAt"])
        assert parsed_dt is not None, "evaluatedAt must be valid ISO 8601"

    @given(
        score=st.floats(min_value=-100.0, max_value=100.0, allow_nan=False),
        reasoning=reasoning_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_faithfulness_score_clamped_to_valid_range(
        self,
        score: float,
        reasoning: str,
    ):
        """
        **Validates: Requirements 10.1, 10.3**

        Even when the LLM returns out-of-range scores, the evaluator
        must clamp them to the 0-1 range.
        """
        client = create_mock_bedrock_client(score, reasoning)
        evaluator = FaithfulnessEvaluator(bedrock_client=client)

        result = evaluator.evaluate(
            summary="Test summary.",
            source_documents="Test source.",
        )

        assert isinstance(result["score"], float), \
            f"score must be float, got {type(result['score'])}"
        assert 0.0 <= result["score"] <= 1.0, \
            f"score {result['score']} not clamped to [0, 1]"
        assert isinstance(result["reasoning"], str), \
            "reasoning must be a string"

    @given(
        score=st.floats(min_value=-100.0, max_value=100.0, allow_nan=False),
        reasoning=reasoning_strategy,
        missing_elements=missing_elements_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_completeness_score_clamped_to_valid_range(
        self,
        score: float,
        reasoning: str,
        missing_elements: list,
    ):
        """
        **Validates: Requirements 10.1, 10.3**

        Even when the LLM returns out-of-range scores, the evaluator
        must clamp them to the 0-1 range.
        """
        client = create_mock_bedrock_client(score, reasoning, missing_elements)
        evaluator = CompletenessEvaluator(bedrock_client=client)

        result = evaluator.evaluate(summary="Test summary.")

        assert isinstance(result["score"], float), \
            f"score must be float, got {type(result['score'])}"
        assert 0.0 <= result["score"] <= 1.0, \
            f"score {result['score']} not clamped to [0, 1]"
        assert isinstance(result["reasoning"], str), \
            "reasoning must be a string"
        assert isinstance(result["missing_elements"], list), \
            "missing_elements must be a list"

    @given(
        summary=summary_strategy,
        source_docs=source_doc_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_faithfulness_returns_required_fields(
        self,
        summary: str,
        source_docs: str,
    ):
        """
        **Validates: Requirements 10.1, 10.3**

        For any non-empty summary and source documents, the faithfulness
        evaluator must return score and reasoning fields.
        """
        client = create_mock_bedrock_client(0.85, "Good faithfulness.")
        evaluator = FaithfulnessEvaluator(bedrock_client=client)

        result = evaluator.evaluate(summary=summary, source_documents=source_docs)

        assert "score" in result, "Missing 'score' field"
        assert "reasoning" in result, "Missing 'reasoning' field"
        assert isinstance(result["score"], (int, float))
        assert isinstance(result["reasoning"], str)

    @given(summary=summary_strategy)
    @settings(max_examples=100, deadline=None)
    def test_completeness_returns_required_fields(self, summary: str):
        """
        **Validates: Requirements 10.1, 10.3**

        For any non-empty summary, the completeness evaluator must return
        score, reasoning, and missing_elements fields.
        """
        client = create_mock_bedrock_client(0.75, "Good completeness.", [])
        evaluator = CompletenessEvaluator(bedrock_client=client)

        result = evaluator.evaluate(summary=summary)

        assert "score" in result, "Missing 'score' field"
        assert "reasoning" in result, "Missing 'reasoning' field"
        assert "missing_elements" in result, "Missing 'missing_elements' field"
        assert isinstance(result["score"], (int, float))
        assert isinstance(result["reasoning"], str)
        assert isinstance(result["missing_elements"], list)


# =============================================================================
# Edge case unit tests for evaluators
# =============================================================================

class TestFaithfulnessEdgeCases:
    """Unit tests for faithfulness evaluator edge cases."""

    def test_empty_summary_returns_zero(self):
        evaluator = FaithfulnessEvaluator(bedrock_client=MagicMock())
        result = evaluator.evaluate(summary="", source_documents="Some docs.")
        assert result["score"] == 0.0
        assert "Empty summary" in result["reasoning"]

    def test_empty_source_documents_returns_zero(self):
        evaluator = FaithfulnessEvaluator(bedrock_client=MagicMock())
        result = evaluator.evaluate(summary="A summary.", source_documents="")
        assert result["score"] == 0.0
        assert "No source documents" in result["reasoning"]

    def test_bedrock_failure_returns_zero(self):
        client = MagicMock()
        client.invoke_model.side_effect = Exception("Service unavailable")
        evaluator = FaithfulnessEvaluator(bedrock_client=client)
        result = evaluator.evaluate(
            summary="A summary.", source_documents="Some docs."
        )
        assert result["score"] == 0.0
        assert "failed" in result["reasoning"].lower()


class TestCompletenessEdgeCases:
    """Unit tests for completeness evaluator edge cases."""

    def test_empty_summary_returns_zero_with_all_missing(self):
        evaluator = CompletenessEvaluator(bedrock_client=MagicMock())
        result = evaluator.evaluate(summary="")
        assert result["score"] == 0.0
        assert len(result["missing_elements"]) == 6

    def test_bedrock_failure_returns_zero(self):
        client = MagicMock()
        client.invoke_model.side_effect = Exception("Service unavailable")
        evaluator = CompletenessEvaluator(bedrock_client=client)
        result = evaluator.evaluate(summary="A summary.")
        assert result["score"] == 0.0
        assert "failed" in result["reasoning"].lower()
