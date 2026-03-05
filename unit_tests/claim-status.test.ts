import { handler } from '../src/lambda/claim-status';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoMock = mockClient(DynamoDBDocumentClient);

describe('Claim Status Lambda', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    dynamoMock.reset();
    process.env.DOCUMENTS_TABLE_NAME = 'rag-app-v2-documents-dev';
    process.env.REGION = 'us-east-1';
    // Suppress console.error globally for all tests to prevent pipeline failures
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.error after each test
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
    }
  });

  const createMockEvent = (claimId?: string): Partial<APIGatewayProxyEvent> => ({
    pathParameters: claimId ? { claimId } : undefined,
    headers: {},
    body: null,
  });

  const createMockDocument = (
    documentId: string,
    fileName: string,
    processingStatus: string,
    claimId: string,
    documentType: string
  ) => ({
    id: documentId,
    fileName,
    processingStatus,
    claimMetadata: {
      claimId,
      documentType,
      patientId: 'TCIA-001',
    },
    createdAt: '2024-01-05T10:00:00.000Z',
    updatedAt: '2024-01-05T10:05:00.000Z',
  });

  it('should return not_loaded status when no documents found', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.claimId).toBe('claim-123');
    expect(body.status).toBe('not_loaded');
    expect(body.documentsProcessed).toBe(0);
    expect(body.totalDocuments).toBe(0);
    expect(body.documents).toHaveLength(0);
  });

  it('should return completed status when all documents are completed', async () => {
    const mockDocuments = [
      createMockDocument('doc-1', 'cms1500.pdf', 'completed', 'claim-123', 'CMS1500'),
      createMockDocument('doc-2', 'eob.pdf', 'completed', 'claim-123', 'EOB'),
      createMockDocument('doc-3', 'radiology.pdf', 'completed', 'claim-123', 'Radiology Report'),
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: mockDocuments,
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('completed');
    expect(body.documentsProcessed).toBe(3);
    expect(body.totalDocuments).toBe(3);
    expect(body.documents).toHaveLength(3);
  });

  it('should return processing status when some documents are processing', async () => {
    const mockDocuments = [
      createMockDocument('doc-1', 'cms1500.pdf', 'completed', 'claim-123', 'CMS1500'),
      createMockDocument('doc-2', 'eob.pdf', 'processing', 'claim-123', 'EOB'),
      createMockDocument('doc-3', 'radiology.pdf', 'queued', 'claim-123', 'Radiology Report'),
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: mockDocuments,
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('processing');
    expect(body.documentsProcessed).toBe(1);
    expect(body.totalDocuments).toBe(3);
  });

  it('should return failed status when all documents failed', async () => {
    const mockDocuments = [
      createMockDocument('doc-1', 'cms1500.pdf', 'failed', 'claim-123', 'CMS1500'),
      createMockDocument('doc-2', 'eob.pdf', 'failed', 'claim-123', 'EOB'),
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: mockDocuments,
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('failed');
    expect(body.documentsProcessed).toBe(0);
    expect(body.totalDocuments).toBe(2);
  });

  it('should return 400 when claimId is missing', async () => {
    const event = createMockEvent();
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Missing claimId');
  });

  it('should include document details in response', async () => {
    const mockDocuments = [
      createMockDocument('doc-1', 'cms1500.pdf', 'completed', 'claim-123', 'CMS1500'),
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: mockDocuments,
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.documents[0]).toMatchObject({
      documentId: 'doc-1',
      fileName: 'cms1500.pdf',
      processingStatus: 'completed',
      documentType: 'CMS1500',
      createdAt: '2024-01-05T10:00:00.000Z',
      updatedAt: '2024-01-05T10:05:00.000Z',
    });
  });

  it('should handle DynamoDB errors gracefully', async () => {
    dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB error'));

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal server error');
    
    // Verify console.error was called (error handling is working)
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('should include CORS headers in response', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
    expect(result.headers).toHaveProperty('Content-Type', 'application/json');
  });

  it('should handle mixed status documents correctly', async () => {
    const mockDocuments = [
      createMockDocument('doc-1', 'cms1500.pdf', 'completed', 'claim-123', 'CMS1500'),
      createMockDocument('doc-2', 'eob.pdf', 'failed', 'claim-123', 'EOB'),
      createMockDocument('doc-3', 'radiology.pdf', 'processing', 'claim-123', 'Radiology Report'),
    ];

    dynamoMock.on(QueryCommand).resolves({
      Items: mockDocuments,
    });

    const event = createMockEvent('claim-123');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('processing');
    expect(body.documentsProcessed).toBe(1);
    expect(body.totalDocuments).toBe(3);
  });
});
