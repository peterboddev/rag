/**
 * AgentCore Client Service
 *
 * Shared module for invoking AgentCore Runtime agents. Extracted from the
 * claim-summary-orchestrator to be reused by both the orchestrator and
 * the agent-worker Lambda.
 *
 * @module agentcore-client
 */

import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';

/**
 * Default timeout for AgentCore Runtime API calls (in milliseconds).
 */
export const AGENTCORE_TIMEOUT_MS = parseInt(process.env.AGENTCORE_TIMEOUT_MS || '120000', 10);

// AgentCore client (lazy-initialized)
let agentCoreClient: BedrockAgentCoreClient | null = null;

/**
 * Returns a lazily-initialized BedrockAgentCoreClient singleton.
 */
export function getAgentCoreClient(): BedrockAgentCoreClient {
  if (!agentCoreClient) {
    agentCoreClient = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || 'us-east-1',
      requestHandler: { requestTimeout: AGENTCORE_TIMEOUT_MS } as any,
    });
  }
  return agentCoreClient;
}

/**
 * Invoke an AgentCore Runtime agent using the AWS SDK.
 *
 * Handles streaming responses including SSE (text/event-stream) format
 * and plain JSON responses.
 *
 * @param agentRuntimeArn - The ARN or agent ID of the AgentCore Runtime agent
 * @param payload - JSON-serializable request payload
 * @returns Parsed JSON response from the agent
 */
export async function invokeAgentCoreRuntime(
  agentRuntimeArn: string,
  payload: Record<string, unknown>
): Promise<any> {
  const body = JSON.stringify(payload);
  console.log(`Invoking AgentCore Runtime: ${agentRuntimeArn}`);

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    payload: new TextEncoder().encode(body),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await getAgentCoreClient().send(command);

  // Collect the streaming response
  const chunks: string[] = [];
  const responseStream = response.response;

  if (responseStream) {
    // Handle ReadableStream / async iterable
    if (Symbol.asyncIterator in Object(responseStream)) {
      for await (const chunk of responseStream as AsyncIterable<Uint8Array>) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    } else if (typeof (responseStream as any).transformToString === 'function') {
      chunks.push(await (responseStream as any).transformToString());
    } else if (typeof (responseStream as any).read === 'function') {
      // Node.js Readable stream
      for await (const chunk of responseStream as any) {
        chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      }
    }
  }

  const responseBody = chunks.join('');

  // Handle text/event-stream format (SSE)
  if (response.contentType?.includes('text/event-stream')) {
    const dataLines = responseBody
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => line.substring(6));
    const fullContent = dataLines.join('');
    try {
      return JSON.parse(fullContent);
    } catch {
      return { summary: fullContent, anomalies: [], documentCount: 0, strategy: 'unknown' };
    }
  }

  // Handle plain JSON response
  try {
    return JSON.parse(responseBody);
  } catch {
    throw new Error(`AgentCore Runtime returned invalid JSON: ${responseBody.substring(0, 200)}`);
  }
}
