"""
AgentCore Evaluation Configuration

Configures online evaluation for claim summary agents using:
- Built-in Helpfulness evaluator
- Custom Faithfulness evaluator
- Custom Completeness evaluator

Processes agent traces and stores evaluation scores in the
Evaluation_Results_Table DynamoDB table.

Environment Variables:
    EVALUATION_RESULTS_TABLE: DynamoDB table name for evaluation results
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)

Requirements: 10.2, 10.3
"""

import json
import os
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import boto3

from evaluators.faithfulness_evaluator import FaithfulnessEvaluator
from evaluators.completeness_evaluator import CompletenessEvaluator

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

EVALUATION_RESULTS_TABLE = os.environ.get(
    "EVALUATION_RESULTS_TABLE", "rag-app-v2-evaluation-results-dev"
)
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")


class EvaluationConfig:
    """
    Configures and runs AgentCore evaluations for claim summary agents.

    Orchestrates built-in Helpfulness evaluator alongside custom
    Faithfulness and Completeness evaluators. Stores results in
    the Evaluation_Results_Table.
    """

    def __init__(
        self,
        dynamodb_client: Any = None,
        bedrock_client: Any = None,
    ):
        """
        Initialize the evaluation configuration.

        Args:
            dynamodb_client: Optional DynamoDB resource for testing
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.dynamodb = dynamodb_client or boto3.resource(
            "dynamodb", region_name=BEDROCK_REGION
        )
        self.results_table = self.dynamodb.Table(EVALUATION_RESULTS_TABLE)

        self.faithfulness_evaluator = FaithfulnessEvaluator(
            bedrock_client=bedrock_client
        )
        self.completeness_evaluator = CompletenessEvaluator(
            bedrock_client=bedrock_client
        )

    def evaluate_summary(
        self,
        claim_id: str,
        strategy: str,
        chunking_method: Optional[str],
        summary: str,
        source_documents: str,
        helpfulness_score: Optional[float] = None,
    ) -> dict:
        """
        Run all evaluators on a generated summary and store results.

        Args:
            claim_id: The claim identifier
            strategy: The summarization strategy used
            chunking_method: The chunking method (for RAG strategy)
            summary: The generated summary text
            source_documents: The original source document text
            helpfulness_score: Optional pre-computed helpfulness score
                from the built-in AgentCore Helpfulness evaluator

        Returns:
            dict with evaluation scores:
                - helpfulness: float 0-1
                - faithfulness: float 0-1
                - completeness: float 0-1
                - evaluatedAt: ISO 8601 timestamp
        """
        evaluated_at = datetime.now(timezone.utc).isoformat()

        # Run custom Faithfulness evaluator
        faithfulness_result = self.faithfulness_evaluator.evaluate(
            summary=summary,
            source_documents=source_documents,
        )

        # Run custom Completeness evaluator
        completeness_result = self.completeness_evaluator.evaluate(
            summary=summary,
        )

        # Use provided helpfulness score or default
        helpfulness = (
            helpfulness_score if helpfulness_score is not None else 0.0
        )

        scores = {
            "helpfulness": helpfulness,
            "faithfulness": faithfulness_result["score"],
            "completeness": completeness_result["score"],
            "evaluatedAt": evaluated_at,
        }

        # Build strategy key for DynamoDB sort key
        strategy_key = self._build_strategy_key(strategy, chunking_method)

        # Store results in Evaluation_Results_Table
        self._store_results(
            claim_id=claim_id,
            strategy_key=strategy_key,
            scores=scores,
            faithfulness_reasoning=faithfulness_result.get("reasoning", ""),
            completeness_reasoning=completeness_result.get("reasoning", ""),
            missing_elements=completeness_result.get("missing_elements", []),
        )

        return scores

    def get_evaluation_results(self, claim_id: str) -> list[dict]:
        """
        Retrieve all evaluation results for a claim.

        Args:
            claim_id: The claim identifier

        Returns:
            List of evaluation result dicts, one per strategy
        """
        try:
            response = self.results_table.query(
                KeyConditionExpression="claimId = :claimId",
                ExpressionAttributeValues={":claimId": claim_id},
            )
            return response.get("Items", [])
        except Exception as e:
            logger.error(
                f"Failed to retrieve evaluation results for {claim_id}: {e}"
            )
            return []

    def _build_strategy_key(
        self, strategy: str, chunking_method: Optional[str]
    ) -> str:
        """
        Build the strategy key for the DynamoDB sort key.

        Args:
            strategy: The summarization strategy
            chunking_method: The chunking method (optional)

        Returns:
            Strategy key in format: {strategy}#{chunkingMethod}
        """
        cm = chunking_method or "none"
        return f"{strategy}#{cm}"

    def _store_results(
        self,
        claim_id: str,
        strategy_key: str,
        scores: dict,
        faithfulness_reasoning: str = "",
        completeness_reasoning: str = "",
        missing_elements: Optional[list] = None,
    ) -> None:
        """
        Store evaluation results in the Evaluation_Results_Table.

        Args:
            claim_id: The claim identifier (partition key)
            strategy_key: The strategy key (sort key)
            scores: The evaluation scores dict
            faithfulness_reasoning: Reasoning from faithfulness evaluator
            completeness_reasoning: Reasoning from completeness evaluator
            missing_elements: List of missing elements from completeness
        """
        try:
            item = {
                "claimId": claim_id,
                "strategyKey": strategy_key,
                "helpfulness": str(scores["helpfulness"]),
                "faithfulness": str(scores["faithfulness"]),
                "completeness": str(scores["completeness"]),
                "evaluatedAt": scores["evaluatedAt"],
                "faithfulnessReasoning": faithfulness_reasoning,
                "completenessReasoning": completeness_reasoning,
                "missingElements": missing_elements or [],
            }

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
