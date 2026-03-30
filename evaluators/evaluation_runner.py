"""
Evaluation Runner

Orchestrates evaluator registration with AgentCore Evaluations API,
online evaluation configuration, on-demand evaluation, and direct
offline evaluation.

Uses the AgentCore Evaluations API (preview) for:
- Registering custom evaluators (Faithfulness, Completeness, AnomalyAccuracy)
- Configuring online evaluation for live agent traces
- Triggering on-demand evaluation for specific traces

Also supports direct offline evaluation using evaluator classes,
bypassing the AgentCore service for CI/CD and local testing.

Environment Variables:
    EVALUATION_RESULTS_TABLE: DynamoDB table name for evaluation results
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    EVAL_SAMPLING_PERCENTAGE: Sampling percentage for online evaluation (default: 80.0)
    EVALUATION_EXECUTION_ROLE_ARN: IAM role ARN for online evaluation execution
    AGENTCORE_LOG_GROUP_PREFIX: CloudWatch log group prefix (default: /aws/agentcore)

Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
"""

import json
import os
import logging
from datetime import datetime, timezone
from typing import Any

import boto3

from evaluators.evaluation_config import get_evaluator_definitions, get_score_thresholds
from evaluators.faithfulness_evaluator import FaithfulnessEvaluator, FAITHFULNESS_PROMPT
from evaluators.completeness_evaluator import CompletenessEvaluator, COMPLETENESS_PROMPT
from evaluators.anomaly_accuracy_evaluator import AnomalyAccuracyEvaluator, ANOMALY_ACCURACY_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Conditional import for strands-agents-evals SDK
try:
    from strands_evals.evaluators import OutputEvaluator
    from strands_evals.types import EvaluationData, EvaluationOutput
    _STRANDS_EVALS_AVAILABLE = True
except ImportError:
    _STRANDS_EVALS_AVAILABLE = False
    logger.warning(
        "strands-agents-evals not installed, using custom evaluator fallback"
    )

EVALUATION_RESULTS_TABLE = os.environ.get(
    "EVALUATION_RESULTS_TABLE", "rag-app-v2-evaluation-results-dev"
)
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")

BUILTIN_HELPFULNESS_ARN = "arn:aws:bedrock-agentcore:::evaluator/Builtin.Helpfulness"

EVAL_SAMPLING_PERCENTAGE = float(os.environ.get("EVAL_SAMPLING_PERCENTAGE", "80.0"))
EVALUATION_EXECUTION_ROLE_ARN = os.environ.get("EVALUATION_EXECUTION_ROLE_ARN", "")
AGENTCORE_LOG_GROUP_PREFIX = os.environ.get("AGENTCORE_LOG_GROUP_PREFIX", "/aws/agentcore")

HELPFULNESS_PROMPT = """Evaluate the helpfulness of this insurance claim summary.
Score 1.0 if the summary is clear, actionable, and provides all information needed for claim processing.
Score 0.5 if the summary is partially helpful but missing some useful details.
Score 0.0 if the summary is unhelpful or confusing."""


class EvaluatorRegistrationError(Exception):
    """Raised when custom evaluator registration with AgentCore fails."""

    def __init__(self, evaluator_name: str, message: str):
        self.evaluator_name = evaluator_name
        super().__init__(f"Failed to register evaluator '{evaluator_name}': {message}")


class EvaluationConfigError(Exception):
    """Raised when online evaluation configuration fails."""

    def __init__(self, agent_id: str, message: str):
        self.agent_id = agent_id
        super().__init__(f"Failed to configure evaluation for agent '{agent_id}': {message}")


