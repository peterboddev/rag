/**
 * Agent Worker Lambda
 *
 * Dedicated Lambda function invoked by the Agent Workflow (Step Functions Express)
 * to call AgentCore agents and store results in the cache layer.
 *
 * Responsibilities:
 * 1. Route to the appropriate AgentCore agent based on strategy
 * 2. Store successful results in cache using cacheSummary()
 * 3. Release execution lock on completion
 * 4. Throw retryable errors for Step Functions retry handling
 * 5. Cache error entries for permanent failures so polling clients get feedback
 *
 * @module agent-worker
 */

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { invokeAgentCoreRuntime } from '../services/agentcore-client';
import { buildCacheKey, cacheSummary, cacheErrorResult } from '../services/summary-cache';
import { acquireExecutionLock, releaseExecutionLock } from '../services/execution-lock';
import {
  ClaimSummaryResponse,
  DataAnomaly,
  SummaryStrategy,
  FinancialSummary,
  TimelineData,
  ToolTraceEntry,
} from '../types/claim-summary';

// Environment variables
const EVALUATION_RESULTS_TABLE = process.env.EVALUATION_RESULTS_TABLE || 'evaluation-results-table';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// DynamoDB client for evaluation results
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Input event from Step Functions workflow.
 */
export interface WorkerEvent {
  claimId: string;
  tenantId: string;
  strategy: SummaryStrategy | string;
  chunkingMethod?: string;
  modelId?: string;
  customPrompt?: string;
  useReranker?: boolean;
  includeEvaluation?: boolean;
}

/**
 * Output result returned to Step Functions workflow.
 */
export interface WorkerResult {
  status: 'success' | 'retryable-error' | 'permanent-error';
  claimId: string;
  strategy: string;
  executionDuration: number;
  error?: string;
}

/**
 * Determines if an error message indicates a retryable condition.
 * Retryable errors are thrown to let Step Functions handle retry with backoff.
 */
export function isRetryableError(message: string): boolean {
  return (
    message.includes('Concurrent invocations are not supported') ||
    message.includes('already processing') ||
    message.includes('throttl') ||
    message.includes('ThrottlingException') ||
    message.includes('TooManyRequestsException') ||
    message.includes('ServiceUnavailableException')
  );
}

/**
 * Executes the full-context agent and returns the response.
 */
