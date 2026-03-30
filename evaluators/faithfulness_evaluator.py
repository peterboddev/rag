"""
Faithfulness Evaluator

Custom AgentCore evaluator that scores how accurately a claim summary
reflects source documents without hallucinations. Uses LLM-as-a-Judge
pattern with Bedrock Nova Pro.

Scores summaries on a 0-1 scale:
- 1.0: Every statement is directly supported by source documents
- 0.5: Most statements supported, some minor details inferred
- 0.0: Significant information not found in sources (hallucinations)

Environment Variables:
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)

Requirements: 10.9
"""

import json
import os
import logging
from typing import Any

import boto3

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")
EVAL_MODEL_ID = os.environ.get("EVAL_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0")

FAITHFULNESS_PROMPT = """You are evaluating the faithfulness of an insurance claim summary.

Source Documents:
{source_documents}

Generated Summary:
{summary}

Score the summary on faithfulness (0-1 scale):
- 1.0: Every statement in the summary is directly supported by the source documents
- 0.75: Most statements are well-supported with only trivial inferences
- 0.5: Most statements are supported, but some minor details may be inferred or slightly inaccurate
- 0.25: Several statements lack support or contain inaccuracies
- 0.0: The summary contains significant information not found in the sources (hallucinations)

Evaluate each claim in the summary against the source documents. Check for:
1. Factual accuracy of patient information
2. Correct diagnosis codes and descriptions
3. Accurate procedure details
4. Correct dates and amounts
5. Any statements not supported by the source documents

Respond ONLY with valid JSON in this exact format:
{{"score": <float between 0 and 1>, "reasoning": "<brief explanation of your scoring>"}}"""


class FaithfulnessEvaluator:
    """
    Evaluator that scores summary faithfulness to source documents.

    Uses LLM-as-a-Judge pattern to verify that generated summaries
    accurately reflect the content of source documents without
    introducing hallucinated information.
    """

    def __init__(self, bedrock_client: Any = None):
        """
        Initialize the Faithfulness Evaluator.

        Args:
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.bedrock = bedrock_client or boto3.client(
            "bedrock-runtime", region_name=BEDROCK_REGION
        )
        self.model_id = EVAL_MODEL_ID

    def evaluate(self, summary: str, source_documents: str) -> dict:
        """
        Evaluate the faithfulness of a summary against source documents.

        Args:
            summary: The generated summary text to evaluate
            source_documents: The original source document text

        Returns:
            dict with:
                - score: float 0-1 faithfulness score
                - reasoning: str explanation of the score
        """
        if not summary or not summary.strip():
            return {
                "score": 0.0,
                "reasoning": "Empty summary cannot be faithful to source documents.",
            }

        if not source_documents or not source_documents.strip():
            return {
                "score": 0.0,
                "reasoning": "No source documents provided for faithfulness evaluation.",
            }

        prompt = FAITHFULNESS_PROMPT.format(
            source_documents=source_documents,
            summary=summary,
        )

        try:
            response = self._invoke_model(prompt)
            return self._parse_response(response)
        except Exception as e:
            logger.error(f"Faithfulness evaluation failed: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Evaluation failed: {str(e)}",
            }

    def _invoke_model(self, prompt: str) -> str:
        """
        Invoke Bedrock model for evaluation. Supports both Nova and Claude formats.
        """
        is_claude = "anthropic" in self.model_id

        if is_claude:
            request_body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500,
                "temperature": 0.1,
            })
        else:
            request_body = json.dumps({
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"max_new_tokens": 500, "temperature": 0.1},
            })

        response = self.bedrock.invoke_model(
            modelId=self.model_id,
            body=request_body,
        )

        response_body = json.loads(response["body"].read())

        if is_claude:
            content = response_body.get("content", [])
            if content and isinstance(content, list):
                return content[0].get("text", "")
        else:
            output = response_body.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])
            if content and isinstance(content, list):
                return content[0].get("text", "")

        return str(response_body)

    def _parse_response(self, response_text: str) -> dict:
        """
        Parse the LLM evaluation response into a structured result.

        Args:
            response_text: Raw text response from the LLM

        Returns:
            dict with score (float 0-1) and reasoning (str)
        """
        try:
            # Try to extract JSON from the response
            text = response_text.strip()

            # Handle cases where JSON is wrapped in markdown code blocks
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()

            result = json.loads(text)

            score = float(result.get("score", 0.0))
            # Clamp score to 0-1 range
            score = max(0.0, min(1.0, score))

            reasoning = str(result.get("reasoning", "No reasoning provided."))

            return {
                "score": score,
                "reasoning": reasoning,
            }
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Failed to parse evaluation response: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Failed to parse evaluation response: {response_text[:200]}",
            }
