import json
import os
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event, context):
    """Evaluation trigger Lambda - runs evaluate_direct and stores results."""
    from evaluators.evaluation_runner import EvaluationRunner

    claim_id = event.get("claimId", "")
    strategy = event.get("strategy", "")
    chunking_method = event.get("chunkingMethod", "none")
    summary = event.get("summary", "")
    source_documents = event.get("sourceDocuments", "")
    anomalies = event.get("anomalies", [])

    if not claim_id or not summary:
        logger.warning("Missing claimId or summary, skipping evaluation")
        return {"statusCode": 400, "body": "Missing required fields"}

    runner = EvaluationRunner()
    scores = runner.evaluate_direct(summary, source_documents, anomalies)
    runner.store_results(claim_id, strategy, chunking_method, scores)

    logger.info(
        "Evaluation complete for claim %s, strategy %s#%s",
        claim_id,
        strategy,
        chunking_method,
    )
    return {"statusCode": 200, "body": json.dumps(scores)}
