/**
 * Unit tests for RAG Reranker Integration
 *
 * Tests that the useReranker flag works correctly for the RAG strategy,
 * including handler response fields and cache key generation.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

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

import { describe, it, expect, beforeEach } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/lambda/claim-summary-orchestrator';
import { buildCacheKey } from '../src/services/summary-cache';

/** Helper to create a minimal APIGatewayProxyEvent */
function createEvent(overrides: {
  pathParameters?: Record<string, string> | null;
  body?: string | null;
  httpMethod?: string;
  resource?: string;
}): APIGatewayProxyEvent {
  return {
    httpMethod: overrides.httpMethod || 'POST',
    path: '/claims/test-claim/summary',
    pathParameters: overrides.pathParameters !== undefined ? overrides.pathParameters : { claimId: 'test-claim-001' },
    body: overrides.body ?? null,
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: overrides.resource || '/claims/{claimId}/summary',
  };
}

/** Encode a string as Uint8Array (simulates Bedrock response body) */
function encodeResponse(obj: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Sample Bedrock Nova Pro response */
function mockBedrockResponse(summary: string) {
  return {
    body: encodeResponse({
      output: {
        message: {
          content: [{ text: JSON.stringify({ summary, anomalies: [] }) }],
        },
      },
    }),
  };
}

/** Sample documents from DynamoDB */
const sampleDocuments = [
  {
    documentId: 'doc-1',
    fileName: 'CMS1500_claim_001.pdf',
    extractedText: 'Patient: John Doe, DOB: 1980-01-15',
    processingStatus: 'completed',
    claimMetadata: { claimId: 'test-claim-001', documentType: 'CMS1500' },
    tenantId: 'local-dev-tenant',
  },
];

/** Sample KB retrieval results */
const sampleRetrievalResults = {
  retrievalResults: [
    {
      content: { text: 'Patient John Doe, claim details...' },
      location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
      score: 0.95,
    },
    {
      content: { text: 'EOB details, amount $1500...' },
      location: { s3Location: { uri: 's3://bucket/doc2.pdf' } },
      score: 0.88,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoSend.mockReset();
  mockBedrockSend.mockReset();
  mockBedrockAgentSend.mockReset();
});

/**
 * Helper: set up mocks for a successful RAG or graph-rag handler call.
 * Mocks cache miss, resolvePatientId, KB retrieval, Bedrock summary, and cache write.
 */
function setupSuccessfulStrategyMocks() {
  mockDynamoSend
    .mockResolvedValueOnce({ Item: null })              // cache miss (GetCommand)
    .mockResolvedValueOnce({ Items: sampleDocuments })   // resolvePatientId
    .mockResolvedValue({});                              // cache write ops
  mockBedrockAgentSend.mockResolvedValueOnce(sampleRetrievalResults);
  mockBedrockSend.mockResolvedValueOnce(mockBedrockResponse('Test summary'));
}

describe('RAG Reranker - Handler Response (Req 6.1, 6.4)', () => {
  it('should return useReranker: true when RAG request has useReranker: true', async () => {
    setupSuccessfulStrategyMocks();

    const event = createEvent({
      body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'semantic', useReranker: true }),
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.useReranker).toBe(true);
  });

  it('should not return useReranker: true when RAG request has useReranker: false', async () => {
    setupSuccessfulStrategyMocks();

    const event = createEvent({
      body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'semantic', useReranker: false }),
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.useReranker).not.toBe(true);
  });

  it('should default useReranker to false when RAG request omits the field', async () => {
    setupSuccessfulStrategyMocks();

    const event = createEvent({
      body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'semantic' }),
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.useReranker).not.toBe(true);
  });

  it('should return useReranker: true for graph-rag with useReranker: true (regression)', async () => {
    setupSuccessfulStrategyMocks();

    const event = createEvent({
      body: JSON.stringify({ strategy: 'graph-rag', useReranker: true }),
    });

    const result = await handler(event);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.useReranker).toBe(true);
    expect(body.strategy).toBe('graph-rag');
  });
});

describe('RAG Reranker - Cache Key (Req 6.3)', () => {
  it('should end with #reranker for rag + useReranker: true', () => {
    const key = buildCacheKey('claim-001', 'rag', 'semantic', true);
    expect(key).toBe('claim-001#rag#semantic#reranker');
    expect(key.endsWith('#reranker')).toBe(true);
  });

  it('should NOT end with #reranker for rag + useReranker: false', () => {
    const key = buildCacheKey('claim-001', 'rag', 'semantic', false);
    expect(key).toBe('claim-001#rag#semantic');
    expect(key.endsWith('#reranker')).toBe(false);
  });

  it('should NOT end with #reranker for rag when useReranker is omitted', () => {
    const key = buildCacheKey('claim-001', 'rag', 'semantic');
    expect(key).toBe('claim-001#rag#semantic');
    expect(key.endsWith('#reranker')).toBe(false);
  });

  it('should end with #reranker for graph-rag + useReranker: true', () => {
    const key = buildCacheKey('claim-001', 'graph-rag', 'none', true);
    expect(key).toBe('claim-001#graph-rag#none#reranker');
  });

  it('should NOT end with #reranker for full-context regardless of useReranker', () => {
    const key = buildCacheKey('claim-001', 'full-context', 'none', true);
    expect(key).toBe('claim-001#full-context#none');
    expect(key.endsWith('#reranker')).toBe(false);
  });
});
