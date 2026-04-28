/**
 * Comprehensive unit tests for Claim Summary Orchestrator Lambda
 *
 * Integration-style unit tests that test the handler function end-to-end
 * with mocked AWS dependencies. Covers input validation, error handling,
 * caching, and anomaly detection flows.
 *
 * Validates: Requirements 9.1-9.10
 */

// Mock AWS SDK clients before importing handler
const mockDynamoSend = jest.fn();
const mockBedrockSend = jest.fn();
const mockBedrockAgentSend = jest.fn();
const mockS3Send = jest.fn();

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
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteObject' })),
}));

jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  InvokeCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Invoke' })),
}));

jest.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  InvokeAgentRuntimeCommand: jest.fn().mockImplementation((params) => params),
}));

import { describe, it, expect, beforeEach } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/lambda/claim-summary-orchestrator';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createEvent(overrides: {
  pathParameters?: Record<string, string> | null;
  body?: string | null;
  httpMethod?: string;
  path?: string;
  resource?: string;
}): APIGatewayProxyEvent {
  return {
    httpMethod: overrides.httpMethod || 'POST',
    path: overrides.path || '/claims/test-claim/summary',
    pathParameters: overrides.pathParameters !== undefined
      ? overrides.pathParameters
      : { claimId: 'test-claim-001' },
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

function encodeBedrockBody(obj: object): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function mockBedrockResponse(summary: string, anomalies: any[] = []) {
  return {
    body: encodeBedrockBody({
      output: {
        message: {
          content: [{ text: JSON.stringify({ summary, anomalies }) }],
        },
      },
    }),
  };
}

const sampleDocuments = [
  {
    documentId: 'doc-1',
    fileName: 'CMS1500_claim_001.pdf',
    extractedText: 'Patient: John Doe, DOB: 1980-01-15, Service Date: 2024-03-01, Diagnosis: J06.9',
    processingStatus: 'completed',
    claimMetadata: { claimId: 'test-claim-001', documentType: 'CMS1500' },
    tenantId: 'local-dev-tenant',
  },
  {
    documentId: 'doc-2',
    fileName: 'EOB_claim_001.pdf',
    extractedText: 'Explanation of Benefits for John Doe, Amount: $1500, Payment Date: 2024-03-15',
    processingStatus: 'completed',
    claimMetadata: { claimId: 'test-claim-001', documentType: 'EOB' },
    tenantId: 'local-dev-tenant',
  },
];

/** Sets up mocks for a cache miss followed by a successful document query and Bedrock call */
function setupCacheMissWithDocuments(summary = 'Generated summary', anomalies: any[] = []) {
  mockDynamoSend
    .mockResolvedValueOnce({ Item: null })           // cache miss (GetCommand)
    .mockResolvedValueOnce({ Items: sampleDocuments }) // resolvePatientId → queryClaimDocuments
    .mockResolvedValueOnce({ Items: sampleDocuments }) // documents query (full-context)
    ; // cache writes handled by global mock
  mockBedrockSend.mockResolvedValueOnce(mockBedrockResponse(summary, anomalies));
  mockS3Send; // cache writes handled by global mock
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoSend.mockReset();
  mockBedrockSend.mockReset();
  mockBedrockAgentSend.mockReset();
  mockS3Send.mockReset();
  // Default: return sample documents for any DynamoDB query
  mockDynamoSend.mockImplementation((cmd: any) => {
    if (cmd._type === 'Query') return Promise.resolve({ Items: sampleDocuments });
    if (cmd._type === 'Get') return Promise.resolve({ Item: null });
    if (cmd._type === 'Put') return Promise.resolve({});
    if (cmd._type === 'BatchWrite') return Promise.resolve({});
    if (cmd._type === 'Scan') return Promise.resolve({ Items: sampleDocuments });
    return Promise.resolve({ Items: sampleDocuments });
  });
});

// ─── 18.1: Orchestrator Lambda Comprehensive Tests ──────────────────────────

describe('Claim Summary Orchestrator - Comprehensive Tests (Task 18.1)', () => {
  // Req 9.1: Missing claimId returns 400
  describe('missing claimId returns 400', () => {
    it('should return 400 when pathParameters is null', async () => {
      const event = createEvent({
        pathParameters: null,
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing claimId parameter');
    });

    it('should return 400 when claimId key is absent from pathParameters', async () => {
      const event = createEvent({
        pathParameters: {},
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing claimId parameter');
    });
  });

  // Req 9.1: Missing strategy returns 400
  describe('missing strategy returns 400', () => {
    it('should return 400 when body is null', async () => {
      const event = createEvent({ body: null });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing required field: strategy');
    });

    it('should return 400 when body is empty object', async () => {
      const event = createEvent({ body: JSON.stringify({}) });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing required field: strategy');
    });

    it('should return 400 when strategy is empty string', async () => {
      const event = createEvent({ body: JSON.stringify({ strategy: '' }) });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing required field: strategy');
    });
  });

  // Req 9.1: Invalid strategy returns 400
  describe('invalid strategy returns 400', () => {
    it('should return 400 for unknown strategy string', async () => {
      const event = createEvent({ body: JSON.stringify({ strategy: 'unknown-strategy' }) });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        'Invalid strategy. Must be one of: full-context, rag, graph-rag, enriched'
      );
    });

    it('should return 400 for numeric strategy', async () => {
      const event = createEvent({ body: JSON.stringify({ strategy: 42 }) });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  // Req 9.1: Invalid chunkingMethod for RAG returns 400
  describe('invalid chunkingMethod for RAG returns 400', () => {
    it('should return 400 when chunkingMethod is missing for rag strategy', async () => {
      const event = createEvent({ body: JSON.stringify({ strategy: 'rag' }) });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('chunkingMethod');
    });

    it('should return 400 when chunkingMethod is invalid for rag strategy', async () => {
      const event = createEvent({
        body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'invalid-method' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe(
        'Invalid chunkingMethod. Must be one of: full-document, semantic'
      );
    });
  });

  // Req 9.2: No documents returns 404
  describe('no documents returns 404', () => {
    it('should return 404 when no documents found for full-context', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null })  // cache miss
        .mockResolvedValueOnce({ Items: [] })   // resolvePatientId → queryClaimDocuments (empty)
        .mockResolvedValueOnce({ Items: [] });   // documents query (empty)

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toContain('No documents found');
    });

    it('should return 404 when no documents found for graph-rag', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null })  // cache miss
        .mockResolvedValueOnce({ Items: [] });  // resolvePatientId → queryClaimDocuments (empty)
      mockBedrockAgentSend
        .mockResolvedValueOnce({ retrievalResults: [] })  // filtered query
        .mockResolvedValueOnce({ retrievalResults: [] }); // fallback unfiltered

      const event = createEvent({
        body: JSON.stringify({ strategy: 'graph-rag' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });

    it('should return 404 for RAG when Knowledge Base returns no chunks', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null }) // cache miss
        .mockResolvedValueOnce({ Items: sampleDocuments }); // resolvePatientId → queryClaimDocuments
      mockBedrockAgentSend
        .mockResolvedValueOnce({ retrievalResults: [] })  // filtered query returns nothing
        .mockResolvedValueOnce({ retrievalResults: [] });  // fallback unfiltered also empty

      const event = createEvent({
        body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'semantic' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(404);
    });
  });

  // Req 9.2 (variant): No processed documents returns 400
  describe('no processed documents returns 400', () => {
    it('should return 400 when documents exist but none have extracted text', async () => {
      const unprocessedDocs = [
        {
          documentId: 'doc-1',
          fileName: 'pending.pdf',
          extractedText: '',
          processingStatus: 'processing',
          claimMetadata: { claimId: 'test-claim-001' },
          tenantId: 'local-dev-tenant',
        },
        {
          documentId: 'doc-2',
          fileName: 'pending2.pdf',
          processingStatus: 'queued',
          claimMetadata: { claimId: 'test-claim-001' },
          tenantId: 'local-dev-tenant',
        },
      ];

      mockDynamoSend
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({ Items: unprocessedDocs }) // resolvePatientId
        .mockResolvedValueOnce({ Items: unprocessedDocs }); // documents query

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('No summarizable content');
    });

    it('should return 400 when all documents have whitespace-only text', async () => {
      const whitespaceOnlyDocs = [
        {
          documentId: 'doc-1',
          fileName: 'blank.pdf',
          extractedText: '   \n\t  ',
          processingStatus: 'completed',
          claimMetadata: { claimId: 'test-claim-001' },
          tenantId: 'local-dev-tenant',
        },
      ];

      mockDynamoSend
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({ Items: whitespaceOnlyDocs }) // resolvePatientId
        .mockResolvedValueOnce({ Items: whitespaceOnlyDocs }); // documents query

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toContain('No summarizable content');
    });
  });

  // Req 9.6: Bedrock failure returns 502
  describe('Bedrock failure returns 502', () => {
    it('should return 502 when Bedrock invocation throws', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({ Items: sampleDocuments }) // resolvePatientId
        .mockResolvedValueOnce({ Items: sampleDocuments }); // documents query
      mockBedrockSend.mockRejectedValueOnce(new Error('Bedrock service unavailable'));

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(502);
      expect(JSON.parse(result.body).error).toContain('Summary generation failed');
    });

    it('should return 502 when RAG Knowledge Base retrieval throws', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null }) // cache miss
        .mockResolvedValueOnce({ Items: sampleDocuments }); // resolvePatientId
      mockBedrockAgentSend.mockRejectedValueOnce(new Error('KB unavailable'));

      const event = createEvent({
        body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'full-document' }),
      });
      const result = await handler(event);
      expect(result.statusCode).toBe(502);
      expect(JSON.parse(result.body).error).toContain('Summary generation failed');
    });
  });

  // Req 9.8: Cached summary returned with correct flags
  describe('cached summary returned with correct flags', () => {
    it('should return cached response with cached:true and cachedAt when cache hit', async () => {
      const cachedContent = {
        summary: 'Previously generated summary',
        anomalies: [],
        strategy: 'full-context',
        documentCount: 2,
        processingTime: 1500,
        generatedAt: '2024-01-15T10:30:00Z',
        cached: false,
      };

      // Mock cache hit: DynamoDB GetCommand returns metadata
      mockDynamoSend.mockResolvedValueOnce({
        Item: {
          cacheKey: 'test-claim-001#full-context#none',
          s3Key: 'summaries/test-claim-001/full-context/none.json',
          strategy: 'full-context',
          documentCount: 2,
          processingTime: 1500,
          generatedAt: '2024-01-15T10:30:00Z',
          ttl: Math.floor(Date.now() / 1000) + 86400,
        },
      });

      // Mock S3 GetObject returns the cached content
      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(cachedContent)),
        },
      });

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.cached).toBe(true);
      expect(body.cachedAt).toBeDefined();
      expect(body.generatedAt).toBe('2024-01-15T10:30:00Z');
      expect(body.summary).toBe('Previously generated summary');
    });
  });

  // Req 9.9: forceRegenerate triggers async regeneration (202)
  describe('forceRegenerate triggers async regeneration', () => {
    it('should return 202 with processing status when forceRegenerate is true', async () => {
      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context', forceRegenerate: true }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(202);
      expect(body.status).toBe('processing');
      expect(body.claimId).toBe('test-claim-001');
      expect(body.strategy).toBe('full-context');
    });

    it('should not check DynamoDB cache when forceRegenerate is true', async () => {
      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context', forceRegenerate: true }),
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(202);
      // The first DynamoDB call should not be a cache GetCommand
      const firstCall = mockDynamoSend.mock.calls[0]?.[0];
      expect(firstCall?._type).not.toBe('Get');
    });
  });

  // Req 9.7: Anomalies array returned when detected
  describe('anomalies array returned when detected', () => {
    it('should include anomalies in response when Bedrock detects them', async () => {
      const detectedAnomalies = [
        {
          description: 'Service date (2024-01-15) precedes patient birth date (2024-06-01)',
          severity: 'critical',
          sourceDocument: 'CMS1500_claim_001.pdf',
          dataValues: { serviceDate: '2024-01-15', birthDate: '2024-06-01' },
        },
        {
          description: 'Duplicate provider information across documents',
          severity: 'warning',
          sourceDocument: 'EOB_claim_001.pdf',
          dataValues: { provider: 'Dr. Smith' },
        },
      ];

      setupCacheMissWithDocuments('Summary with anomalies', detectedAnomalies);

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.anomalies).toHaveLength(2);
      expect(body.anomalies[0].severity).toBe('critical');
      expect(body.anomalies[0].description).toContain('Service date');
      expect(body.anomalies[1].severity).toBe('warning');
    });

    it('should return empty anomalies array when none detected', async () => {
      setupCacheMissWithDocuments('Clean summary', []);

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.anomalies).toEqual([]);
    });
  });

  // Additional: Response structure completeness
  describe('response structure completeness', () => {
    it('should return all required fields in a successful response', async () => {
      setupCacheMissWithDocuments('Complete summary');

      const event = createEvent({
        body: JSON.stringify({ strategy: 'full-context' }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(typeof body.summary).toBe('string');
      expect(body.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(body.anomalies)).toBe(true);
      expect(body.strategy).toBe('full-context');
      expect(typeof body.documentCount).toBe('number');
      expect(body.documentCount).toBeGreaterThanOrEqual(1);
      expect(typeof body.processingTime).toBe('number');
      expect(body.processingTime).toBeGreaterThanOrEqual(0);
      expect(typeof body.generatedAt).toBe('string');
      expect(body.cached).toBe(false);
    });

    it('should include chunkingMethod in response for RAG strategy', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({ Item: null }) // cache miss
        .mockResolvedValueOnce({ Items: sampleDocuments }); // resolvePatientId
      mockBedrockAgentSend.mockResolvedValueOnce({
        retrievalResults: [
          {
            content: { text: 'Chunk content for claim' },
            location: { s3Location: { uri: 's3://bucket/doc1.pdf' } },
            score: 0.9,
          },
        ],
      });
      mockBedrockSend.mockResolvedValueOnce(mockBedrockResponse('RAG summary'));
      mockDynamoSend; // cache writes handled by global mock
      mockS3Send; // cache writes handled by global mock

      const event = createEvent({
        body: JSON.stringify({ strategy: 'rag', chunkingMethod: 'semantic' }),
      });
      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.strategy).toBe('rag');
      expect(body.chunkingMethod).toBe('semantic');
    });
  });
});
