"""
Anomaly Accuracy Evaluator

Custom AgentCore evaluator that scores the accuracy of detected
anomalies against source document content. Uses LLM-as-a-Judge
pattern with Bedrock Nova Pro.

Scores anomaly detection accuracy on a 0-1 scale:
- 1.0: All detected anomalies are real, no anomalies missed
- 0.5: Some false positives or missed anomalies
- 0.0: No anomalies detected or all detections are false positives

Environment Variables:
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)

Requirements: 1.3, 10.4
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

ANOMALY_ACCURACY_PROMPT = """You are evaluating the accuracy of detected anomalies in insurance claim documents.

Source Documents:
{source_documents}

Detected Anomalies:
{anomalies}

Your task:
1. Review the source documents carefully for actual anomalies (inconsistencies, errors, suspicious patterns, conflicting information)
2. Compare each detected anomaly against what is actually present in the source documents
3. Identify any false positives (detected anomalies that are not real issues in the documents)
4. Identify any missed anomalies (real issues in the documents that were not detected)
5. Score the accuracy of the anomaly detection on a 0-1 scale

Scoring guidelines:
- 1.0: All detected anomalies are genuine and no real anomalies were missed
- 0.75: Most detections are accurate with minor false positives or one missed anomaly
- 0.5: Some false positives or several missed anomalies
- 0.25: Many false positives or most real anomalies were missed
- 0.0: All detections are false positives or no real anomalies were detected

Respond ONLY with valid JSON in this exact format:
{{"score": <float between 0 and 1>, "reasoning": "<brief explanation of your scoring>", "false_positives": [<list of false positive descriptions as strings>], "missed_anomalies": [<list of missed anomaly descriptions as strings>]}}"""


class AnomalyAccuracyEvaluator:
    """
    Evaluator that scores the accuracy of detected anomalies.

    Uses LLM-as-a-Judge pattern to verify that detected anomalies
    in insurance claim documents are genuine and that no real
    anomalies were missed.
    """

    def __init__(self, bedrock_client: Any = None):
        """
        Initialize the Anomaly Accuracy Evaluator.

        Args:
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.bedrock = bedrock_client or boto3.client(
            "bedrock-runtime", region_name=BEDROCK_REGION
        )
        self.model_id = BEDROCK_MODEL_ID

    def evaluate(self, anomalies: list[dict], source_documents: str) -> dict:
        """
        Evaluate the accuracy of detected anomalies against source documents.

        Args:
            anomalies: List of detected anomaly dicts, each with
                description, severity, sourceDocument, dataValues
            source_documents: The original source document text

        Returns:
            dict with:
                - score: float 0-1 anomaly accuracy score
                - reasoning: str explanation of the score
                - false_positives: list of false positive descriptions
                - missed_anomalies: list of missed anomaly descriptions
        """
        if not anomalies:
            return {
                "score": 0.0,
                "reasoning": "No anomalies to evaluate.",
                "false_positives": [],
                "missed_anomalies": [],
            }

        if not source_documents or not source_documents.strip():
            return {
                "score": 0.0,
                "reasoning": "No source documents for anomaly evaluation.",
                "false_positives": [],
                "missed_anomalies": [],
            }

        anomalies_text = json.dumps(anomalies, indent=2)
        prompt = ANOMALY_ACCURACY_PROMPT.format(
            source_documents=source_documents,
            anomalies=anomalies_text,
        )

        try:
            response = self._invoke_model(prompt)
            return self._parse_response(response)
        except Exception as e:
            logger.error(f"Anomaly accuracy evaluation failed: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Evaluation failed: {str(e)}",
                "false_positives": [],
                "missed_anomalies": [],
            }

    def _invoke_model(self, prompt: str) -> str:
        """
        Invoke Bedrock Nova Pro for evaluation.

        Args:
            prompt: The evaluation prompt

        Returns:
            Raw model response text

        Raises:
            Exception: If model invocation fails
        """
        request_body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            "inferenceConfig": {
                "max_new_tokens": 500,
                "temperature": 0.1,
            },
        })

        response = self.bedrock.invoke_model(
            modelId=self.model_id,
            body=request_body,
        )

        response_body = json.loads(response["body"].read())
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
            false_positives (list), and missed_anomalies (list)
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

            false_positives = result.get("false_positives", [])
            if not isinstance(false_positives, list):
                false_positives = []
            false_positives = [str(fp) for fp in false_positives]

            missed_anomalies = result.get("missed_anomalies", [])
            if not isinstance(missed_anomalies, list):
                missed_anomalies = []
            missed_anomalies = [str(ma) for ma in missed_anomalies]

            return {
                "score": score,
                "reasoning": reasoning,
                "false_positives": false_positives,
                "missed_anomalies": missed_anomalies,
            }
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Failed to parse evaluation response: {e}")
            return {
                "score": 0.0,
                "reasoning": f"Failed to parse evaluation response: {response_text[:200]}",
                "false_positives": [],
                "missed_anomalies": [],
            }
