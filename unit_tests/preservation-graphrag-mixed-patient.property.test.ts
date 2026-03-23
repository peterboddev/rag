/**
 * Preservation Property Tests — GraphRAG Mixed Patient Data Fix
 *
 * These tests capture the baseline behavior of the UNFIXED code for non-buggy inputs
 * (where the filtered query returns 1+ chunks). They must PASS on the current unfixed code.
 *
 * Property 2a: For all random { claimId, patientId } inputs where filtered query returns 1+ chunks,
 *   verify summary is generated, documentCount matches unique source URIs, and RetrieveCommand
 *   is called once with metadata filter.
 *
 * Property 2b: For all random { claimId, patientId } inputs with useReranker=true and 1+ chunks,
 *   verify rerankingConfiguration is present in the retrieve input.
 *
 * Property 2c: For all random { claimId } inputs, verify executeRagStrategy with 0 filtered chunks
 *   still returns empty results (regression prevention for existing fix).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
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

// Capture RetrieveCommand constructor calls to inspect inputs
const mockRetrieveCommandCalls: any[] = [];
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockAgentSend })),
  RetrieveCommand: jest.fn().mockImplementation((params) => {
    mockRetrieveCommandCalls.push(params);
    return { ...params, _type: 'Retrieve' };
  }),
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
  mockRetrieveCommandCalls.length = 0;
});

/**
 * Generators for random test inputs
 */
const claimIdArb = fc.stringMatching(/^[a-zA-Z0-9-]{3,30}$/).filter((s) => s.length >= 3);
const patientIdArb = fc.stringMatching(/^[a-zA-Z0-9-]{3,30}$/).filter((s) => s.length >= 3);

/**
 * Property 2a: Normal GraphRAG Flow — Summary Generation with 1+ Chunks
 *
 * For all random { claimId, patientId } inputs where the filtered query returns 1+ chunks,
 * verify that:
 *   - A summary is generated (200 status, non-empty summary)
 *   - documentCount matches the number of unique source URIs
 *   - RetrieveCommand is called once with a metadata filter containing patientId
 *
 * **Validates: Requirements 3.1, 3.2**
 */
describe('Property 2a: Normal GraphRAG Flow — Summary Generation with 1+ Chunks', () => {
  it('should generate summary with correct documentCount and single filtered RetrieveCommand call', async () => {
    await fc.assert(
      fc.asyncProperty(
        claimIdArb,
        patientIdArb,
        fc.integer({ min: 1, max: 5 }),
        async (claimId, patientId, numUniqueUris) => {
          // Reset mocks
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();
          mockRetrieveCommandCalls.length = 0;

          // Build chunks with numUniqueUris unique S3 URIs
          const chunks = Array.from({ length: numUniqueUris + 1 }, (_, i) => ({
            content: { text: `Chunk ${i} content for patient ${patientId} claim ${claimId}` },
            location: {
              s3Location: { uri: `s3://bucket/${patientId}/doc${i % numUniqueUris}.pdf` },
            },
            score: 0.9 - i * 0.01,
          }));

          // Mock DynamoDB: cache miss, resolvePatientId, then cache writes
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Some text',
                processingStatus: 'completed',
                claimMetadata: { claimId, patientId },
                tenantId: 'test-tenant',
              }],
            })
            .mockResolvedValue({}); // cache writes

          // Mock GraphRAG KB: filtered query returns chunks
          mockBedrockAgentSend.mockResolvedValueOnce({ retrievalResults: chunks });

          // Mock Bedrock Nova Pro summary response
          mockBedrockSend.mockResolvedValueOnce({
            body: encodeResponse({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      summary: `Summary for claim ${claimId}`,
                      anomalies: [],
                    }),
                  }],
                },
              },
            }),
          });

          const event = createEvent({
            pathParameters: { claimId },
            body: JSON.stringify({ claimId, strategy: 'graph-rag', patientId }),
            headers: { 'x-tenant-id': 'test-tenant' },
          });

          const result = await handler(event);
          const body = JSON.parse(result.body);

          // Should return 200 with a summary
          expect(result.statusCode).toBe(200);
          expect(body.summary).toBeTruthy();
          expect(body.strategy).toBe('graph-rag');

          // documentCount should match unique source URIs
          expect(body.documentCount).toBe(numUniqueUris);

          // RetrieveCommand should be called exactly once (filtered, no fallback)
          expect(mockBedrockAgentSend).toHaveBeenCalledTimes(1);

          // The RetrieveCommand input should contain a metadata filter with patientId
          expect(mockRetrieveCommandCalls.length).toBe(1);
          const retrieveInput = mockRetrieveCommandCalls[0];
          const filter = retrieveInput.retrievalConfiguration?.vectorSearchConfiguration?.filter;
          expect(filter).toBeDefined();
          expect(filter.equals.key).toBe('patientId');
          expect(filter.equals.value).toBe(patientId);
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Property 2b: Reranker Configuration Preserved with 1+ Chunks
 *
 * For all random { claimId, patientId } inputs with useReranker=true and 1+ chunks,
 * verify that rerankingConfiguration is present in the RetrieveCommand input.
 *
 * **Validates: Requirements 3.2**
 */
