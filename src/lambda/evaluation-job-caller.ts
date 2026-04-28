import { BedrockClient, CreateEvaluationJobCommand } from '@aws-sdk/client-bedrock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Environment variables
const EVALUATION_DATASET_BUCKET = process.env.EVALUATION_DATASET_BUCKET || '';
const EVALUATION_OUTPUT_BUCKET = process.env.EVALUATION_OUTPUT_BUCKET || '';
const EVALUATION_JOB_ROLE_ARN = process.env.EVALUATION_JOB_ROLE_ARN || '';
const REGION = process.env.REGION || 'us-east-1';

// AWS SDK clients
const s3Client = new S3Client({ region: REGION });
const bedrockClient = new BedrockClient({ region: REGION });

/**
 * Request payload from the orchestrator Lambda.
 */
export interface EvaluationJobRequest {
  claimId: string;
  strategy: string;
  chunkingMethod: string;
  summary: string;
  sourceDocuments: string;
}

/**
 * Builds a JSONL evaluation dataset string from summary and source documents.
 * Each line is a valid JSON object with prompt, response, and referenceResponse fields.
 *
 * Exported as a pure function for property-based testing.
 */
export function buildEvaluationDataset(summary: string, sourceDocuments: string): string {
  const record = {
    prompt: sourceDocuments,
    response: summary,
    referenceResponse: sourceDocuments,
  };
  return JSON.stringify(record);
}

/**
 * Lambda handler that receives evaluation requests from the orchestrator,
 * writes a JSONL evaluation dataset to S3, and calls CreateEvaluationJob.
 *
 * All operations are wrapped in try/catch to ensure non-blocking behavior.
 */
export const handler = async (event: EvaluationJobRequest): Promise<void> => {
  try {
    const { claimId, strategy, chunkingMethod, summary, sourceDocuments } = event;

    // Validate required fields
    if (!summary || !summary.trim()) {
      console.warn('Skipping evaluation: empty summary for claim', claimId);
      return;
    }
    if (!sourceDocuments || !sourceDocuments.trim()) {
      console.warn('Skipping evaluation: empty sourceDocuments for claim', claimId);
      return;
    }

    const jobName = `eval-${claimId.toLowerCase()}-${Date.now()}`;
    const datasetKey = `datasets/${jobName}.jsonl`;

    // 1. Build and write JSONL evaluation dataset to S3
    const jsonlContent = buildEvaluationDataset(summary, sourceDocuments);

    await s3Client.send(new PutObjectCommand({
      Bucket: EVALUATION_DATASET_BUCKET,
      Key: datasetKey,
      Body: jsonlContent,
      ContentType: 'application/jsonl',
      Metadata: {
        claimId,
        strategy,
        chunkingMethod: chunkingMethod || 'none',
        jobName,
      },
    }));

    console.log('Wrote evaluation dataset to S3:', { bucket: EVALUATION_DATASET_BUCKET, key: datasetKey });

    // 2. Call CreateEvaluationJob (LLM-as-a-judge with built-in metrics)
    await bedrockClient.send(new CreateEvaluationJobCommand({
      jobName,
      roleArn: EVALUATION_JOB_ROLE_ARN,
      applicationType: 'ModelEvaluation',
      evaluationConfig: {
        automated: {
          datasetMetricConfigs: [{
            taskType: 'Custom',
            dataset: {
              name: jobName,
              datasetLocation: {
                s3Uri: `s3://${EVALUATION_DATASET_BUCKET}/${datasetKey}`,
              },
            },
            metricNames: ['Builtin.Correctness', 'Builtin.Completeness', 'Builtin.Helpfulness', 'Builtin.Faithfulness'],
          }],
          evaluatorModelConfig: {
            bedrockEvaluatorModels: [{
              modelIdentifier: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            }],
          },
        },
      },
      inferenceConfig: {
        models: [{
          bedrockModel: {
            modelIdentifier: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          },
        }],
      },
      outputDataConfig: {
        s3Uri: `s3://${EVALUATION_OUTPUT_BUCKET}/results/${jobName}/`,
      },
    }));

    console.log('Created evaluation job:', { jobName, claimId, strategy, chunkingMethod });

    // 3. Store job metadata as a separate S3 object for the poller
    await s3Client.send(new PutObjectCommand({
      Bucket: EVALUATION_OUTPUT_BUCKET,
      Key: `metadata/${jobName}.json`,
      Body: JSON.stringify({
        jobName,
        claimId,
        strategy,
        chunkingMethod: chunkingMethod || 'none',
        createdAt: new Date().toISOString(),
        outputS3Uri: `s3://${EVALUATION_OUTPUT_BUCKET}/results/${jobName}/`,
      }),
      ContentType: 'application/json',
    }));

    console.log('Stored job metadata:', { jobName });
  } catch (error) {
    // Non-blocking: log error but don't throw
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Evaluation job caller error (non-blocking):', errorMessage);
  }
};