class EvaluationRunner:
    """
    Orchestrates evaluator registration, online evaluation configuration,
    on-demand evaluation, and direct offline evaluation.

    Uses the AgentCore Evaluations API (preview) for service-side operations
    and evaluator classes directly for offline evaluation.
    """

    def __init__(
        self,
        agentcore_client: Any = None,
        dynamodb_client: Any = None,
        bedrock_client: Any = None,
    ):
        """
        Initialize the EvaluationRunner.

        Args:
            agentcore_client: Optional boto3 client for bedrock-agentcore service.
                Since AgentCore Evaluations is in preview, the actual API client
                may not be available yet. Pass a mock or stub for testing.
            dynamodb_client: Optional DynamoDB resource for testing.
            bedrock_client: Optional Bedrock Runtime client for testing
                (used by offline evaluator classes).
        """
        # AgentCore client — use provided or create a generic boto3 client.
        # The actual service name may change when the SDK is GA.
        self.agentcore_client = agentcore_client or self._create_agentcore_client()

        self.dynamodb = dynamodb_client or boto3.resource(
            "dynamodb", region_name=BEDROCK_REGION
        )
        self.results_table = self.dynamodb.Table(EVALUATION_RESULTS_TABLE)

        self.bedrock_client = bedrock_client

        # Registered evaluator ARNs keyed by name
        self._evaluator_arns: dict[str, str] = {}

    # ------------------------------------------------------------------
    # AgentCore client creation
    # ------------------------------------------------------------------

    @staticmethod
    def _create_agentcore_client() -> Any:
        """
        Create a boto3 client for the bedrock-agentcore-control service.

        Returns a generic client that can be swapped when the SDK is
        available. Falls back gracefully if the service is not yet
        in the SDK.
        """
        try:
            return boto3.client("bedrock-agentcore-control", region_name=BEDROCK_REGION)
        except Exception as e:
            logger.warning(
                f"Could not create bedrock-agentcore-control client: {e}. "
                "AgentCore Evaluations API calls will fail until the SDK is available."
            )
            return None

    # ------------------------------------------------------------------
    # Evaluator registration
    # ------------------------------------------------------------------

    def register_evaluators(self) -> dict[str, str]:
        """
        Register custom evaluators with the AgentCore Evaluations API.

        Registers Faithfulness, Completeness, and AnomalyAccuracy evaluators
        using prompts and schemas from ``get_evaluator_definitions()``.

        Handles idempotent registration: if an evaluator already exists
        (409 conflict), retrieves the existing ARN via GetEvaluator.

        Returns:
            dict mapping evaluator name to its ARN.

        Raises:
            EvaluatorRegistrationError: If registration fails for any evaluator.
        """
        definitions = get_evaluator_definitions()

        for defn in definitions:
            name = defn["name"]
            try:
                arn = self._register_single_evaluator(defn)
                self._evaluator_arns[name] = arn
                logger.info(f"Registered evaluator '{name}' with ARN: {arn}")
            except Exception as e:
                raise EvaluatorRegistrationError(name, str(e))

        return dict(self._evaluator_arns)

    def _register_single_evaluator(self, defn: dict) -> str:
        """
        Register a single evaluator, handling 409 conflict for idempotency.

        Args:
            defn: Evaluator definition dict with name, prompt,
                scoring_schema, and model_id.

        Returns:
            The evaluator ARN (newly created or existing).
        """
        name = defn["name"]
        payload = self._build_registration_payload(defn)

        try:
            response = self.agentcore_client.create_evaluator(**payload)
            return response["evaluatorArn"]
        except self.agentcore_client.exceptions.ConflictException:
            logger.info(
                f"Evaluator '{name}' already exists. Retrieving existing ARN."
            )
            return self._get_existing_evaluator_arn(name)
        except AttributeError:
            # Client may not have exceptions attribute if it's a mock
            # or the service isn't available yet. Re-raise as registration error.
            raise
        except Exception as e:
            error_code = getattr(
                getattr(e, "response", {}), "get", lambda *a: None
            )
            # Handle 409 from generic ClientError
            resp = getattr(e, "response", None)
            if resp and resp.get("Error", {}).get("Code") == "ConflictException":
                logger.info(
                    f"Evaluator '{name}' already exists (ClientError 409). "
                    "Retrieving existing ARN."
                )
                return self._get_existing_evaluator_arn(name)
            raise

    @staticmethod
    def _build_registration_payload(defn: dict) -> dict:
        """
        Build the registration payload for the bedrock-agentcore-control
        CreateEvaluator API.

        Uses the definition's ``evaluatorConfig`` (llmAsAJudge structure)
        and ``level`` fields for the new API contract.

        Args:
            defn: Evaluator definition dict from get_evaluator_definitions().

        Returns:
            dict suitable for ``create_evaluator(**payload)``.
        """
        return {
            "evaluatorName": defn["name"],
            "level": defn["level"],
            "evaluatorConfig": defn["evaluatorConfig"],
        }

    def _get_existing_evaluator_arn(self, name: str) -> str:
        """
        Retrieve the ARN/ID of an already-registered evaluator.

        Uses the bedrock-agentcore-control ``get_evaluator()`` API with
        ``evaluatorId`` as the parameter name. Stores both ``evaluatorId``
        and ``evaluatorArn`` in ``_evaluator_ids`` if available.

        Args:
            name: The evaluator name.

        Returns:
            The evaluator ARN (or evaluator ID if ARN is not present).
        """
        response = self.agentcore_client.get_evaluator(evaluatorId=name)
        evaluator_id = response.get("evaluatorId", "")
        evaluator_arn = response.get("evaluatorArn", "")

        # Store both identifiers when available
        if not hasattr(self, "_evaluator_ids"):
            self._evaluator_ids: dict[str, str] = {}
        if evaluator_id:
            self._evaluator_ids[name] = evaluator_id

        return evaluator_arn or evaluator_id

    # ------------------------------------------------------------------
    # Online evaluation configuration
    # ------------------------------------------------------------------

    def configure_online_evaluation(self, agent_id: str) -> str:
        """
        Create an online evaluation configuration for an agent.

        Uses the ``create_online_evaluation_config()`` API from
        ``bedrock-agentcore-control``. The configuration includes the
        built-in Helpfulness evaluator plus all registered custom
        evaluator IDs, a CloudWatch Logs data source, sampling rule,
        and an execution role ARN.

        Args:
            agent_id: The AgentCore Runtime agent identifier.

        Returns:
            The online evaluation config name from the response.

        Raises:
            EvaluationConfigError: If configuration creation fails.

        Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
        """
        config_name = agent_id.replace("-", "_")

        # Build evaluators list: built-in Helpfulness + registered custom IDs
        evaluator_entries = [
            {"evaluatorId": "Builtin.Helpfulness"},
        ]
        for name in ("Faithfulness", "Completeness", "AnomalyAccuracy"):
            evaluator_id = self._evaluator_arns.get(name)
            if not evaluator_id:
                raise EvaluationConfigError(
                    agent_id,
                    f"Evaluator '{name}' not registered. Call register_evaluators() first.",
                )
            evaluator_entries.append({"evaluatorId": evaluator_id})

        log_group = f"{AGENTCORE_LOG_GROUP_PREFIX}/{agent_id}"
        service_name = agent_id

        try:
            response = self.agentcore_client.create_online_evaluation_config(
                onlineEvaluationConfigName=config_name,
                description=f"Online evaluation for agent {agent_id}",
                rule={
                    "samplingConfig": {
                        "samplingPercentage": EVAL_SAMPLING_PERCENTAGE,
                    }
                },
                dataSourceConfig={
                    "cloudWatchLogs": {
                        "logGroupNames": [log_group],
                        "serviceNames": [service_name],
                    }
                },
                evaluators=evaluator_entries,
                evaluationExecutionRoleArn=EVALUATION_EXECUTION_ROLE_ARN,
                enableOnCreate=True,
            )
            returned_config_name = response.get(
                "onlineEvaluationConfigName", config_name
            )
            logger.info(
                f"Created online evaluation config '{returned_config_name}' "
                f"for agent '{agent_id}'"
            )
            return returned_config_name
        except Exception as e:
            raise EvaluationConfigError(agent_id, str(e))

    # ------------------------------------------------------------------
    # On-demand evaluation
    # ------------------------------------------------------------------

    def evaluate_trace(self, trace_id: str) -> dict:
        """
        Trigger on-demand evaluation for a specific agent trace.

        Args:
            trace_id: The OpenTelemetry trace ID to evaluate.

        Returns:
            dict with evaluation scores: helpfulness, faithfulness,
            completeness, anomalyAccuracy, evaluatedAt.
            On failure returns ``{"error": message, "evaluator": name}``.
        """
        evaluator_arns = [BUILTIN_HELPFULNESS_ARN] + list(self._evaluator_arns.values())

        try:
            response = self.agentcore_client.start_evaluation(
                traceId=trace_id,
                evaluators=[{"evaluatorArn": arn} for arn in evaluator_arns],
            )

            scores = self._parse_evaluation_response(response)
            scores["evaluatedAt"] = datetime.now(timezone.utc).isoformat()
            return scores
        except Exception as e:
            logger.error(f"On-demand evaluation failed for trace {trace_id}: {e}")
            return {"error": str(e), "evaluator": "on-demand"}

    @staticmethod
    def _parse_evaluation_response(response: dict) -> dict:
        """
        Parse the AgentCore evaluation response into a scores dict.

        Args:
            response: Raw API response from start_evaluation.

        Returns:
            dict with helpfulness, faithfulness, completeness,
            and optionally anomalyAccuracy scores.
        """
        scores: dict[str, Any] = {}
        results = response.get("evaluationResults", [])

        name_to_key = {
            "Builtin.Helpfulness": "helpfulness",
            "Helpfulness": "helpfulness",
            "Faithfulness": "faithfulness",
            "Completeness": "completeness",
            "AnomalyAccuracy": "anomalyAccuracy",
        }

        for result in results:
            evaluator_name = result.get("evaluatorName", "")
            key = name_to_key.get(evaluator_name)
            if key:
                score = result.get("score", 0.0)
                scores[key] = max(0.0, min(1.0, float(score)))

        return scores

    # ------------------------------------------------------------------
    # Direct offline evaluation
    # ------------------------------------------------------------------

    def evaluate_direct(
        self,
        summary: str,
        source_documents: str,
        anomalies: list,
    ) -> dict:
        """
        Run offline evaluation using the Strands Evals SDK when available,
        falling back to custom evaluator classes otherwise.

        When the SDK is available, creates four ``OutputEvaluator`` instances
        with rubrics from the existing prompts and calls each evaluator's
        ``evaluate()`` method. If an individual SDK evaluator raises an
        exception, falls back to the custom class for that metric.

        When the SDK is not available, uses the custom evaluator classes
        directly (unchanged legacy behavior).

        Args:
            summary: The generated claim summary text.
            source_documents: The original source document text.
            anomalies: List of detected anomaly dicts.

        Returns:
            dict with helpfulness, faithfulness, completeness,
            anomalyAccuracy scores, reasoning fields, and
            evaluatedAt timestamp.

        Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.3
        """
        if _STRANDS_EVALS_AVAILABLE:
            return self._evaluate_direct_sdk(summary, source_documents, anomalies)
        else:
            logger.warning(
                "strands-agents-evals not available, using custom evaluator fallback"
            )
            return self._evaluate_direct_fallback(summary, source_documents, anomalies)

    def _evaluate_direct_sdk(
        self,
        summary: str,
        source_documents: str,
        anomalies: list,
    ) -> dict:
        """
        SDK path for direct offline evaluation using OutputEvaluator.

        Creates four OutputEvaluator instances with rubrics and evaluates
        each metric. Falls back to the custom class per-metric on error.
        """
        anomalies_text = json.dumps(anomalies, indent=2) if anomalies else "[]"

        results: dict[str, Any] = {}

        # --- Helpfulness ---
        try:
            helpfulness_evaluator = OutputEvaluator(rubric=HELPFULNESS_PROMPT)
            helpfulness_data = EvaluationData(actual_output=summary)
            helpfulness_output = helpfulness_evaluator.evaluate(helpfulness_data)
            results["helpfulness"] = max(0.0, min(1.0, float(helpfulness_output.score)))
            results["helpfulnessReasoning"] = getattr(helpfulness_output, "reason", "") or ""
        except Exception as e:
            logger.warning(f"SDK helpfulness evaluator failed, no custom fallback: {e}")
            results["helpfulness"] = 0.0
            results["helpfulnessReasoning"] = f"SDK evaluation failed: {e}"

        # --- Faithfulness ---
        try:
            faithfulness_evaluator = OutputEvaluator(
                rubric=FAITHFULNESS_PROMPT, include_inputs=True
            )
            faithfulness_data = EvaluationData(
                actual_output=summary, input=source_documents
            )
            faithfulness_output = faithfulness_evaluator.evaluate(faithfulness_data)
            results["faithfulness"] = max(0.0, min(1.0, float(faithfulness_output.score)))
            results["faithfulnessReasoning"] = getattr(faithfulness_output, "reason", "") or ""
        except Exception as e:
            logger.warning(
                f"SDK faithfulness evaluator failed, falling back to custom class: {e}"
            )
            fallback = FaithfulnessEvaluator(bedrock_client=self.bedrock_client)
            fb_result = fallback.evaluate(summary=summary, source_documents=source_documents)
            results["faithfulness"] = fb_result["score"]
            results["faithfulnessReasoning"] = fb_result.get("reasoning", "")

        # --- Completeness ---
        try:
            completeness_evaluator = OutputEvaluator(
                rubric=COMPLETENESS_PROMPT, include_inputs=True
            )
            completeness_data = EvaluationData(
                actual_output=summary, input=source_documents
            )
            completeness_output = completeness_evaluator.evaluate(completeness_data)
            results["completeness"] = max(0.0, min(1.0, float(completeness_output.score)))
            results["completenessReasoning"] = getattr(completeness_output, "reason", "") or ""
        except Exception as e:
            logger.warning(
                f"SDK completeness evaluator failed, falling back to custom class: {e}"
            )
            fallback = CompletenessEvaluator(bedrock_client=self.bedrock_client)
            fb_result = fallback.evaluate(summary=summary)
            results["completeness"] = fb_result["score"]
            results["completenessReasoning"] = fb_result.get("reasoning", "")

        # --- Anomaly Accuracy ---
        try:
            anomaly_evaluator = OutputEvaluator(
                rubric=ANOMALY_ACCURACY_PROMPT, include_inputs=True
            )
            anomaly_data = EvaluationData(
                actual_output=summary, input=anomalies_text
            )
            anomaly_output = anomaly_evaluator.evaluate(anomaly_data)
            results["anomalyAccuracy"] = max(0.0, min(1.0, float(anomaly_output.score)))
            results["anomalyAccuracyReasoning"] = getattr(anomaly_output, "reason", "") or ""
        except Exception as e:
            logger.warning(
                f"SDK anomaly accuracy evaluator failed, falling back to custom class: {e}"
            )
            fallback = AnomalyAccuracyEvaluator(bedrock_client=self.bedrock_client)
            fb_result = fallback.evaluate(anomalies=anomalies, source_documents=source_documents)
            results["anomalyAccuracy"] = fb_result["score"]
            results["anomalyAccuracyReasoning"] = fb_result.get("reasoning", "")

        results["evaluatedAt"] = datetime.now(timezone.utc).isoformat()
        return results

    def _evaluate_helpfulness_fallback(self, summary: str, source_documents: str) -> float:
        """Score helpfulness using Bedrock when SDK is unavailable."""
        self._last_helpfulness_reasoning = ""
        try:
            client = self.bedrock_client or boto3.client(
                "bedrock-runtime", region_name=BEDROCK_REGION
            )
            prompt = (
                f"{HELPFULNESS_PROMPT}\n\nSource Documents:\n{source_documents[:5000]}"
                f"\n\nSummary:\n{summary}\n\n"
                'Respond ONLY with JSON: {{"score": <0-1>, "reasoning": "<brief>"}}'
            )
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.1,
            })
            resp = client.invoke_model(modelId="us.anthropic.claude-sonnet-4-6", body=body)
            resp_body = json.loads(resp["body"].read())
            text = resp_body.get("content", [{}])[0].get("text", "")
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            result = json.loads(text.strip())
            self._last_helpfulness_reasoning = result.get("reasoning", "")
            return max(0.0, min(1.0, float(result.get("score", 0.0))))
        except Exception as e:
            logger.warning(f"Helpfulness fallback evaluation failed: {e}")
            self._last_helpfulness_reasoning = f"Evaluation failed: {e}"
            return 0.0

    def _evaluate_direct_fallback(
        self,
        summary: str,
        source_documents: str,
        anomalies: list,
    ) -> dict:
        """
        Fallback path using custom evaluator classes when SDK is unavailable.
        """
        faithfulness_eval = FaithfulnessEvaluator(bedrock_client=self.bedrock_client)
        completeness_eval = CompletenessEvaluator(bedrock_client=self.bedrock_client)
        anomaly_eval = AnomalyAccuracyEvaluator(bedrock_client=self.bedrock_client)

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
            "helpfulness": self._evaluate_helpfulness_fallback(summary, source_documents),
            "faithfulness": faithfulness_result["score"],
            "completeness": completeness_result["score"],
            "anomalyAccuracy": anomaly_result["score"],
            "helpfulnessReasoning": self._last_helpfulness_reasoning,
            "faithfulnessReasoning": faithfulness_result.get("reasoning", ""),
            "completenessReasoning": completeness_result.get("reasoning", ""),
            "anomalyAccuracyReasoning": anomaly_result.get("reasoning", ""),
            "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        }

    # ------------------------------------------------------------------
    # Store results
    # ------------------------------------------------------------------

    def store_results(
        self,
        claim_id: str,
        strategy: str,
        chunking_method: str,
        scores: dict,
    ) -> None:
        """
        Write evaluation results to the Evaluation_Results_Table.

        Follows the same DynamoDB pattern as
        ``EvaluationConfig._store_results()``.

        Args:
            claim_id: The claim identifier (partition key).
            strategy: The summarization strategy (e.g. full-context, rag).
            chunking_method: The chunking method (e.g. semantic, none).
            scores: dict containing evaluation scores and optional
                reasoning fields.
        """
        strategy_key = f"{strategy}#{chunking_method or 'none'}"

        item: dict[str, Any] = {
            "claimId": claim_id,
            "strategyKey": strategy_key,
            "evaluatedAt": scores.get(
                "evaluatedAt", datetime.now(timezone.utc).isoformat()
            ),
        }

        # Write numeric scores as strings to match existing pattern
        for key in ("helpfulness", "faithfulness", "completeness", "anomalyAccuracy"):
            if key in scores:
                item[key] = str(scores[key])

        # Write optional reasoning fields
        for key in (
            "helpfulnessReasoning",
            "faithfulnessReasoning",
            "completenessReasoning",
            "anomalyAccuracyReasoning",
        ):
            if scores.get(key):
                item[key] = scores[key]

        # Write traceId if present
        if scores.get("traceId"):
            item["traceId"] = scores["traceId"]

        try:
            self.results_table.put_item(Item=item)
            logger.info(
                f"Stored evaluation results for claim {claim_id}, "
                f"strategy {strategy_key}"
            )
        except Exception as e:
            logger.error(
                f"Failed to store evaluation results for "
                f"{claim_id}/{strategy_key}: {e}"
            )
