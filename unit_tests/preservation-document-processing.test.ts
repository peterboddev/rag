/**
 * Preservation Property Tests - Document Processing
 * 
 * IMPORTANT: Follow observation-first methodology
 * These tests observe and verify baseline behavior on UNFIXED code
 * 
 * GOAL: Ensure no regressions when implementing the serializeError() fix
 * 
 * Property 2: Preservation - Non-Error Logging and Processing
 * - Successful document processing continues to work
 * - Retry logic with exponential backoff remains unchanged
 * - Batch processing with Promise.allSettled continues to process all documents
 * - HTTP response format and status codes remain consistent
 * - Non-error logging output format is unchanged
 * 
 * EXPECTED OUTCOME ON UNFIXED CODE: Tests PASS (confirms baseline behavior)
 * EXPECTED OUTCOME ON FIXED CODE: Tests PASS (confirms no regressions)
 * 
 * Validates Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { handler } from '../src/lambda/claim-loader';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import * as fc from 'fast-check';

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const cloudWatchMock = mockClient(CloudWatchClient);

describe('Preservation Property Tests - Document Processing', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
    
    // Spy on console methods to observe logging behavior
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    
    // Mock CloudWatch to prevent dynamic import errors
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
    
    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';
    process.env.DOCUMENTS_TABLE_NAME = 'test-documents-table';
    process.env.PLATFORM_DOCUMENTS_BUCKET = 'test-platform-bucket';
    process.env.REGION = 'us-east-1';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
  });

  describe('Property 2.1: Successful Document Processing (Requirement 3.1)', () => {
    /**
     * OBSERVATION: On UNFIXED code, successful document processing should:
     * - Copy documents from source bucket to platform bucket
     * - Create DynamoDB records with correct structure
     * - Return 200 status code
     * - Process all documents in the batch
     * 
     * This test verifies that the fix doesn't break successful processing flows.
     */
    it('should successfully process valid documents without errors', async () => {
      // Mock patient mapping
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });
      
      // Mock document listing - need to handle both claims and clinical-notes directories
      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake((input: any) => {
        listCallCount++;
        if (listCallCount === 1) {
          // First call: claims directory
          return {
            Contents: [
              { Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' },
              { Key: 'patients/TCIA-001/claims/eob_claim_456.pdf' }
            ]
          };
        } else {
          // Second call: clinical-notes directory (empty)
          return { Contents: [] };
        }
      });
      
      // Mock successful S3 copy
      s3Mock.on(CopyObjectCommand).resolves({});
      
      // Mock successful DynamoDB put
      dynamoMock.on(PutCommand).resolves({});
      
      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      const response = await handler(event);

      // PRESERVATION: Response format must remain unchanged
      expect(response.statusCode).toBe(200);
      expect(response.headers).toBeDefined();
      expect(response.headers!['Content-Type']).toBe('application/json');
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('*');
      
      const body = JSON.parse(response.body);
      
      // PRESERVATION: Response structure must remain unchanged
      expect(body).toHaveProperty('jobId');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('documentsProcessed');
      expect(body).toHaveProperty('totalDocuments');
      expect(body).toHaveProperty('message');
      
      // PRESERVATION: All documents should be processed successfully
      expect(body.documentsProcessed).toBe(2);
      expect(body.totalDocuments).toBe(2);
      expect(body.status).toBe('completed');
      
      // PRESERVATION: S3 CopyObject should be called for each document
      expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(2);
      
      // PRESERVATION: DynamoDB PutCommand should be called for each document
      expect(dynamoMock.commandCalls(PutCommand).length).toBe(2);
      
      // PRESERVATION: No errors should be logged for successful processing
      const errorLogs = consoleErrorSpy.mock.calls;
      const hasProcessingErrors = errorLogs.some(call => 
        call.some((arg: any) => 
          typeof arg === 'string' && 
          (arg.includes('Non-retryable error') || arg.includes('Document processing failed'))
        )
      );
      expect(hasProcessingErrors).toBe(false);
      
      // PRESERVATION: Headers should be present
      expect(response.headers).toBeDefined();
      expect(response.headers!['Content-Type']).toBe('application/json');
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('*');
    });

    /**
     * Property-based test: For any valid patient ID and claim ID,
     * successful document processing should complete without errors.
     */
    it('property: successful processing works for any valid input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            patientId: fc.stringMatching(/^TCIA-[0-9]{3}$/),
            claimId: fc.stringMatching(/^claim-[0-9]{3}$/),
            customerUUID: fc.uuid(),
            documentCount: fc.integer({ min: 1, max: 5 })
          }),
          async ({ patientId, claimId, customerUUID, documentCount }) => {
            s3Mock.reset();
            dynamoMock.reset();
            cloudWatchMock.reset();
            cloudWatchMock.on(PutMetricDataCommand).resolves({});

            // Mock patient mapping
            s3Mock.on(GetObjectCommand).resolves({
              Body: {
                transformToString: async () => JSON.stringify({
                  patients: [{
                    syntheaId: 'synthea-001',
                    tciaId: patientId,
                    patientName: 'Test Patient',
                    tciaCollectionId: 'collection-1'
                  }]
                })
              } as any
            });

            // Generate document keys
            const documents = Array.from({ length: documentCount }, (_, i) => ({
              Key: `patients/${patientId}/claims/cms1500_claim_${i}.pdf`
            }));

            let listCallCount = 0;
            s3Mock.on(ListObjectsV2Command).callsFake(() => {
              listCallCount++;
              if (listCallCount === 1) {
                return { Contents: documents };
              } else {
                return { Contents: [] }; // clinical-notes directory empty
              }
            });
            s3Mock.on(CopyObjectCommand).resolves({});
            dynamoMock.on(PutCommand).resolves({});

            const event = {
              httpMethod: 'POST',
              path: '/claims/load',
              headers: { 'x-tenant-id': 'test-tenant' },
              body: JSON.stringify({ patientId, claimId, customerUUID }),
            } as any;

            const response = await handler(event);
            const body = JSON.parse(response.body);

            // **Validates: Requirements 3.1**
            // PRESERVATION: Successful processing always returns 200
            expect(response.statusCode).toBe(200);
            // PRESERVATION: All documents processed
            expect(body.documentsProcessed).toBe(documentCount);
            expect(body.totalDocuments).toBe(documentCount);
            expect(body.status).toBe('completed');
            // PRESERVATION: Response has required fields
            expect(body.jobId).toBeDefined();
            expect(body.message).toBeDefined();
          }
        ),
        { numRuns: 10 }
      );
    });
  });


  describe('Property 2.2: Retry Logic Preservation (Requirement 3.2)', () => {
    /**
     * OBSERVATION: On UNFIXED code, retryable errors should trigger retries.
     * The withRetry function should:
     * - Retry on throttling errors
     * - Use exponential backoff
     * - Eventually succeed or fail after max retries
     * 
     * This test verifies retry logic remains unchanged after the fix.
     */
    it('should retry on retryable errors with exponential backoff', async () => {
      let attemptCount = 0;

      // Mock patient mapping
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      // Mock document listing
      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return { Contents: [{ Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }] };
        } else {
          return { Contents: [] }; // clinical-notes directory empty
        }
      });

      // Mock S3 CopyObject to fail twice with throttling, then succeed
      s3Mock.on(CopyObjectCommand).callsFake(() => {
        attemptCount++;
        if (attemptCount <= 2) {
          const throttleError = new Error('Rate exceeded') as any;
          throttleError.name = 'ThrottlingException';
          throttleError.code = 'ThrottlingException';
          throw throttleError;
        }
        return {};
      });

      // Mock successful DynamoDB put
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.2**
      // PRESERVATION: Retry logic should work - operation eventually succeeds
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.documentsProcessed).toBe(1);
      
      // PRESERVATION: Should have retried (3 attempts total)
      expect(attemptCount).toBe(3);
      
      // PRESERVATION: Retry logs should be present
      const retryLogs = consoleLogSpy.mock.calls.filter(call =>
        call.some((arg: any) => typeof arg === 'string' && arg.includes('Retrying'))
      );
      expect(retryLogs.length).toBeGreaterThan(0);
    });
  });


  describe('Property 2.3: Batch Processing Preservation (Requirement 3.4)', () => {
    /**
     * OBSERVATION: On UNFIXED code, Promise.allSettled should:
     * - Process all documents even if some fail
     * - Continue processing remaining documents after failures
     * - Return results for both successful and failed documents
     * 
     * This test verifies batch processing behavior remains unchanged.
     */
    it('should process all documents in batch even when some fail', async () => {
      // Mock patient mapping
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      // Mock document listing - 3 documents
      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return {
            Contents: [
              { Key: 'patients/TCIA-001/claims/cms1500_claim_1.pdf' },
              { Key: 'patients/TCIA-001/claims/cms1500_claim_2.pdf' },
              { Key: 'patients/TCIA-001/claims/cms1500_claim_3.pdf' }
            ]
          };
        } else {
          return { Contents: [] }; // clinical-notes directory empty
        }
      });

      let copyCallCount = 0;
      // Mock S3 CopyObject - fail on second document, succeed on others
      s3Mock.on(CopyObjectCommand).callsFake((input) => {
        copyCallCount++;
        if (copyCallCount === 2) {
          const error = new Error('Access Denied') as any;
          error.name = 'AccessDenied';
          error.code = 'AccessDenied';
          throw error;
        }
        return {};
      });

      // Mock successful DynamoDB put
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.4**
      // PRESERVATION: Should still return 200 (partial success)
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // PRESERVATION: Should process 2 out of 3 documents
      expect(body.totalDocuments).toBe(3);
      expect(body.documentsProcessed).toBe(2);
      expect(body.status).toBe('completed_with_errors');
      
      // PRESERVATION: All 3 documents should be attempted
      expect(copyCallCount).toBe(3);
      
      // PRESERVATION: DynamoDB should only have 2 records (successful ones)
      expect(dynamoMock.commandCalls(PutCommand).length).toBe(2);
    });

    /**
     * Property-based test: For any batch of documents with some failures,
     * all documents should be attempted and successful ones should complete.
     */
    it('property: batch processing continues despite individual failures', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            totalDocs: fc.integer({ min: 3, max: 10 }),
            failureIndex: fc.integer({ min: 0, max: 9 })
          }),
          async ({ totalDocs, failureIndex }) => {
            s3Mock.reset();
            dynamoMock.reset();
            cloudWatchMock.reset();
            cloudWatchMock.on(PutMetricDataCommand).resolves({});

            const actualFailureIndex = failureIndex % totalDocs;

            s3Mock.on(GetObjectCommand).resolves({
              Body: {
                transformToString: async () => JSON.stringify({
                  patients: [{
                    syntheaId: 'synthea-001',
                    tciaId: 'TCIA-001',
                    patientName: 'Test Patient',
                    tciaCollectionId: 'collection-1'
                  }]
                })
              } as any
            });

            const documents = Array.from({ length: totalDocs }, (_, i) => ({
              Key: `patients/TCIA-001/claims/doc_${i}.pdf`
            }));

            let listCallCount = 0;
            s3Mock.on(ListObjectsV2Command).callsFake(() => {
              listCallCount++;
              if (listCallCount === 1) {
                return { Contents: documents };
              } else {
                return { Contents: [] }; // clinical-notes directory empty
              }
            });

            let callCount = 0;
            s3Mock.on(CopyObjectCommand).callsFake(() => {
              callCount++;
              if (callCount === actualFailureIndex + 1) {
                const error = new Error('Access Denied') as any;
                error.name = 'AccessDenied';
                error.code = 'AccessDenied';
                throw error;
              }
              return {};
            });

            dynamoMock.on(PutCommand).resolves({});

            const event = {
              httpMethod: 'POST',
              path: '/claims/load',
              headers: { 'x-tenant-id': 'test-tenant' },
              body: JSON.stringify({
                patientId: 'TCIA-001',
                claimId: 'claim-123',
                customerUUID: 'customer-uuid-456'
              }),
            } as any;

            const response = await handler(event);
            const body = JSON.parse(response.body);

            // **Validates: Requirements 3.4**
            // PRESERVATION: All documents attempted
            expect(callCount).toBe(totalDocs);
            // PRESERVATION: Successful documents processed
            expect(body.documentsProcessed).toBe(totalDocs - 1);
            expect(body.totalDocuments).toBe(totalDocs);
            // PRESERVATION: Status reflects partial success
            expect(body.status).toBe('completed_with_errors');
          }
        ),
        { numRuns: 5 }
      );
    });
  });


  describe('Property 2.4: Response Format Preservation (Requirement 3.5)', () => {
    /**
     * OBSERVATION: On UNFIXED code, HTTP responses should have:
     * - Correct status codes (200, 400, 401, 405, 500)
     * - Consistent headers (Content-Type, CORS)
     * - Expected response body structure
     * 
     * This test verifies response format remains unchanged.
     */
    it('should return correct response format for successful requests', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return { Contents: [{ Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }] };
        } else {
          return { Contents: [] }; // clinical-notes directory empty
        }
      });

      s3Mock.on(CopyObjectCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.5**
      // PRESERVATION: Status code
      expect(response.statusCode).toBe(200);
      
      // PRESERVATION: Headers
      expect(response.headers).toBeDefined();
      expect(response.headers).toEqual({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      
      // PRESERVATION: Body structure
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        jobId: expect.any(String),
        status: expect.any(String),
        documentsProcessed: expect.any(Number),
        totalDocuments: expect.any(Number),
        message: expect.any(String)
      });
    });

    it('should return 400 for missing required fields', async () => {
      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001'
          // Missing claimId and customerUUID
        }),
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.5**
      // PRESERVATION: Validation error response format
      expect(response.statusCode).toBe(400);
      expect(response.headers).toBeDefined();
      expect(response.headers!['Content-Type']).toBe('application/json');
      
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('Missing required fields');
    });

    it('should use default tenant_id when header is missing (local dev mode)', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return { Contents: [{ Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }] };
        } else {
          return { Contents: [] };
        }
      });

      s3Mock.on(CopyObjectCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: {}, // No tenant_id
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.5**
      // PRESERVATION: In local dev mode, missing tenant_id uses fallback
      // The code returns 'local-dev-tenant' as default, so request succeeds
      expect(response.statusCode).toBe(200);
      expect(response.headers).toBeDefined();
      expect(response.headers!['Content-Type']).toBe('application/json');
      
      const body = JSON.parse(response.body);
      expect(body.status).toBe('completed');
    });

    it('should return 405 for non-POST methods', async () => {
      const event = {
        httpMethod: 'GET',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: null,
      } as any;

      const response = await handler(event);

      // **Validates: Requirements 3.5**
      // PRESERVATION: Method not allowed response format
      expect(response.statusCode).toBe(405);
      expect(response.headers).toBeDefined();
      expect(response.headers!['Content-Type']).toBe('application/json');
      
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Method not allowed');
    });
  });


  describe('Property 2.5: Non-Error Logging Preservation (Requirement 3.1-3.5)', () => {
    /**
     * OBSERVATION: On UNFIXED code, non-error logging should:
     * - Use structured logging format
     * - Include timestamp, level, message, service
     * - Log info messages for successful operations
     * 
     * This test verifies that non-error logging format remains unchanged.
     */
    it('should maintain structured logging format for info messages', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return { Contents: [{ Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }] };
        } else {
          return { Contents: [] };
        }
      });

      s3Mock.on(CopyObjectCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      await handler(event);

      // **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
      // PRESERVATION: Structured logs should be present
      const structuredLogs = consoleLogSpy.mock.calls.filter(call =>
        call.some((arg: any) => {
          if (typeof arg === 'string') {
            try {
              const parsed = JSON.parse(arg);
              return parsed.timestamp && parsed.level && parsed.message && parsed.service;
            } catch {
              return false;
            }
          }
          return false;
        })
      );

      expect(structuredLogs.length).toBeGreaterThan(0);

      // PRESERVATION: Check structure of first structured log
      const firstLog = structuredLogs[0][0];
      const parsed = JSON.parse(firstLog);
      
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('level');
      expect(parsed).toHaveProperty('message');
      expect(parsed).toHaveProperty('service');
      expect(parsed.service).toBe('claim-loader');
    });

    it('should log processing progress messages', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-001',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });

      let listCallCount = 0;
      s3Mock.on(ListObjectsV2Command).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          return {
            Contents: [
              { Key: 'patients/TCIA-001/claims/cms1500_claim_1.pdf' },
              { Key: 'patients/TCIA-001/claims/cms1500_claim_2.pdf' }
            ]
          };
        } else {
          return { Contents: [] };
        }
      });

      s3Mock.on(CopyObjectCommand).resolves({});
      dynamoMock.on(PutCommand).resolves({});

      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-001',
          claimId: 'claim-123',
          customerUUID: 'customer-uuid-456'
        }),
      } as any;

      await handler(event);

      // **Validates: Requirements 3.1, 3.4**
      // PRESERVATION: Should log invocation
      const invocationLogs = consoleLogSpy.mock.calls.filter(call =>
        call.some((arg: any) => 
          typeof arg === 'string' && arg.includes('Claim Loader Lambda invoked')
        )
      );
      expect(invocationLogs.length).toBeGreaterThan(0);

      // PRESERVATION: Should log document count
      const documentCountLogs = consoleLogSpy.mock.calls.filter(call =>
        call.some((arg: any) => 
          typeof arg === 'string' && arg.includes('Found claim documents')
        )
      );
      expect(documentCountLogs.length).toBeGreaterThan(0);

      // PRESERVATION: Should log completion
      const completionLogs = consoleLogSpy.mock.calls.filter(call =>
        call.some((arg: any) => 
          typeof arg === 'string' && arg.includes('Claim loading completed')
        )
      );
      expect(completionLogs.length).toBeGreaterThan(0);
    });
  });
});
