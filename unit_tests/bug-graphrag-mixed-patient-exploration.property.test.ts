/**
 * Bug Condition Exploration Property Test — GraphRAG Unfiltered Fallback
 *
 * This test demonstrates the bug in `executeGraphRagStrategy()` where an unfiltered
 * fallback query is executed when the metadata filter returns 0 chunks, causing
 * mixed patient data to be returned in the summary.
 *
 * **EXPECTED TO FAIL on unfixed code** — failure confirms the bug exists.
 *
 * Property 1: Bug Condition - For any { claimId, useReranker, patientId } input where
 * the GraphRAG KB filtered query returns 0 chunks, RetrieveCommand SHALL be called
 * exactly ONCE (filtered only, no unfiltered fallback) and the handler SHALL return 404.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import * as fc from 'fast-check';

// Mock AWS SDK clients before importing handler
const mockDynamoSend = jest.fn();
const mockBedrockSend = jest.fn();
const mockBedrockAgentSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockDynamoSend }),
  },
  QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
  ScanCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Scan' })),
  GetCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Get' })),
  PutCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Put' })),
  BatchWriteCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'BatchWrite' })),
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  InvokeModelCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'InvokeModel' })),
}));

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockAgentSend })),
  RetrieveCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Retrieve' })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteObject' })),
}));

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/lambda/claim-summary-orchestrator';

/**
 * Helper to create a minimal APIGatewayProxyEvent
 */
function createEvent(overrides: {
  pathParameters?: Record<string, string> | null;
  body?: string | null;
  headers?: Record<string, string>;
}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/claims/test-claim/summary',
    pathParameters: overrides.pathParameters ?? { claimId: 'test-claim-001' },
    body: overrides.body ?? null,
    headers: overrides.headers ?? { 'x-tenant-id': 'test-tenant' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '/claims/{claimId}/summary',
  };
}

/** Encode an object as Uint8Array (simulates Bedrock response body) */
function encodeResponse(obj: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoSend.mockReset();
  mockBedrockSend.mockReset();
  mockBedrockAgentSend.mockReset();
});

/**
 * Generators for random test inputs
 */
const claimIdArb = fc.stringMatching(/^[a-zA-Z0-9-]{3,30}$/).filter((s) => s.length >= 3);
const patientIdArb = fc.stringMatching(/^[a-zA-Z0-9-]{3,30}$/).filter((s) => s.length >= 3);
const useRerankerArb = fc.boolean();

/**
 * Property 1: Bug Condition — GraphRAG Unfiltered Fallback on Empty Filter Results
 *
 * For any { claimId, useReranker, patientId } input where the GraphRAG KB filtered
 * query returns 0 chunks, the handler SHALL:
 *   - Call RetrieveCommand exactly ONCE (filtered only, no unfiltered fallback)
 *   - Return 404 (since documentCount === 0 triggers 404 in the caller)
 *   - NOT generate a summary from mixed patient data
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */
describe('Property 1: Bug Condition — GraphRAG Unfiltered Fallback on Empty Filter Results', () => {
  it('should call RetrieveCommand exactly once and return 404 when filtered query returns 0 chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        claimIdArb,
        useRerankerArb,
        patientIdArb,
        async (claimId, useReranker, patientId) => {
          // Reset mocks for each iteration
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();

          // Mock DynamoDB: cache miss, then resolvePatientId returns a document with patientId
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss (GetCommand)
            .mockResolvedValueOnce({
              // resolvePatientId → queryClaimDocuments returns doc with patientId
              Items: [
                {
                  documentId: 'doc-1',
                  fileName: 'test.pdf',
                  extractedText: 'Some text',
                  processingStatus: 'completed',
                  claimMetadata: { claimId, patientId },
                  tenantId: 'test-tenant',
                },
              ],
            })
            .mockResolvedValue({}); // any subsequent DynamoDB calls (cache writes, etc.)

          // Mock BedrockAgentRuntimeClient.send (RetrieveCommand):
          // First call (filtered) → returns empty results (0 chunks)
          // Second call (unfiltered fallback — the bug) → returns chunks from multiple patients
          mockBedrockAgentSend
            .mockResolvedValueOnce({ retrievalResults: [] }) // filtered query: 0 chunks
            .mockResolvedValueOnce({
              // unfiltered fallback: chunks from MULTIPLE patients (data isolation violation)
              retrievalResults: [
                {
                  content: { text: `Patient ${patientId} claim data for ${claimId}` },
                  location: { s3Location: { uri: `s3://bucket/${patientId}/doc1.pdf` } },
                  score: 0.9,
                },
                {
                  content: { text: 'Patient OTHER-PATIENT-999 unrelated claim data' },
                  location: { s3Location: { uri: 's3://bucket/OTHER-PATIENT-999/doc2.pdf' } },
                  score: 0.85,
                },
              ],
            });

          // Mock BedrockRuntimeClient.send (InvokeModelCommand) — valid summary response
          // This should NOT be called if the bug is fixed (no summary from mixed data)
          mockBedrockSend.mockResolvedValueOnce({
            body: encodeResponse({
              output: {
                message: {
                  content: [
                    {
                      text: JSON.stringify({
                        summary: 'Mixed patient summary — THIS SHOULD NOT EXIST',
                        anomalies: [],
                      }),
                    },
                  ],
                },
              },
            }),
          });

          // Call the handler with strategy: 'graph-rag'
          const event = createEvent({
            pathParameters: { claimId },
            body: JSON.stringify({
              claimId,
              strategy: 'graph-rag',
              patientId,
              useReranker,
            }),
            headers: { 'x-tenant-id': 'test-tenant' },
          });

          const result = await handler(event);
          const body = JSON.parse(result.body);

          // ASSERTION 1: RetrieveCommand should be called exactly ONCE (filtered only)
          // On buggy code, it's called TWICE (once filtered, once unfiltered fallback)
          expect(mockBedrockAgentSend).toHaveBeenCalledTimes(1);

          // ASSERTION 2: Handler should return 404 (documentCount === 0 triggers 404)
          // On buggy code, it returns 200 with a summary from mixed patient data
          expect(result.statusCode).toBe(404);

          // ASSERTION 3: No summary should be generated from mixed patient data
          // On buggy code, body.summary contains mixed patient information
          expect(body.summary).toBeUndefined();
        }
      ),
      { numRuns: 50 }
    );
  });
});
