"""
Property-Based Tests for Strands Agent Concurrency Fix (Bugfix Spec)

Bug Condition Exploration Test:
- Property 1: Bug Condition — Retry Loop and Error Masking in handler()

Tests verify that handler() calls agent() exactly once, propagates errors
as {"error": ..., "statusCode": 500}, does NOT mask errors as
"Agent analysis unavailable", and does NOT call time_module.sleep().

Uses pytest with hypothesis library for property-based testing.
"""

import sys
import os
import json
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from hypothesis import given, settings, strategies as st, assume

# ---------------------------------------------------------------------------
# Mock external dependencies BEFORE importing the agent module.
# Same pattern as test_full_context_agent.py
# ---------------------------------------------------------------------------

mock_boto3 = MagicMock()
mock_strands = MagicMock()
mock_strands_models = MagicMock()
mock_bedrock_agentcore = MagicMock()
mock_bedrock_agentcore_runtime = MagicMock()
mock_opentelemetry = MagicMock()
mock_opentelemetry_trace = MagicMock()

# The @tool decorator should return the function unchanged for testing
mock_strands.tool = lambda f: f

with patch.dict("sys.modules", {
    "boto3": mock_boto3,
    "strands": mock_strands,
    "strands.models": mock_strands_models,
    "strands.Agent": MagicMock(),
    "bedrock_agentcore": mock_bedrock_agentcore,
    "bedrock_agentcore.runtime": mock_bedrock_agentcore_runtime,
    "opentelemetry": mock_opentelemetry,
    "opentelemetry.trace": mock_opentelemetry_trace,
}):
    import importlib.util as _ilu

    _fc_agent_path = os.path.join(
        os.path.dirname(__file__), "..", "agents", "full_context_agent", "agent.py"
    )
    _spec = _ilu.spec_from_file_location("full_context_agent_concurrency", _fc_agent_path)
    _fc_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_fc_mod)

# Extract functions and module references
handler = _fc_mod.handler
_retrieve_claim_documents_impl = _fc_mod._retrieve_claim_documents_impl
parse_agent_response = _fc_mod.parse_agent_response


# =============================================================================
# Helpers
# =============================================================================

def make_valid_document(file_name="test-doc.pdf", claim_id="CLM-001"):
    """Create a valid document record that passes retrieval checks."""
    return {
        "documentId": f"doc-{file_name}",
        "fileName": file_name,
        "extractedText": "Patient Name: John Smith\nDate of Service: 2024-01-15\nAmount: $500.00",
        "processingStatus": "completed",
        "claimMetadata": {"claimId": claim_id, "documentType": "medical_record"},
        "extractedFinancials": {
            "payments": [{"amount": 500.00, "rawText": "$500.00"}],
        },
        "extractedDates": {
            "dates": [{"date": "2024-01-15", "label": "service_date"}],
        },
    }


# =============================================================================
# Property 1: Bug Condition — Retry Loop and Error Masking in handler()
#
# For any exception raised by agent(), handler() SHALL:
# - Call agent() exactly once (no retry loop)
# - Return a response with "error" key and "statusCode": 500
# - NOT return "Agent analysis unavailable" in the response
# - NOT call time_module.sleep()
#
# **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
# =============================================================================