async function executeFullContextAgent(event: WorkerEvent): Promise<any> {
  const endpoint = process.env.FULL_CONTEXT_AGENT_ENDPOINT;
  if (!endpoint) {
    throw new Error('FULL_CONTEXT_AGENT_ENDPOINT not configured');
  }

  const result = await invokeAgentCoreRuntime(endpoint, {
    claim_id: event.claimId,
    tenant_id: event.tenantId,
    model_id: event.modelId || undefined,
    custom_prompt: event.customPrompt || undefined,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Check for agent-level errors embedded in the summary
  const summary = result.summary || '';
  if (summary.startsWith('Agent analysis unavailable:')) {
    throw new Error(summary);
  }

  return result;
}

/**
 * Executes the enriched agent and returns the response.
 */
async function executeEnrichedAgent(event: WorkerEvent): Promise<any> {
  const endpoint = process.env.ENRICHED_AGENT_ENDPOINT;
  if (!endpoint) {
    throw new Error('ENRICHED_AGENT_ENDPOINT not configured');
  }

  const result = await invokeAgentCoreRuntime(endpoint, {
    claim_id: event.claimId,
    tenant_id: event.tenantId,
    model_id: event.modelId || undefined,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  const enrichedSummary = result.summary || '';
  if (enrichedSummary.startsWith('Agent analysis unavailable:')) {
    throw new Error(enrichedSummary);
  }

  return result;
}

/**
 * Executes the financial timeline agent and stores results in the evaluation table.
 */
async function executeFinancialTimelineAgent(event: WorkerEvent): Promise<any> {
  const endpoint = process.env.FINANCIAL_TIMELINE_AGENT_ENDPOINT;
  if (!endpoint) {
    throw new Error('FINANCIAL_TIMELINE_AGENT_ENDPOINT not configured');
  }

  const result = await invokeAgentCoreRuntime(endpoint, {
    claim_id: event.claimId,
    tenant_id: event.tenantId,
    model_id: event.modelId || undefined,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  // Store results in evaluation results table
  await docClient.send(
    new PutCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      Item: {
        claimId: event.claimId,
        strategyKey: 'financial-analysis#full-context',
        agentFinancialSummary: result.financialSummary ?? null,
        agentTimeline: result.timeline ?? null,
        agentConfidence: result.confidence ?? null,
        agentReasoning: result.reasoning ?? null,
        evaluatedAt: new Date().toISOString(),
      },
    })
  );

  return result;
}

/**
 * Builds a ClaimSummaryResponse from the agent result for caching.
 */
function buildCacheResponse(agentResult: any, event: WorkerEvent): ClaimSummaryResponse {
  const anomalies: DataAnomaly[] = Array.isArray(agentResult.anomalies)
    ? agentResult.anomalies.map((a: any) => ({
        description: a.description || '',
        severity: ['critical', 'warning', 'info'].includes(a.severity) ? a.severity : 'info',
        sourceDocument: a.sourceDocument || 'Unknown',
        dataValues: a.dataValues || {},
        source: a.source || 'llm',
      }))
    : [];

  return {
    summary: agentResult.summary || '',
    anomalies,
    strategy: event.strategy,
    chunkingMethod: event.chunkingMethod,
    documentCount: agentResult.documentCount || 0,
    processingTime: 0, // Will be set by caller
    generatedAt: new Date().toISOString(),
    cached: false,
    promptInfo: agentResult.promptInfo || undefined,
    financialSummary: agentResult.financialSummary || undefined,
    timeline: agentResult.timeline || undefined,
    toolTrace: agentResult.toolTrace || undefined,
  };
}

/**
 * Triggers a financial timeline workflow execution for a claim.
 */
async function triggerFinancialTimelineWorkflow(
  claimId: string,
  tenantId: string,
  modelId?: string
): Promise<void> {
  const workflowArn = process.env.AGENT_WORKFLOW_ARN;
  if (!workflowArn) {
    console.warn('AGENT_WORKFLOW_ARN not configured, skipping financial timeline trigger');
    return;
  }

  const lockKey = `lock#${claimId}#financial-timeline`;
  const lockAcquired = await acquireExecutionLock(lockKey);
  if (!lockAcquired) {
    console.log('Financial timeline execution lock exists, skipping');
    return;
  }

  try {
    const sfnClient = new SFNClient({ region: AWS_REGION });
    await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: workflowArn,
        input: JSON.stringify({
          claimId,
          tenantId,
          strategy: 'financial-timeline',
          modelId,
        }),
        name: `${claimId}-financial-timeline-${Date.now()}`.substring(0, 80),
      })
    );
    console.log('Financial timeline workflow triggered for claim:', claimId);
  } catch (error) {
    console.warn('Failed to trigger financial timeline workflow:', error);
    // Release lock since workflow didn't start
    await releaseExecutionLock(lockKey);
  }
}

/**
 * Lambda handler for the Agent Worker.
 *
 * Invoked by Step Functions Express Workflow to process agent requests.
 */
export const handler = async (event: WorkerEvent): Promise<WorkerResult> => {
  const startTime = Date.now();
  const { claimId, tenantId, strategy } = event;

  console.log(JSON.stringify({
    claimId,
    strategy,
    action: 'worker-start',
    timestamp: new Date().toISOString(),
  }));

  try {
    let result: any;

    if (strategy === 'full-context') {
      result = await executeFullContextAgent(event);
    } else if (strategy === 'enriched') {
      result = await executeEnrichedAgent(event);
    } else if (strategy === 'financial-timeline') {
      result = await executeFinancialTimelineAgent(event);
      // Financial timeline stores to evaluation results table, not cache
      const duration = Date.now() - startTime;
      // Release execution lock
      await releaseExecutionLock(`lock#${claimId}#${strategy}`);
      console.log(JSON.stringify({
        claimId,
        strategy,
        executionDuration: duration,
        outcome: 'success',
      }));
      return { status: 'success', claimId, strategy, executionDuration: duration };
    } else {
      throw new Error(`Unsupported strategy for worker: ${strategy}`);
    }

    // Build and cache the response
    const cacheKey = buildCacheKey(claimId, strategy, event.chunkingMethod, event.useReranker);
    const response = buildCacheResponse(result, event);
    response.processingTime = Date.now() - startTime;
    await cacheSummary(cacheKey, response);

    // Release execution lock
    await releaseExecutionLock(`lock#${claimId}#${strategy}`);

    // Trigger financial timeline agent if applicable
    if (strategy === 'full-context' && process.env.FINANCIAL_TIMELINE_AGENT_ENDPOINT) {
      await triggerFinancialTimelineWorkflow(claimId, tenantId, event.modelId);
    }

    const duration = Date.now() - startTime;
    console.log(JSON.stringify({
      claimId,
      strategy,
      executionDuration: duration,
      outcome: 'success',
    }));

    return { status: 'success', claimId, strategy, executionDuration: duration };
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    const retryable = isRetryableError(errorMessage);
    const duration = Date.now() - startTime;

    console.log(JSON.stringify({
      claimId,
      strategy,
      executionDuration: duration,
      outcome: retryable ? 'retryable-error' : 'permanent-error',
      error: errorMessage,
    }));

    if (retryable) {
      // Throw to let Step Functions retry with exponential backoff
      throw error;
    }

    // Permanent error: cache error entry so polling client gets feedback
    await cacheErrorResult(claimId, strategy, event.chunkingMethod, event.useReranker, errorMessage);
    await releaseExecutionLock(`lock#${claimId}#${strategy}`);

    return {
      status: 'permanent-error',
      claimId,
      strategy,
      executionDuration: duration,
      error: errorMessage,
    };
  }
};
