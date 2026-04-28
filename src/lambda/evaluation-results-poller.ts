import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockClient, GetEvaluationJobCommand } from '@aws-sdk/client-bedrock';

// Environment variables
const EVALUATION_OUTPUT_BUCKET = process.env.EVALUATION_OUTPUT_BUCKET || '';
const EVALUATION_RESULTS_TABLE = process.env.EVALUATION_RESULTS_TABLE || '';
const REGION = process.env.REGION || 'us-east-1';

// AWS SDK clients
const s3Client = new S3Client({ region: REGION });
const dynamoClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockClient = new BedrockClient({ region: REGION });

/**
 * Event payload for the poller Lambda.
 */
export interface PollerEvent {
  jobName: string;
  outputS3Uri: string;
  claimId: string;
  strategy: string;
  chunkingMethod: string;
}

/**
 * Metric result from Bedrock Evaluations output.
 */
interface MetricResult {
  metricName: string;
  score: number;
  reasoning?: string;
}

/**
 * Clamps a numeric score to the [0.0, 1.0] range.
 */
function clampScore(score: number): number {
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/**
 * Lambda handler that reads Bedrock Evaluations job output from S3,
 * parses metric scores, and writes them to the evaluation results DynamoDB table.
 */
export const handler = async (event: PollerEvent): Promise<void> => {
  const { jobName, outputS3Uri, claimId, strategy, chunkingMethod } = event;

  try {
    // Check job status first
    try {
      const jobResponse = await bedrockClient.send(new GetEvaluationJobCommand({
        jobIdentifier: jobName,
      }));

      const status = jobResponse.status;
      if (status === 'Failed' || status === 'Stopped') {
        console.error('Evaluation job not completed:', { jobName, status });
        return;
      }
    } catch (statusError) {
      console.warn('Could not check job status, proceeding with output read:', statusError);
    }

    // Read evaluation output JSON from S3
    const outputKey = `results/${jobName}/output.json`;
    let outputBody: string;

    try {
      const outputObj = await s3Client.send(new GetObjectCommand({
        Bucket: EVALUATION_OUTPUT_BUCKET,
        Key: outputKey,
      }));
      outputBody = await outputObj.Body!.transformToString();
    } catch (s3Error) {
      console.error('Failed to read evaluation output from S3:', {
        bucket: EVALUATION_OUTPUT_BUCKET,
        key: outputKey,
        error: s3Error instanceof Error ? s3Error.message : 'Unknown error',
      });
      return;
    }

    // Parse the output JSON
    let output: { metricResults?: MetricResult[]; status?: string };
    try {
      output = JSON.parse(outputBody);
    } catch (parseError) {
      console.error('Malformed evaluation output JSON:', outputBody.substring(0, 500));
      return;
    }

    // Check for failed job status in output
    if (output.status === 'FAILED' || output.status === 'STOPPED') {
      console.error('Evaluation job failed:', { jobName, status: output.status });
      return;
    }

    // Parse metric scores
    const scores: Record<string, number> = {};
    const reasoning: Record<string, string> = {};

    if (!output.metricResults || !Array.isArray(output.metricResults)) {
      console.warn('No metricResults found in evaluation output:', { jobName });
      return;
    }

    for (const metric of output.metricResults) {
      const name = metric.metricName;
      const score = clampScore(metric.score);

      if (name === 'Builtin.Faithfulness' || name === 'Faithfulness') {
        scores.faithfulness = score;
        if (metric.reasoning) reasoning.faithfulnessReasoning = metric.reasoning;
      } else if (name === 'Builtin.Completeness' || name === 'Completeness') {
        scores.completeness = score;
        if (metric.reasoning) reasoning.completenessReasoning = metric.reasoning;
      } else if (name === 'Builtin.Helpfulness' || name === 'Helpfulness') {
        scores.helpfulness = score;
      }
    }

    if (Object.keys(scores).length === 0) {
      console.warn('No recognized metrics found in evaluation output:', { jobName });
      return;
    }

    // Build strategyKey
    const strategyKey = `${strategy}#${chunkingMethod || 'none'}#bedrock-api`;

    // Write scores to DynamoDB
    const record: Record<string, unknown> = {
      claimId,
      strategyKey,
      ...scores,
      ...reasoning,
      evaluatedAt: new Date().toISOString(),
      evaluationSource: 'bedrock-api',
      jobName,
    };

    await docClient.send(new PutCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      Item: record,
    }));

    console.log('Wrote evaluation scores to DynamoDB:', { claimId, strategyKey, scores });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Evaluation results poller error:', { jobName, claimId, error: errorMessage });
  }
};
