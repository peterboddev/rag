"""
Completeness Evaluator

Custom AgentCore evaluator that scores how completely a claim summary
covers key claim elements. Uses LLM-as-a-Judge pattern with Bedrock
Nova Pro.

Key claim elements checked:
- Patient information (name, DOB, ID)
- Diagnosis codes and descriptions
- Procedures performed
- Service dates
- Provider information
- Amounts/charges

Scores summaries on a 0-1 scale:
- 1.0: All key elements covered with appropriate detail
- 0.5: Most elements covered, some missing or lacking detail
- 0.0: Major elements missing

Environment Variables:
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)

Requirements: 10.10
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
EVAL_MODEL_ID = os.environ.get("EVAL_MODEL_ID", "amazon.nova-pro-v1:0")

KEY_CLAIM_ELEMENTS = [
    "patient",
    "diagnosis",
    "procedures",
    "dates",
    "provider",
    "amounts",
]

COMPLETENESS_PROMPT = """You are evaluating the completeness of an insurance claim summary.

The summary should cover these key elements:
- Patient information (name, DOB, ID)
- Diagnosis codes and descriptions
- Procedures performed
- Service dates
- Provider information
- Amounts/charges

Generated Summary:
{summary}

Score the summary on completeness (0-1 scale):
- 1.0: All key elements are covered with appropriate detail
- 0.75: Most elements covered with good detail, one minor element missing
- 0.5: Most elements covered, some missing or lacking detail
- 0.25: Several key elements missing
- 0.0: Major elements missing, summary is inadequate

For each key element, determine if it is present in the summary:
1. Patient information - name, date of birth, or patient ID
2. Diagnosis - ICD codes or diagnosis descriptions
3. Procedures - CPT codes or procedure descriptions
4. Dates - service dates, admission/discharge dates
5. Provider - provider name, NPI, or facility
6. Amounts - charges, payments, or financial information

Respond ONLY with valid JSON in this exact format:
{{"score": <float between 0 and 1>, "reasoning": "<brief explanation>", "missing_elements": [<list of missing element names as strings>]}}"""


class CompletenessEvaluator:
    """
    Evaluator that scores summary completeness for key claim elements.

    Uses LLM-as-a-Judge pattern to check whether the generated summary
    covers all important aspects of an insurance claim including patient
    info, diagnosis, procedures, dates, provider, and amounts.
    """

    def __init__(self, bedrock_client: Any = None):
        """
        Initialize the Completeness Evaluator.

        Args:
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.bedrock = bedrock_client or boto3.client(
            "bedrock-runtime", region_name=BEDROCK_REGION
        )
        self.model_id = EVAL_MODEL_ID

    def evaluate(self, summary: str) -> dict:
        """
        Evaluate the completeness of a claim summary.

        Args:
            summary: The generated summary text to evaluate

        Returns:
            dict with:
                - score: float 0-1 completeness score
                - reasoning: str explanation of the score
                - missing_elements: list of missing element names
        """
        if not summary or not summary.strip():
            return {
                "score": 0.0,
                "reasoning": "Empty summary has no coverage of claim elements.",
                "missing_elements": list(KEY_CLAIM_ELEMENTS),
            }

        prompt = COMPLETENESS_PROMPT.format(summary=summary)

        try:
            response = self._invoke_model(prompt)
            return self._parse_response(response)
        except Exception as e:
            logger.error(f"Completeness evaluation failed: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Evaluation failed: {str(e)}",
                "missing_elements": [],
            }

    def _invoke_model(self, prompt: str) -> str:
        """Invoke Bedrock model for evaluation. Supports both Nova and Claude formats."""
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

        response = self.bedrock.invoke_model(modelId=self.model_id, body=request_body)
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
            dict with score (float 0-1), reasoning (str),
            and missing_elements (list)
        """
        try:
            text = response_text.strip()

            # Handle markdown code blocks
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()

            result = json.loads(text)

            score = float(result.get("score", 0.0))
            score = max(0.0, min(1.0, score))

            reasoning = str(result.get("reasoning", "No reasoning provided."))

            missing_elements = result.get("missing_elements", [])
            if not isinstance(missing_elements, list):
                missing_elements = []
            missing_elements = [str(e) for e in missing_elements]

            return {
                "score": score,
                "reasoning": reasoning,
                "missing_elements": missing_elements,
            }
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Failed to parse evaluation response: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Failed to parse evaluation response: {response_text[:200]}",
                "missing_elements": [],
            }
