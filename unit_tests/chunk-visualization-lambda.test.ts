import { handler } from '../src/lambda/chunk-visualization-get';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { ChunkVisualizationService } from '../src/services/chunk-visualization';

// Mock the ChunkVisualizationService
jest.mock('../src/services/chunk-visualization');

const mockChunkVisualizationService = ChunkVisualizationService as jest.MockedClass<typeof ChunkVisualizationService>;

describe('Chunk Visualization Lambda Handler', () => {
  let mockEvent: APIGatewayProxyEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockEvent = {
      httpMethod: 'POST',
      path: '/documents/chunks/visualization',
      headers: {
        'X-Tenant-Id': 'test-tenant-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerUUID: 'test-customer-uuid',
        documentIds: ['doc-1', 'doc-2'],
        chunkingMethod: {
          id: 'semantic',
          name: 'Semantic Chunking',
          description: 'Semantic boundary chunking',
          parameters: {
            strategy: 'semantic',
            maxTokens: 800
          }
        }
      }),
      requestContext: {
        requestId: 'test-request-id'
      }
    } as any;
  });

  describe('Successful chunk generation', () => {
    test('should return chunks when request is valid', async () => {
      // Mock successful service response
      const mockChunks = [
        {
          id: 'chunk-1',
          text: 'This is the first chunk of text content.',
          tokenCount: 150,
          characterCount: 750,
          metadata: {
            chunkIndex: 0,
            totalChunks: 2,
            chunkingMethod: 'semantic',
            confidence: 0.85,
            semanticBoundary: true
          },
          sourceDocument: {
            documentId: 'doc-1',
            fileName: 'document1.pdf'
          }
        }
      ];

      const mockServiceResponse = {
        chunks: mockChunks,
        totalChunks: 1,
        processingTime: 1200,
        errors: [],
        warnings: []
      };

      mockChunkVisualizationService.prototype.generateChunksForVisualization = jest.fn()
        .mockResolvedValue(mockServiceResponse);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.chunks).toHaveLength(1);
      expect(responseBody.totalChunks).toBe(1);
      expect(responseBody.processingTime).toBe(1200);
      expect(responseBody.chunkingMethod.id).toBe('semantic');
      expect(responseBody.generatedAt).toBeDefined();
      
      // Verify service was called with correct parameters
      expect(mockChunkVisualizationService.prototype.generateChunksForVisualization)
        .toHaveBeenCalledWith(
          ['doc-1', 'doc-2'],
          'test-customer-uuid',
          'test-tenant-123',
          expect.objectContaining({
            id: 'semantic',
            parameters: { strategy: 'semantic', maxTokens: 800 }
          })
        );
    });

    test('should include errors and warnings in response when present', async () => {
      const mockServiceResponse = {
        chunks: [],
        totalChunks: 0,
        processingTime: 500,
        errors: [
          {
            documentId: 'doc-1',
            fileName: 'document1.pdf',
            errorMessage: 'Document has no extracted text',
            errorType: 'processing' as const,
            isRetryable: true,
            timestamp: '2024-01-05T10:00:00.000Z'
          }
        ],
        warnings: ['Only 1 of 2 requested documents were found and processable']
      };

      mockChunkVisualizationService.prototype.generateChunksForVisualization = jest.fn()
        .mockResolvedValue(mockServiceResponse);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.errors).toHaveLength(1);
      expect(responseBody.warnings).toHaveLength(1);
      expect(responseBody.errors[0].documentId).toBe('doc-1');
      expect(responseBody.warnings[0]).toContain('Only 1 of 2');
    });
  });

  describe('Request validation', () => {
    test('should return 405 for non-POST methods', async () => {
      mockEvent.httpMethod = 'GET';

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(405);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Method not allowed. Use POST.');
      expect(responseBody.allowedMethods).toEqual(['POST']);
    });

    test('should return 400 when X-Tenant-Id header is missing', async () => {
      delete mockEvent.headers['X-Tenant-Id'];

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Missing X-Tenant-Id header');
    });

    test('should return 400 when request body is missing', async () => {
      mockEvent.body = null;

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Invalid JSON in request body');
    });

    test('should return 400 when customerUUID is missing', async () => {
      mockEvent.body = JSON.stringify({
        documentIds: ['doc-1']
      });

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Request validation failed');
      expect(responseBody.details).toContain('customerUUID is required and must be a string');
    });

    test('should return 400 when documentIds is empty', async () => {
      mockEvent.body = JSON.stringify({
        customerUUID: 'test-customer-uuid',
        documentIds: []
      });

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(400);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Request validation failed');
      expect(responseBody.details).toContain('At least one document ID must be provided');
    });
  });

  describe('Error handling', () => {
    test('should return 422 when critical errors occur with no chunks generated', async () => {
      const mockServiceResponse = {
        chunks: [],
        totalChunks: 0,
        processingTime: 500,
        errors: [
          {
            documentId: 'doc-1',
            fileName: 'document1.pdf',
            errorMessage: 'Invalid document format',
            errorType: 'validation' as const,
            isRetryable: false,
            timestamp: '2024-01-05T10:00:00.000Z'
          }
        ],
        warnings: []
      };

      mockChunkVisualizationService.prototype.generateChunksForVisualization = jest.fn()
        .mockResolvedValue(mockServiceResponse);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(422);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Failed to generate chunks');
      expect(responseBody.details).toHaveLength(1);
      expect(responseBody.details[0].documentId).toBe('doc-1');
    });

    test('should return 500 when service throws unexpected error', async () => {
      mockChunkVisualizationService.prototype.generateChunksForVisualization = jest.fn()
        .mockRejectedValue(new Error('Database connection failed'));

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(500);
      
      const responseBody = JSON.parse(result.body);
      expect(responseBody.error).toBe('Internal server error');
      expect(responseBody.message).toBe('An unexpected error occurred while generating chunks');
      expect(responseBody.details).toBe('Database connection failed');
    });
  });

  describe('CORS headers', () => {
    test('should include CORS headers in successful response', async () => {
      const mockServiceResponse = {
        chunks: [],
        totalChunks: 0,
        processingTime: 100,
        errors: [],
        warnings: []
      };

      mockChunkVisualizationService.prototype.generateChunksForVisualization = jest.fn()
        .mockResolvedValue(mockServiceResponse);

      const result = await handler(mockEvent);

      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id'
      });
    });
  });
});