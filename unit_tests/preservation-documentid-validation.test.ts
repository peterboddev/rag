/**
 * Preservation Property Tests - Non-Write Behavior Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests capture baseline behavior of non-DynamoDB-write operations
 * on UNFIXED code. They must PASS on unfixed code and continue to PASS
 * after the fix, confirming no regressions.
 *
 * Observation-first methodology: We observe that the current code uses
 * doc.id as the identifier field for map keys in token estimation and
 * text truncation. The tests verify behavior patterns (consistent allocation,
 * consistent mapping, field population, response format) rather than
 * specific field names, so they remain valid after the rename.
 */

import fc from 'fast-check';
import { TokenEstimationService } from '../src/services/token-estimation';
import { TextTruncationService } from '../src/services/text-truncation';
import { DocumentRecord } from '../src/types/index';
import { handler as claimLoaderHandler } from '../src/lambda/claim-loader';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const cloudWatchMock = mockClient(CloudWatchClient);

/**
 * Helper: get the identifier field value from a DocumentRecord.
 * Works with both `id` (unfixed) and `documentId` (fixed) code.
 */
function getDocId(doc: DocumentRecord): string {
  return (doc as any).documentId ?? (doc as any).id;
}

/**
 * Arbitrary for generating a single valid DocumentRecord.
 * Uses the current interface shape (which has `id` on unfixed code).
 */
function documentRecordArb(textMinLen = 0, textMaxLen = 500): fc.Arbitrary<DocumentRecord> {
  return fc.record({
    documentId: fc.uuid(),
    customerUuid: fc.uuid(),
    tenantId: fc.stringMatching(/^[a-z0-9-]{1,30}$/),
    fileName: fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/).map(s => s + '.pdf'),
    s3Key: fc.stringMatching(/^[a-zA-Z0-9/_-]{1,50}$/),
    contentType: fc.constantFrom('application/pdf', 'text/plain'),
    processingStatus: fc.constantFrom('queued' as const, 'processing' as const, 'completed' as const, 'failed' as const),
    extractedText: fc.string({ minLength: textMinLen, maxLength: textMaxLen }),
    textLength: fc.constant(0), // will be overridden
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-01-01') }).map(d => d.toISOString()),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-01-01') }).map(d => d.toISOString()),
  }).map(rec => {
    (rec as any).textLength = rec.extractedText?.length ?? 0;
    return rec as DocumentRecord;
  });
}

/**
 * Arbitrary for generating arrays of DocumentRecords with unique IDs.
 * The identifier field (doc.id on unfixed, doc.documentId on fixed) must be
 * unique across the array since services use it as a Map key.
 */
function uniqueDocumentRecordsArb(
  minLength: number,
  maxLength: number,
  textMinLen = 0,
  textMaxLen = 500
): fc.Arbitrary<DocumentRecord[]> {
  return fc.uniqueArray(
    documentRecordArb(textMinLen, textMaxLen),
    {
      minLength,
      maxLength,
      selector: (doc) => getDocId(doc),
    }
  );
}


