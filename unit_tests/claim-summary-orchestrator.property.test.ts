/**
 * Property-based tests for Claim Summary Orchestrator Lambda handler
 * Uses fast-check library with minimum 100 iterations per property.
 *
 * This file contains property tests for Tasks 4.6, 4.7, 4.8.
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

import { describe, it, expect, beforeEach } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/lambda/claim-summary-orchestrator';

/**
 * Valid strategies as defined in the orchestrator
 */
const VALID_STRATEGIES = ['full-context', 'rag', 'graph-rag'] as const;

/**
 * Helper to create a minimal APIGatewayProxyEvent for testing
 */
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

beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoSend.mockReset();
  mockBedrockSend.mockReset();
  mockBedrockAgentSend.mockReset();
});

/**
 * Property 3: Strategy Validation
 *
 * For any string value provided as the `strategy` field in a summary request,
 * the Claim_Summary_API shall accept only the values "full-context", "rag", or "graph-rag",
 * and reject all other values with a 400 status code.
 *
 * **Validates: Requirements 3.2**
 */
describe('Property 3: Strategy Validation', () => {
  /**
   * Arbitrary string generator that excludes valid strategies.
   * This ensures we test with strings that should be rejected.
   */
  const invalidStrategyArb = fc.string().filter(
    (s) => !VALID_STRATEGIES.includes(s as typeof VALID_STRATEGIES[number])
  );

  it('should accept only valid strategies (full-context, rag, graph-rag)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...VALID_STRATEGIES),
        async (validStrategy) => {
          // Reset mocks for each iteration
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();

          // For 'rag' strategy, we need a valid chunkingMethod
          const body = validStrategy === 'rag'
            ? { strategy: validStrategy, chunkingMethod: 'semantic' }
            : { strategy: validStrategy };

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          // Mock cache miss and documents query for valid strategies
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({ // documents query
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Test document content',
                processingStatus: 'completed',
                claimMetadata: { claimId: 'test-claim-001' },
                tenantId: 'local-dev-tenant',
              }],
            })
            .mockResolvedValue({}); // cache write ops

          // Mock Bedrock response
          mockBedrockSend.mockResolvedValueOnce({
            body: new TextEncoder().encode(JSON.stringify({
              output: {
                message: {
                  content: [{ text: JSON.stringify({ summary: 'Test summary', anomalies: [] }) }],
                },
              },
            })),
          });

          // Mock Knowledge Base for RAG strategy
          if (validStrategy === 'rag') {
            mockBedrockAgentSend.mockResolvedValueOnce({
              retrievalResults: [{
                content: { text: 'Retrieved chunk content' },
                location: { s3Location: { uri: 's3://bucket/doc.pdf' } },
                score: 0.9,
              }],
            });
          }

          const result = await handler(event);

          // Valid strategies should NOT return 400 for invalid strategy error
          // They may return other status codes (200, 404, 502) depending on data
          if (result.statusCode === 400) {
            const body = JSON.parse(result.body);
            // If 400, it should NOT be due to invalid strategy
            expect(body.error).not.toBe('Invalid strategy. Must be one of: full-context, rag, graph-rag');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject all invalid strategy values with 400 status code', async () => {
    await fc.assert(
      fc.asyncProperty(invalidStrategyArb, async (invalidStrategy) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({ strategy: invalidStrategy }),
        });

        const result = await handler(event);

        // Invalid strategies should return 400
        expect(result.statusCode).toBe(400);

        const body = JSON.parse(result.body);
        // Check for appropriate error message
        if (invalidStrategy === '' || invalidStrategy === null || invalidStrategy === undefined) {
          expect(body.error).toBe('Missing required field: strategy');
        } else {
          expect(body.error).toBe('Invalid strategy. Must be one of: full-context, rag, graph-rag');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should reject empty string strategy with 400 status code', async () => {
    const event = createEvent({
      pathParameters: { claimId: 'test-claim-001' },
      body: JSON.stringify({ strategy: '' }),
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing required field: strategy');
  });

  it('should reject null strategy with 400 status code', async () => {
    const event = createEvent({
      pathParameters: { claimId: 'test-claim-001' },
      body: JSON.stringify({ strategy: null }),
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing required field: strategy');
  });

  it('should reject numeric strategy values with 400 status code', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), async (numericStrategy) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({ strategy: numericStrategy }),
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(400);

        const body = JSON.parse(result.body);
        // Falsy numeric values (0, NaN) are caught by the !request.strategy check
        if (!numericStrategy) {
          expect(body.error).toBe('Missing required field: strategy');
        } else {
          expect(body.error).toBe('Invalid strategy. Must be one of: full-context, rag, graph-rag');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should reject object strategy values with 400 status code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ key: fc.string() }),
        async (objectStrategy) => {
          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify({ strategy: objectStrategy }),
          });

          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          expect(JSON.parse(result.body).error).toBe('Invalid strategy. Must be one of: full-context, rag, graph-rag');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject array strategy values with 400 status code', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string()), async (arrayStrategy) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({ strategy: arrayStrategy }),
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toBe('Invalid strategy. Must be one of: full-context, rag, graph-rag');
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Property 4: Chunking Method Validation for RAG Strategy
 *
 * For any summary request where `strategy` is "rag", the Claim_Summary_API shall accept
 * only "full-document" or "semantic" as valid `chunkingMethod` values, and reject all
 * other values with a 400 status code.
 *
 * **Validates: Requirements 3.3**
 */
describe('Property 4: Chunking Method Validation for RAG Strategy', () => {
  /**
   * Valid chunking methods as defined in the orchestrator
   */
  const VALID_CHUNKING_METHODS = ['full-document', 'semantic'] as const;

  /**
   * Arbitrary string generator that excludes valid chunking methods.
   * This ensures we test with strings that should be rejected.
   */
  const invalidChunkingMethodArb = fc.string().filter(
    (s) => !VALID_CHUNKING_METHODS.includes(s as typeof VALID_CHUNKING_METHODS[number])
  );

  it('should accept only valid chunking methods (full-document, semantic) when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...VALID_CHUNKING_METHODS),
        async (validChunkingMethod) => {
          // Reset mocks for each iteration
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify({
              strategy: 'rag',
              chunkingMethod: validChunkingMethod,
            }),
          });

          // Mock cache miss
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({ // documents query
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Test document content',
                processingStatus: 'completed',
                claimMetadata: { claimId: 'test-claim-001' },
                tenantId: 'local-dev-tenant',
              }],
            })
            .mockResolvedValue({}); // cache write ops

          // Mock Knowledge Base retrieval
          mockBedrockAgentSend.mockResolvedValueOnce({
            retrievalResults: [{
              content: { text: 'Retrieved chunk content' },
              location: { s3Location: { uri: 's3://bucket/doc.pdf' } },
              score: 0.9,
            }],
          });

          // Mock Bedrock response
          mockBedrockSend.mockResolvedValueOnce({
            body: new TextEncoder().encode(JSON.stringify({
              output: {
                message: {
                  content: [{ text: JSON.stringify({ summary: 'Test summary', anomalies: [] }) }],
                },
              },
            })),
          });

          const result = await handler(event);

          // Valid chunking methods should NOT return 400 for invalid chunkingMethod error
          if (result.statusCode === 400) {
            const body = JSON.parse(result.body);
            // If 400, it should NOT be due to invalid chunkingMethod
            expect(body.error).not.toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
            expect(body.error).not.toBe('Missing required field: chunkingMethod (required when strategy is rag)');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject all invalid chunkingMethod values with 400 status code when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(invalidChunkingMethodArb, async (invalidChunkingMethod) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({
            strategy: 'rag',
            chunkingMethod: invalidChunkingMethod,
          }),
        });

        const result = await handler(event);

        // Invalid chunking methods should return 400
        expect(result.statusCode).toBe(400);

        const body = JSON.parse(result.body);
        // Check for appropriate error message
        if (invalidChunkingMethod === '' || invalidChunkingMethod === null || invalidChunkingMethod === undefined) {
          expect(body.error).toBe('Missing required field: chunkingMethod (required when strategy is rag)');
        } else {
          expect(body.error).toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should reject missing chunkingMethod with 400 status code when strategy is rag', async () => {
    const event = createEvent({
      pathParameters: { claimId: 'test-claim-001' },
      body: JSON.stringify({ strategy: 'rag' }), // No chunkingMethod
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing required field: chunkingMethod (required when strategy is rag)');
  });

  it('should reject empty string chunkingMethod with 400 status code when strategy is rag', async () => {
    const event = createEvent({
      pathParameters: { claimId: 'test-claim-001' },
      body: JSON.stringify({ strategy: 'rag', chunkingMethod: '' }),
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing required field: chunkingMethod (required when strategy is rag)');
  });

  it('should reject null chunkingMethod with 400 status code when strategy is rag', async () => {
    const event = createEvent({
      pathParameters: { claimId: 'test-claim-001' },
      body: JSON.stringify({ strategy: 'rag', chunkingMethod: null }),
    });

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('Missing required field: chunkingMethod (required when strategy is rag)');
  });

  it('should reject numeric chunkingMethod values with 400 status code when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer(), async (numericChunkingMethod) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({
            strategy: 'rag',
            chunkingMethod: numericChunkingMethod,
          }),
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(400);

        const body = JSON.parse(result.body);
        // Falsy numeric values (0, NaN) are caught by the !request.chunkingMethod check
        if (!numericChunkingMethod) {
          expect(body.error).toBe('Missing required field: chunkingMethod (required when strategy is rag)');
        } else {
          expect(body.error).toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should reject object chunkingMethod values with 400 status code when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ key: fc.string() }),
        async (objectChunkingMethod) => {
          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify({
              strategy: 'rag',
              chunkingMethod: objectChunkingMethod,
            }),
          });

          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          expect(JSON.parse(result.body).error).toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject array chunkingMethod values with 400 status code when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string()), async (arrayChunkingMethod) => {
        const event = createEvent({
          pathParameters: { claimId: 'test-claim-001' },
          body: JSON.stringify({
            strategy: 'rag',
            chunkingMethod: arrayChunkingMethod,
          }),
        });

        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
      }),
      { numRuns: 100 }
    );
  });

  it('should not require chunkingMethod when strategy is full-context', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string(), { nil: undefined }),
        async (optionalChunkingMethod) => {
          // Reset mocks for each iteration
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();

          const body: Record<string, unknown> = { strategy: 'full-context' };
          if (optionalChunkingMethod !== undefined) {
            body.chunkingMethod = optionalChunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          // Mock cache miss and documents query
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({ // documents query
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Test document content',
                processingStatus: 'completed',
                claimMetadata: { claimId: 'test-claim-001' },
                tenantId: 'local-dev-tenant',
              }],
            })
            .mockResolvedValue({}); // cache write ops

          // Mock Bedrock response
          mockBedrockSend.mockResolvedValueOnce({
            body: new TextEncoder().encode(JSON.stringify({
              output: {
                message: {
                  content: [{ text: JSON.stringify({ summary: 'Test summary', anomalies: [] }) }],
                },
              },
            })),
          });

          const result = await handler(event);

          // full-context strategy should NOT return 400 for chunkingMethod errors
          if (result.statusCode === 400) {
            const body = JSON.parse(result.body);
            expect(body.error).not.toBe('Missing required field: chunkingMethod (required when strategy is rag)');
            expect(body.error).not.toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should not require chunkingMethod when strategy is graph-rag', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string(), { nil: undefined }),
        async (optionalChunkingMethod) => {
          // Reset mocks for each iteration
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();

          const body: Record<string, unknown> = { strategy: 'graph-rag' };
          if (optionalChunkingMethod !== undefined) {
            body.chunkingMethod = optionalChunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          // Mock cache miss and documents query
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({ // documents query
              Items: [{
                documentId: 'doc-1',
                fileName: 'test.pdf',
                extractedText: 'Test document content',
                processingStatus: 'completed',
                claimMetadata: { claimId: 'test-claim-001' },
                tenantId: 'local-dev-tenant',
              }],
            })
            .mockResolvedValue({}); // cache write ops

          // Mock Bedrock response
          mockBedrockSend.mockResolvedValueOnce({
            body: new TextEncoder().encode(JSON.stringify({
              output: {
                message: {
                  content: [{ text: JSON.stringify({ summary: 'Test summary', anomalies: [] }) }],
                },
              },
            })),
          });

          const result = await handler(event);

          // graph-rag strategy should NOT return 400 for chunkingMethod errors
          if (result.statusCode === 400) {
            const body = JSON.parse(result.body);
            expect(body.error).not.toBe('Missing required field: chunkingMethod (required when strategy is rag)');
            expect(body.error).not.toBe('Invalid chunkingMethod. Must be one of: full-document, semantic');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Property 7: Summary Response Structure Completeness
 *
 * For any successful summary generation, the API response shall contain all required fields:
 * `summary` (non-empty string), `strategy` (string), `documentCount` (number ≥ 1),
 * `processingTime` (number ≥ 0), and `generatedAt` (valid ISO 8601 timestamp).
 *
 * **Validates: Requirements 3.9**
 */
describe('Property 7: Summary Response Structure Completeness', () => {
  /**
   * Helper to check if a string is a valid ISO 8601 timestamp
   */
  function isValidISO8601(dateString: string): boolean {
    if (typeof dateString !== 'string') return false;
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return false;
    // Check that it can be parsed back to ISO format
    return dateString === date.toISOString() || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateString);
  }

  /**
   * Arbitrary generator for valid claim IDs (non-empty alphanumeric strings with dashes)
   */
  const validClaimIdArb = fc.stringMatching(/^[a-zA-Z0-9-]{1,50}$/).filter((s) => s.length > 0);

  /**
   * Arbitrary generator for valid document content (non-empty strings)
   */
  const validDocumentTextArb = fc.string({ minLength: 10, maxLength: 500 });

  /**
   * Arbitrary generator for valid strategies with their required chunking methods
   */
  const validStrategyWithChunkingArb = fc.oneof(
    fc.constant({ strategy: 'full-context' as const, chunkingMethod: undefined }),
    fc.constant({ strategy: 'graph-rag' as const, chunkingMethod: undefined }),
    fc.record({
      strategy: fc.constant('rag' as const),
      chunkingMethod: fc.constantFrom('full-document', 'semantic'),
    })
  );

  /**
   * Setup mocks for a successful summary generation
   */
  function setupSuccessfulMocks(
    documentText: string,
    strategy: string,
    chunkingMethod?: string
  ): void {
    mockDynamoSend.mockReset();
    mockBedrockSend.mockReset();
    mockBedrockAgentSend.mockReset();

    // Mock cache miss
    mockDynamoSend
      .mockResolvedValueOnce({ Item: null }) // cache miss
      .mockResolvedValueOnce({
        // documents query
        Items: [
          {
            documentId: 'doc-1',
            fileName: 'test.pdf',
            extractedText: documentText,
            processingStatus: 'completed',
            claimMetadata: { claimId: 'test-claim-001' },
            tenantId: 'local-dev-tenant',
          },
        ],
      })
      .mockResolvedValue({}); // cache write ops

    // Mock Bedrock response with valid summary structure
    const summaryResponse = {
      summary: `Summary of claim documents: ${documentText.substring(0, 50)}...`,
      anomalies: [],
    };

    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: JSON.stringify(summaryResponse) }],
            },
          },
        })
      ),
    });

    // Mock Knowledge Base for RAG strategy
    if (strategy === 'rag') {
      mockBedrockAgentSend.mockResolvedValueOnce({
        retrievalResults: [
          {
            content: { text: documentText },
            location: { s3Location: { uri: 's3://bucket/doc.pdf' } },
            score: 0.9,
          },
        ],
      });
    }
  }

  it('should return response with all required fields for any valid strategy', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          // Should be successful
          expect(result.statusCode).toBe(200);

          const responseBody = JSON.parse(result.body);

          // Assert all required fields are present
          expect(responseBody).toHaveProperty('summary');
          expect(responseBody).toHaveProperty('anomalies');
          expect(responseBody).toHaveProperty('strategy');
          expect(responseBody).toHaveProperty('documentCount');
          expect(responseBody).toHaveProperty('processingTime');
          expect(responseBody).toHaveProperty('generatedAt');
          expect(responseBody).toHaveProperty('cached');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return summary as a non-empty string', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // summary must be a non-empty string
            expect(typeof responseBody.summary).toBe('string');
            expect(responseBody.summary.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return documentCount >= 1 for successful responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // documentCount must be a number >= 1
            expect(typeof responseBody.documentCount).toBe('number');
            expect(responseBody.documentCount).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return processingTime >= 0 for successful responses', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // processingTime must be a number >= 0
            expect(typeof responseBody.processingTime).toBe('number');
            expect(responseBody.processingTime).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return generatedAt as a valid ISO 8601 timestamp', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // generatedAt must be a valid ISO 8601 timestamp
            expect(typeof responseBody.generatedAt).toBe('string');
            expect(isValidISO8601(responseBody.generatedAt)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return strategy matching the requested strategy', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // strategy in response must match requested strategy
            expect(responseBody.strategy).toBe(strategy);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return anomalies as an array (can be empty)', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // anomalies must be an array
            expect(Array.isArray(responseBody.anomalies)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return cached as a boolean', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // cached must be a boolean
            expect(typeof responseBody.cached).toBe('boolean');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include chunkingMethod in response only when strategy is rag', async () => {
    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, documentText) => {
          setupSuccessfulMocks(documentText, strategy, chunkingMethod);

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            if (strategy === 'rag') {
              // For RAG strategy, chunkingMethod should be present
              expect(responseBody.chunkingMethod).toBeDefined();
              expect(['full-document', 'semantic']).toContain(responseBody.chunkingMethod);
            }
            // For non-RAG strategies, chunkingMethod may or may not be present (undefined is acceptable)
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return consistent response structure across multiple document counts', async () => {
    // Test with varying numbers of documents
    const documentCountArb = fc.integer({ min: 1, max: 5 });

    await fc.assert(
      fc.asyncProperty(
        validStrategyWithChunkingArb,
        documentCountArb,
        validDocumentTextArb,
        async ({ strategy, chunkingMethod }, docCount, documentText) => {
          mockDynamoSend.mockReset();
          mockBedrockSend.mockReset();
          mockBedrockAgentSend.mockReset();

          // Create multiple documents
          const documents = Array.from({ length: docCount }, (_, i) => ({
            documentId: `doc-${i + 1}`,
            fileName: `test-${i + 1}.pdf`,
            extractedText: `${documentText} - Document ${i + 1}`,
            processingStatus: 'completed',
            claimMetadata: { claimId: 'test-claim-001' },
            tenantId: 'local-dev-tenant',
          }));

          // Mock cache miss
          mockDynamoSend
            .mockResolvedValueOnce({ Item: null }) // cache miss
            .mockResolvedValueOnce({ Items: documents }) // documents query
            .mockResolvedValue({}); // cache write ops

          // Mock Bedrock response
          const summaryResponse = {
            summary: `Summary of ${docCount} claim documents`,
            anomalies: [],
          };

          mockBedrockSend.mockResolvedValueOnce({
            body: new TextEncoder().encode(
              JSON.stringify({
                output: {
                  message: {
                    content: [{ text: JSON.stringify(summaryResponse) }],
                  },
                },
              })
            ),
          });

          // Mock Knowledge Base for RAG strategy
          if (strategy === 'rag') {
            mockBedrockAgentSend.mockResolvedValueOnce({
              retrievalResults: documents.map((doc, i) => ({
                content: { text: doc.extractedText },
                location: { s3Location: { uri: `s3://bucket/doc-${i + 1}.pdf` } },
                score: 0.9 - i * 0.1,
              })),
            });
          }

          const body: Record<string, unknown> = { strategy };
          if (chunkingMethod) {
            body.chunkingMethod = chunkingMethod;
          }

          const event = createEvent({
            pathParameters: { claimId: 'test-claim-001' },
            body: JSON.stringify(body),
          });

          const result = await handler(event);

          if (result.statusCode === 200) {
            const responseBody = JSON.parse(result.body);

            // All required fields should be present regardless of document count
            expect(responseBody).toHaveProperty('summary');
            expect(responseBody).toHaveProperty('anomalies');
            expect(responseBody).toHaveProperty('strategy');
            expect(responseBody).toHaveProperty('documentCount');
            expect(responseBody).toHaveProperty('processingTime');
            expect(responseBody).toHaveProperty('generatedAt');
            expect(responseBody).toHaveProperty('cached');

            // documentCount should reflect actual documents processed
            expect(responseBody.documentCount).toBeGreaterThanOrEqual(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
