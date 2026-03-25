import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Environment variables
const EVALUATION_RESULTS_TABLE = process.env.EVALUATION_RESULTS_TABLE || 'evaluation-results-table';

// AWS SDK clients
const dynamoClient = new DynamoDBClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Event schema from AgentCore Evaluations.
 */
export interface EvaluationResultEvent {
  traceId: string;
  spanAttributes: {
    'claim.id'?: string;
    'claim.strategy'?: string;
    'claim.chunking_method'?: string;
  };
  evaluationResults: {
    evaluatorName: string;
    evaluatorArn: string;
    score: number;
    reasoning?: string;
    additionalFields?: Record<string, unknown>;
  }[];
  evaluatedAt: string;
}

/**
 * Clamps a numeric score to the [0.0, 1.0] range.
 */
export function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/**
 * Builds the strategyKey sort key as `{strategy}#{chunkingMethod}`.
 * Defaults chunkingMethod to 'none' when not provided.
 */
export function buildStrategyKey(strategy: string, chunkingMethod?: string): string {
  const cm = chunkingMethod || 'none';
  return `${strategy}#${cm}`;
}

/**
 * Parses an EvaluationResultEvent and extracts scores mapped by evaluator name.
 * Returns an object with score fields and optional reasoning fields.
 */
export function parseEvaluationEvent(event: EvaluationResultEvent): {
  helpfulness?: number;
  faithfulness?: number;
  completeness?: number;
  anomalyAccuracy?: number;
  faithfulnessReasoning?: string;
  completenessReasoning?: string;
  anomalyAccuracyReasoning?: string;
} {
  const result: Record<string, unknown> = {};

  for (const er of event.evaluationResults) {
    const name = er.evaluatorName;
    if (name === 'Builtin.Helpfulness' || name === 'Helpfulness') {
      result.helpfulness = clampScore(er.score);
    } else if (name === 'Faithfulness') {
      result.faithfulness = clampScore(er.score);
      if (er.reasoning) result.faithfulnessReasoning = er.reasoning;
    } else if (name === 'Completeness') {
      result.completeness = clampScore(er.score);
      if (er.reasoning) result.completenessReasoning = er.reasoning;
    } else if (name === 'AnomalyAccuracy') {
      result.anomalyAccuracy = clampScore(er.score);
      if (er.reasoning) result.anomalyAccuracyReasoning = er.reasoning;
    }
  }

  return result as ReturnType<typeof parseEvaluationEvent>;
}


/**
 * Lambda handler that receives evaluation result events from AgentCore Evaluations
 * and writes them to the Evaluation_Results_Table DynamoDB table.
 */
export const handler = async (event: unknown): Promise<{ statusCode: number; body: string }> => {
  // Validate the event is a parseable object
  let parsed: EvaluationResultEvent;
  try {
    parsed = (typeof event === 'string' ? JSON.parse(event) : event) as EvaluationResultEvent;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.evaluationResults)) {
      console.error('Malformed event payload: missing evaluationResults array', JSON.stringify(event).substring(0, 500));
      return { statusCode: 400, body: JSON.stringify({ error: 'Malformed event payload' }) };
    }
  } catch (err) {
    console.error('Malformed event payload: not valid JSON', String(event).substring(0, 500));
    return { statusCode: 400, body: JSON.stringify({ error: 'Malformed event payload' }) };
  }

  const attrs = parsed.spanAttributes || {};
  const claimId = attrs['claim.id'];

  // Skip writing if claim.id is missing
  if (!claimId) {
    console.warn('Missing claim.id in span attributes. traceId:', parsed.traceId, 'attributes:', JSON.stringify(attrs));
    return { statusCode: 200, body: JSON.stringify({ message: 'Skipped: missing claim.id' }) };
  }

  // Default strategy to 'unknown' if missing
  let strategy = attrs['claim.strategy'];
  if (!strategy) {
    console.warn('Missing claim.strategy in span attributes. traceId:', parsed.traceId, '— defaulting to unknown');
    strategy = 'unknown';
  }

  const chunkingMethod = attrs['claim.chunking_method'];
  const strategyKey = buildStrategyKey(strategy, chunkingMethod);

  // Parse scores from evaluation results
  const scores = parseEvaluationEvent(parsed);

  // Build the DynamoDB record
  const record: Record<string, unknown> = {
    claimId,
    strategyKey,
    evaluatedAt: parsed.evaluatedAt || new Date().toISOString(),
    traceId: parsed.traceId,
  };

  // Add numeric scores (only if present)
  if (scores.helpfulness !== undefined) record.helpfulness = scores.helpfulness;
  if (scores.faithfulness !== undefined) record.faithfulness = scores.faithfulness;
  if (scores.completeness !== undefined) record.completeness = scores.completeness;
  if (scores.anomalyAccuracy !== undefined) record.anomalyAccuracy = scores.anomalyAccuracy;

  // Add optional reasoning fields
  if (scores.faithfulnessReasoning) record.faithfulnessReasoning = scores.faithfulnessReasoning;
  if (scores.completenessReasoning) record.completenessReasoning = scores.completenessReasoning;
  if (scores.anomalyAccuracyReasoning) record.anomalyAccuracyReasoning = scores.anomalyAccuracyReasoning;

  // Write to DynamoDB
  try {
    await docClient.send(new PutCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      Item: record,
    }));

    console.log('Wrote evaluation result:', JSON.stringify({ claimId, strategyKey }));
    return { statusCode: 200, body: JSON.stringify({ message: 'Success', claimId, strategyKey }) };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('DynamoDB write failure:', JSON.stringify({ claimId, strategyKey, error: errorMessage }));
    return { statusCode: 500, body: JSON.stringify({ error: 'DynamoDB write failure', claimId, strategyKey }) };
  }
};