describe('Property 2b: Reranker Configuration Preserved with 1+ Chunks', () => {
  it('should include rerankingConfiguration in RetrieveCommand when useReranker=true', async () => {
    await fc.assert(
      fc.asyncProperty(
        claimIdArb,
        patientIdArb,
        async (claimId, patientId) => {
          // Reset mocks
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();
          mockRetrieveCommandCalls.length = 0;

          const chunks = [
            {
              content: { text: `Patient ${patientId} claim data` },
              location: { s3Location: { uri: `s3://bucket/${patientId}/doc1.pdf` } },
              score: 0.95,
            },
          ];

          // Mock DynamoDB: cache miss, resolvePatientId, cache writes
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null })
            .mockResolvedValueOnce({
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Some text',
                processingStatus: 'completed',
                claimMetadata: { claimId, patientId },
                tenantId: 'test-tenant',
              }],
            })
            .mockResolvedValue({});

          // Mock GraphRAG KB: filtered query returns chunks
          mockBedrockAgentSend.mockResolvedValueOnce({ retrievalResults: chunks });

          // Mock Bedrock Nova Pro
          mockBedrockSend.mockResolvedValueOnce({
            body: encodeResponse({
              output: {
                message: {
                  content: [{
                    text: JSON.stringify({
                      summary: `Summary for claim ${claimId}`,
                      anomalies: [],
                    }),
                  }],
                },
              },
            }),
          });

          const event = createEvent({
            pathParameters: { claimId },
            body: JSON.stringify({
              claimId,
              strategy: 'graph-rag',
              patientId,
              useReranker: true,
            }),
            headers: { 'x-tenant-id': 'test-tenant' },
          });

          const result = await handler(event);
          const body = JSON.parse(result.body);

          // Should return 200
          expect(result.statusCode).toBe(200);
          expect(body.summary).toBeTruthy();

          // RetrieveCommand should include rerankingConfiguration
          expect(mockRetrieveCommandCalls.length).toBe(1);
          const retrieveInput = mockRetrieveCommandCalls[0];
          expect(retrieveInput.retrievalConfiguration?.rerankingConfiguration).toBeDefined();
          expect(retrieveInput.retrievalConfiguration.rerankingConfiguration.type).toBe(
            'BEDROCK_RERANKING_MODEL'
          );
          expect(
            retrieveInput.retrievalConfiguration.rerankingConfiguration
              .bedrockRerankingConfiguration?.modelConfiguration?.modelArn
          ).toContain('cohere.rerank-v3-5:0');
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Property 2c: RAG Strategy Existing Fix Preserved — 0 Filtered Chunks Returns Empty
 *
 * For all random { claimId } inputs, verify that executeRagStrategy with 0 filtered chunks
 * still returns empty results (regression prevention for the existing fix in executeRagStrategy).
 *
 * **Validates: Requirements 3.4, 3.5**
 */
describe('Property 2c: RAG Strategy Existing Fix — 0 Filtered Chunks Returns Empty', () => {
  it('should return 404 when RAG KB filtered query returns 0 chunks', async () => {
    await fc.assert(
      fc.asyncProperty(
        claimIdArb,
        async (claimId) => {
          // Reset mocks
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();
          mockRetrieveCommandCalls.length = 0;

          // Mock DynamoDB: cache miss, resolvePatientId (no patientId found), cache writes
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Some text',
                processingStatus: 'completed',
                claimMetadata: { claimId },
                tenantId: 'test-tenant',
              }],
            })
            .mockResolvedValue({});

          // Mock RAG KB: filtered query returns 0 chunks (empty results)
          mockBedrockAgentSend.mockResolvedValueOnce({ retrievalResults: [] });

          const event = createEvent({
            pathParameters: { claimId },
            body: JSON.stringify({
              claimId,
              strategy: 'rag',
              chunkingMethod: 'semantic',
            }),
            headers: { 'x-tenant-id': 'test-tenant' },
          });

          const result = await handler(event);

          // Should return 404 (executeRagStrategy returns documentCount=0, caller returns 404)
          expect(result.statusCode).toBe(404);

          // RetrieveCommand should be called exactly once (no unfiltered fallback)
          expect(mockBedrockAgentSend).toHaveBeenCalledTimes(1);

          // No summary should be generated
          expect(mockBedrockSend).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });
});