class TestBugConditionExploration:
    """
    Property 1: Bug Condition — Retry Loop and Error Masking in handler()

    CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists.

    The bug condition is: handler contains retry loop AND agent call raises exception
    AND (retry hits busy singleton OR error masked as summary).

    Expected behavior (what the test asserts):
    - agent() called exactly once
    - Response contains "error" key with statusCode 500
    - Response does NOT contain "Agent analysis unavailable"
    - time_module.sleep() is NOT called

    **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
    """

    @given(
        error_message=st.one_of(
            st.sampled_from([
                "modelStreamErrorException",
                "throttlingException",
                "ThrottlingException",
                "ToolUse",
                "invalid sequence",
                "generic error",
            ]),
            st.text(min_size=1, max_size=100).filter(lambda x: len(x.strip()) > 0),
        )
    )
    @settings(max_examples=50, deadline=None)
    def test_bug_condition_single_agent_invocation(self, error_message):
        """
        Property 1: Bug Condition — For any exception raised by agent(),
        handler() SHALL call agent() exactly once.

        **Validates: Requirements 1.1, 1.2, 2.1**
        """
        documents = [make_valid_document()]

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', side_effect=Exception(error_message)) as mock_agent, \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.return_value = 1000.0
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # Assert agent() called exactly once (no retries)
            assert mock_agent.call_count == 1, (
                f"Expected agent() to be called exactly once, "
                f"but was called {mock_agent.call_count} times "
                f"for error: {error_message!r}"
            )

    @given(
        error_message=st.one_of(
            st.sampled_from([
                "modelStreamErrorException",
                "throttlingException",
                "ThrottlingException",
                "ToolUse",
                "invalid sequence",
                "generic error",
            ]),
            st.text(min_size=1, max_size=100).filter(lambda x: len(x.strip()) > 0),
        )
    )
    @settings(max_examples=50, deadline=None)
    def test_bug_condition_error_response_structure(self, error_message):
        """
        Property 1: Bug Condition — For any exception raised by agent(),
        handler() SHALL return a response with "error" key and "statusCode": 500.

        **Validates: Requirements 1.3, 2.2**
        """
        documents = [make_valid_document()]

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', side_effect=Exception(error_message)), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.return_value = 1000.0
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # Assert response contains "error" key
            assert "error" in result, (
                f"Expected 'error' key in response for exception: {error_message!r}. "
                f"Got keys: {list(result.keys())}"
            )

            # Assert statusCode is 500
            assert result.get("statusCode") == 500, (
                f"Expected statusCode 500, got {result.get('statusCode')} "
                f"for error: {error_message!r}"
            )

    @given(
        error_message=st.one_of(
            st.sampled_from([
                "modelStreamErrorException",
                "throttlingException",
                "ThrottlingException",
                "ToolUse",
                "invalid sequence",
                "generic error",
            ]),
            st.text(min_size=1, max_size=100).filter(lambda x: len(x.strip()) > 0),
        )
    )
    @settings(max_examples=50, deadline=None)
    def test_bug_condition_no_error_masking(self, error_message):
        """
        Property 1: Bug Condition — For any exception raised by agent(),
        handler() SHALL NOT return "Agent analysis unavailable" in the response.

        **Validates: Requirements 1.3, 2.2**
        """
        documents = [make_valid_document()]

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', side_effect=Exception(error_message)), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.return_value = 1000.0
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # Assert "Agent analysis unavailable" is NOT in the response
            result_str = json.dumps(result)
            assert "Agent analysis unavailable" not in result_str, (
                f"Response contains 'Agent analysis unavailable' error masking "
                f"for exception: {error_message!r}. Response: {result}"
            )

    @given(
        error_message=st.one_of(
            st.sampled_from([
                "modelStreamErrorException",
                "throttlingException",
                "ThrottlingException",
                "ToolUse",
                "invalid sequence",
                "generic error",
            ]),
            st.text(min_size=1, max_size=100).filter(lambda x: len(x.strip()) > 0),
        )
    )
    @settings(max_examples=50, deadline=None)
    def test_bug_condition_no_sleep_calls(self, error_message):
        """
        Property 1: Bug Condition — For any exception raised by agent(),
        handler() SHALL NOT call time_module.sleep().

        **Validates: Requirements 1.2, 2.1**
        """
        documents = [make_valid_document()]

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', side_effect=Exception(error_message)), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.return_value = 1000.0
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # Assert time_module.sleep() was NOT called
            assert mock_time.sleep.call_count == 0, (
                f"Expected no sleep() calls, but sleep was called "
                f"{mock_time.sleep.call_count} time(s) "
                f"for error: {error_message!r}"
            )