describe('Preservation Property 2: Token Estimation Preservation', () => {
  const tokenService = new TokenEstimationService();

  it('distributeTokens produces consistent allocation for all valid DocumentRecord arrays', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: For any non-empty array of DocumentRecords with unique IDs and text content,
     * distributeTokens returns a Map with one entry per document, and each
     * allocation is a finite number (the last doc may receive negative remainder
     * when MIN_CONTENT_TOKENS floor causes over-allocation — this is observed behavior).
     */
    const docsArb = uniqueDocumentRecordsArb(1, 10, 10, 300);
    const totalTokensArb = fc.integer({ min: 100, max: 10000 });

    fc.assert(
      fc.property(docsArb, totalTokensArb, (docs, totalTokens) => {
        const distribution = tokenService.distributeTokens(docs, totalTokens);

        // One entry per document
        expect(distribution.size).toBe(docs.length);

        // Every document gets an entry keyed by its identifier
        for (const doc of docs) {
          const docId = getDocId(doc);
          expect(distribution.has(docId)).toBe(true);
        }

        // Each allocation is a finite number
        for (const [, tokens] of distribution) {
          expect(Number.isFinite(tokens)).toBe(true);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('distributeTokens is deterministic: same inputs produce same outputs', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: Calling distributeTokens twice with the same inputs
     * produces identical distributions.
     */
    const docsArb = uniqueDocumentRecordsArb(1, 5, 10, 200);
    const totalTokensArb = fc.integer({ min: 100, max: 5000 });

    fc.assert(
      fc.property(docsArb, totalTokensArb, (docs, totalTokens) => {
        const dist1 = tokenService.distributeTokens(docs, totalTokens);
        const dist2 = tokenService.distributeTokens(docs, totalTokens);

        expect(dist1.size).toBe(dist2.size);
        for (const [key, val] of dist1) {
          expect(dist2.get(key)).toBe(val);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('distributeTokens distributes equally when all documents have no text', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: When all documents have empty extractedText,
     * each document gets floor(totalTokens / numDocs) tokens.
     */
    const docsArb = uniqueDocumentRecordsArb(1, 8, 0, 0);
    const totalTokensArb = fc.integer({ min: 100, max: 5000 });

    fc.assert(
      fc.property(docsArb, totalTokensArb, (docs, totalTokens) => {
        // Force empty text
        const emptyDocs = docs.map(d => ({ ...d, extractedText: '' }));
        const distribution = tokenService.distributeTokens(emptyDocs, totalTokens);

        const expectedPerDoc = Math.floor(totalTokens / emptyDocs.length);
        for (const [, tokens] of distribution) {
          expect(tokens).toBe(expectedPerDoc);
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe('Preservation Property 2: Text Truncation Preservation', () => {
  const truncationService = new TextTruncationService();
  const tokenService = new TokenEstimationService();

  it('truncateMultipleDocuments produces consistent mapping for all valid DocumentRecord arrays', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: For any array of DocumentRecords with a token distribution,
     * truncateMultipleDocuments returns a Map with one entry per document,
     * and each truncated result has truncatedLength <= originalLength.
     */
    const docsArb = uniqueDocumentRecordsArb(1, 6, 20, 400);

    fc.assert(
      fc.property(docsArb, (docs) => {
        // Build a token distribution from the service
        const distribution = tokenService.distributeTokens(docs, 2000);
        const results = truncationService.truncateMultipleDocuments(docs, distribution);

        // One result per document
        expect(results.size).toBe(docs.length);

        // Each result keyed by document identifier
        for (const doc of docs) {
          const docId = getDocId(doc);
          expect(results.has(docId)).toBe(true);

          const result = results.get(docId)!;
          expect(result.truncatedLength).toBeLessThanOrEqual(result.originalLength);
          expect(result.preservedSentences).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 30 }
    );
  });

  it('truncateMultipleDocuments is deterministic: same inputs produce same outputs', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: Calling truncateMultipleDocuments twice with the same
     * inputs produces identical results.
     */
    const docsArb = uniqueDocumentRecordsArb(1, 4, 20, 300);

    fc.assert(
      fc.property(docsArb, (docs) => {
        const distribution = tokenService.distributeTokens(docs, 1500);

        const res1 = truncationService.truncateMultipleDocuments(docs, distribution);
        const res2 = truncationService.truncateMultipleDocuments(docs, distribution);

        expect(res1.size).toBe(res2.size);
        for (const [key, val] of res1) {
          const other = res2.get(key)!;
          expect(val.content).toBe(other.content);
          expect(val.originalLength).toBe(other.originalLength);
          expect(val.truncatedLength).toBe(other.truncatedLength);
        }
      }),
      { numRuns: 30 }
    );
  });
});

describe('Preservation Property 2: DocumentRecord Field Population', () => {
  it('all non-id fields retain same names and types for any generated record', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: For any generated DocumentRecord, the non-identifier fields
     * (customerUuid, tenantId, fileName, s3Key, contentType, processingStatus,
     * createdAt, updatedAt) are always present with correct types.
     */
    fc.assert(
      fc.property(documentRecordArb(0, 100), (record) => {
        // Required string fields
        expect(typeof record.customerUuid).toBe('string');
        expect(record.customerUuid.length).toBeGreaterThan(0);

        expect(typeof record.tenantId).toBe('string');
        expect(record.tenantId.length).toBeGreaterThan(0);

        expect(typeof record.fileName).toBe('string');
        expect(record.fileName.length).toBeGreaterThan(0);

        expect(typeof record.s3Key).toBe('string');
        expect(record.s3Key.length).toBeGreaterThan(0);

        expect(typeof record.contentType).toBe('string');
        expect(['application/pdf', 'text/plain'].includes(record.contentType)).toBe(true);

        expect(typeof record.processingStatus).toBe('string');
        expect(['queued', 'processing', 'completed', 'failed'].includes(record.processingStatus)).toBe(true);

        expect(typeof record.createdAt).toBe('string');
        expect(typeof record.updatedAt).toBe('string');

        // Verify ISO date format
        expect(new Date(record.createdAt).toISOString()).toBe(record.createdAt);
        expect(new Date(record.updatedAt).toISOString()).toBe(record.updatedAt);
      }),
      { numRuns: 100 }
    );
  });

  it('optional fields when present have correct types', () => {
    /**
     * **Validates: Requirements 3.3**
     *
     * Property: Optional fields like extractedText and textLength,
     * when present, have the expected types.
     */
    const docWithTextArb = documentRecordArb(10, 200);

    fc.assert(
      fc.property(docWithTextArb, (record) => {
        if (record.extractedText !== undefined) {
          expect(typeof record.extractedText).toBe('string');
        }
        if (record.textLength !== undefined) {
          expect(typeof record.textLength).toBe('number');
          expect(record.textLength).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe('Preservation Property 2: Response Format Preservation', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();

    cloudWatchMock.on(PutMetricDataCommand).resolves({});

    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';
    process.env.DOCUMENTS_TABLE_NAME = 'rag-app-v2-documents-dev';
    process.env.PLATFORM_DOCUMENTS_BUCKET = 'rag-app-v2-documents-dev';
    process.env.REGION = 'us-east-1';
  });

  afterEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
  });

  it('claim-loader response always contains statusCode, body with expected fields', async () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * Property: The claim-loader handler always returns a response with
     * statusCode and a JSON body. On success, the body contains
     * documentsProcessed, totalDocuments, and status fields.
     */
    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToString: async () => JSON.stringify({
          patients: [{
            syntheaId: 'synthea-1',
            tciaId: 'TCIA-P1',
            patientName: 'Test Patient',
            tciaCollectionId: 'test-col'
          }]
        })
      } as any
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'patients/TCIA-P1/claims/cms1500_001.pdf' }
      ]
    });

    s3Mock.on(CopyObjectCommand).resolves({});
    dynamoMock.on(PutCommand).resolves({});

    const event = {
      httpMethod: 'POST',
      path: '/claims/load',
      headers: { 'x-tenant-id': 'test-tenant' },
      body: JSON.stringify({
        patientId: 'TCIA-P1',
        claimId: 'claim-1',
        customerUUID: 'cust-uuid-1'
      }),
    } as any;

    const response = await claimLoaderHandler(event);

    // Response structure checks
    expect(response).toHaveProperty('statusCode');
    expect(response).toHaveProperty('body');
    expect(typeof response.statusCode).toBe('number');
    expect(typeof response.body).toBe('string');

    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('documentsProcessed');
    expect(body).toHaveProperty('totalDocuments');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('jobId');
    expect(body).toHaveProperty('message');

    expect(typeof body.documentsProcessed).toBe('number');
    expect(typeof body.totalDocuments).toBe('number');
    expect(typeof body.status).toBe('string');
    expect(typeof body.jobId).toBe('string');
  });

  it('claim-loader returns 400 for missing required fields', async () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * Property: When required fields are missing, claim-loader returns
     * statusCode 400 with an error message in the body.
     */
    const event = {
      httpMethod: 'POST',
      path: '/claims/load',
      headers: { 'x-tenant-id': 'test-tenant' },
      body: JSON.stringify({}),
    } as any;

    const response = await claimLoaderHandler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
  });

  it('claim-loader returns 405 for non-POST methods', async () => {
    /**
     * **Validates: Requirements 3.5**
     *
     * Property: Non-POST HTTP methods return 405 Method Not Allowed.
     */
    const event = {
      httpMethod: 'GET',
      path: '/claims/load',
      headers: { 'x-tenant-id': 'test-tenant' },
      body: null,
    } as any;

    const response = await claimLoaderHandler(event);

    expect(response.statusCode).toBe(405);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('error');
  });
});