# =============================================================================
# Property 2: Preservation — Successful Response Structure and Deterministic Overrides
#
# For any successful agent() invocation, handler() SHALL:
# - Return a response containing all 7 required fields: summary, anomalies,
#   documentCount, strategy, financialSummary, timeline, toolTrace
# - Override financialSummary with deterministic aggregation from DynamoDB extractedFinancials
# - Override timeline with deterministic aggregation from DynamoDB extractedDates
# - Return documentCount equal to len(documents)
# - Return 400 for missing claim_id
# - Return 404 for DocumentRetrievalError with status_code=404
#
# **Validates: Requirements 2.3, 3.1, 3.2, 3.3, 3.4**
# =============================================================================


class TestPreservation:
    """
    Property 2: Preservation — Successful Response Structure and Deterministic Overrides

    These tests run on UNFIXED code and MUST PASS — they confirm baseline behavior
    that must be preserved after the fix is applied.

    **Validates: Requirements 2.3, 3.1, 3.2, 3.3, 3.4**
    """

    @given(
        summary_text=st.text(min_size=10, max_size=200).filter(lambda x: len(x.strip()) > 0),
    )
    @settings(max_examples=30, deadline=None)
    def test_preservation_response_structure(self, summary_text):
        """
        Property 2: Preservation — Response structure preservation.

        For all successful agent() invocations with randomly generated agent responses,
        verify the handler output contains all 7 required fields.

        **Validates: Requirements 2.3, 3.1**
        """
        documents = [make_valid_document()]

        # Create a mock agent result with .message attribute
        mock_result = MagicMock()
        mock_result.message = summary_text
        mock_result.tool_results = []

        mock_anomalies = [
            {"description": "Test anomaly", "severity": "warning",
             "sourceDocument": "test.pdf", "dataValues": {"key": "val"}}
        ]

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', return_value=mock_result), \
             patch.object(_fc_mod, '_detect_anomalies_impl', return_value=mock_anomalies), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.side_effect = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0]
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # Assert all 7 required fields are present
            required_fields = ["summary", "anomalies", "documentCount", "strategy",
                               "financialSummary", "timeline", "toolTrace"]
            for field in required_fields:
                assert field in result, (
                    f"Missing required field '{field}' in response. "
                    f"Got keys: {list(result.keys())}"
                )

            # Assert types
            assert isinstance(result["summary"], str), "summary must be a string"
            assert isinstance(result["anomalies"], list), "anomalies must be a list"
            assert isinstance(result["documentCount"], int), "documentCount must be an int"
            assert isinstance(result["strategy"], str), "strategy must be a string"
            assert isinstance(result["financialSummary"], dict), "financialSummary must be a dict"
            assert isinstance(result["timeline"], dict), "timeline must be a dict"

    @given(
        agent_min_payment=st.floats(min_value=1.0, max_value=5000.0, allow_nan=False, allow_infinity=False),
        agent_max_payment=st.floats(min_value=5001.0, max_value=50000.0, allow_nan=False, allow_infinity=False),
        dynamo_payment_amount=st.floats(min_value=100.0, max_value=10000.0, allow_nan=False, allow_infinity=False),
        dynamo_date=st.sampled_from(["2020-01-15", "2021-06-20", "2022-11-30", "2023-03-10", "2024-01-15"]),
    )
    @settings(max_examples=30, deadline=None)
    def test_preservation_deterministic_override(self, agent_min_payment, agent_max_payment,
                                                  dynamo_payment_amount, dynamo_date):
        """
        Property 2: Preservation — Deterministic override preservation.

        For all combinations of agent-produced financial/timeline data and
        DynamoDB-sourced extractedFinancials/extractedDates, verify the DynamoDB
        values always override the agent values in the final response.

        **Validates: Requirements 3.4**
        """
        # Document with DynamoDB-sourced extractedFinancials and extractedDates
        doc = make_valid_document()
        doc["extractedFinancials"] = {
            "payments": [{"amount": dynamo_payment_amount, "rawText": f"${dynamo_payment_amount:.2f}"}],
        }
        doc["extractedDates"] = {
            "dates": [{"date": dynamo_date, "label": "service_date"}],
        }
        documents = [doc]

        # Agent returns different financial/timeline data (should be overridden)
        agent_response_json = json.dumps({
            "summary": "Agent summary text",
            "anomalies": [],
            "documentCount": 1,
            "financialSummary": {
                "minPayment": agent_min_payment,
                "maxPayment": agent_max_payment,
                "totalValue": agent_min_payment + agent_max_payment,
                "payments": []
            },
            "timeline": {
                "startYear": 1999,
                "endYear": 2000,
                "durationYears": 1
            }
        })

        mock_result = MagicMock()
        mock_result.message = agent_response_json
        mock_result.tool_results = []

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', return_value=mock_result), \
             patch.object(_fc_mod, '_detect_anomalies_impl', return_value=[]), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.side_effect = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0]
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            # financialSummary MUST come from DynamoDB aggregation, not agent
            fs = result["financialSummary"]
            assert fs["minPayment"] == dynamo_payment_amount, (
                f"Expected minPayment={dynamo_payment_amount} from DynamoDB, "
                f"got {fs['minPayment']}"
            )
            assert fs["maxPayment"] == dynamo_payment_amount, (
                f"Expected maxPayment={dynamo_payment_amount} from DynamoDB, "
                f"got {fs['maxPayment']}"
            )
            assert fs["totalValue"] == dynamo_payment_amount, (
                f"Expected totalValue={dynamo_payment_amount} from DynamoDB, "
                f"got {fs['totalValue']}"
            )

            # timeline MUST come from DynamoDB aggregation, not agent
            tl = result["timeline"]
            expected_year = int(dynamo_date.split("-")[0])
            assert tl["startYear"] == expected_year, (
                f"Expected startYear={expected_year} from DynamoDB date {dynamo_date}, "
                f"got {tl['startYear']}"
            )
            assert tl["endYear"] == expected_year, (
                f"Expected endYear={expected_year} from DynamoDB date {dynamo_date}, "
                f"got {tl['endYear']}"
            )

    @given(
        num_documents=st.integers(min_value=1, max_value=10),
    )
    @settings(max_examples=20, deadline=None)
    def test_preservation_document_count(self, num_documents):
        """
        Property 2: Preservation — Document count preservation.

        For random document lists (1-10 documents), verify documentCount
        equals len(documents).

        **Validates: Requirements 3.1**
        """
        documents = [make_valid_document(file_name=f"doc-{i}.pdf") for i in range(num_documents)]

        mock_result = MagicMock()
        mock_result.message = "Summary of the claim analysis."
        mock_result.tool_results = []

        with patch.object(_fc_mod, '_retrieve_claim_documents_impl', return_value=documents), \
             patch.object(_fc_mod, 'agent', return_value=mock_result), \
             patch.object(_fc_mod, '_detect_anomalies_impl', return_value=[]), \
             patch.object(_fc_mod, 'time_module') as mock_time:
            mock_time.time.side_effect = [100.0 + i for i in range(20)]
            mock_time.sleep = MagicMock()

            result = handler({"claim_id": "CLM-001"}, None)

            assert result["documentCount"] == num_documents, (
                f"Expected documentCount={num_documents}, got {result['documentCount']}"
            )

    def test_preservation_missing_claim_id_returns_400(self):
        """
        Property 2: Preservation — Error path preservation.

        Verify missing claim_id returns 400.

        **Validates: Requirements 3.3**
        """
        result = handler({}, None)
        assert "error" in result, f"Expected 'error' key in response. Got: {result}"
        assert result["statusCode"] == 400, f"Expected statusCode 400, got {result.get('statusCode')}"
        assert "claim_id is required" in result["error"]

    def test_preservation_document_retrieval_error_returns_404(self):
        """
        Property 2: Preservation — Error path preservation.

        Verify DocumentRetrievalError(status_code=404) returns 404.

        **Validates: Requirements 3.2**
        """
        with patch.object(
            _fc_mod, '_retrieve_claim_documents_impl',
            side_effect=_fc_mod.DocumentRetrievalError("No documents found", status_code=404)
        ):
            result = handler({"claim_id": "CLM-001"}, None)
            assert "error" in result, f"Expected 'error' key in response. Got: {result}"
            assert result["statusCode"] == 404, f"Expected statusCode 404, got {result.get('statusCode')}"
