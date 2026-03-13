/**
 * Bug Condition Exploration Tests - Document Processing Error Logging
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * GOAL: Surface counterexamples that demonstrate Error objects are logged as `{}` in CloudWatch
 * 
 * This test verifies that when AWS SDK errors occur during document processing,
 * the logged output contains complete error information (message, name, code, stack)
 * instead of empty objects `{}`.
 * 
 * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS (this is correct - it proves the bug exists)
 * EXPECTED OUTCOME ON FIXED CODE: Test PASSES (confirms bug is fixed)
 * 
 * Validates Requirements: 1.1, 1.2, 1.3
 */

import { handler } from '../src/lambda/claim-loader';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const cloudWatchMock = mockClient(CloudWatchClient);

describe('Bug Condition Exploration - Error Serialization', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
    
    // Spy on console methods to capture logged output
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

  describe('Property 1: Bug Condition - Error Serialization Failure', () => {
    /**
     * Test Case 1: S3 CopyObject AccessDenied Error
     * 
     * When S3 CopyObject throws an AccessDenied error, the error should be logged
     * with complete information including the MESSAGE property.
     * 
     * BUG CONDITION: Error.message is non-enumerable and doesn't appear in JSON.stringify
     * EXPECTED: Logged output contains error.message ("Access Denied")
     * ACTUAL (unfixed): Logged output contains name, code, but NOT message
     */
    it('should log complete S3 AccessDenied error details including message property', async () => {
      // Create a realistic AWS SDK error
      const accessDeniedError = new Error('Access Denied') as any;
      accessDeniedError.name = 'AccessDenied';
      accessDeniedError.code = 'AccessDenied';
      accessDeniedError.statusCode = 403;
      accessDeniedError.$metadata = {
        httpStatusCode: 403,
        requestId: 'test-request-id-123',
        attempts: 1
      };

      // Mock S3 to return patient mapping successfully
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-123',
              tciaId: 'TCIA-001',
              patientName: 'John Doe',
              tciaCollectionId: 'collection-1'
            }]
          })
        } as any
      });
      
      // Mock S3 to list documents successfully
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }
        ]
      });
      
      // Mock S3 CopyObject to throw AccessDenied error (non-retryable)
      s3Mock.on(CopyObjectCommand).rejects(accessDeniedError);
      
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

      // Verify console.error was called
      expect(consoleErrorSpy).toHaveBeenCalled();

      // Find the error log that contains the AccessDenied error
      const errorLogs = consoleErrorSpy.mock.calls
        .map(call => call.map((arg: any) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
        .join('\n');

      // CRITICAL ASSERTION: Error message should be present in logs
      // On UNFIXED code, this will FAIL because error.message is non-enumerable
      // On FIXED code, this will PASS because error is properly serialized with message
      
      // Check that error message is present
      expect(errorLogs).toMatch(/Access Denied/);
      
      // Check that error name or code is present (these already work)
      expect(errorLogs).toMatch(/AccessDenied/);
      
      // The bug: Error.message is non-enumerable and doesn't appear in JSON.stringify
      // Verify that when we serialize the error directly, message is missing
      const testError = new Error('Access Denied') as any;
      testError.name = 'AccessDenied';
      testError.code = 'AccessDenied';
      const serialized = JSON.stringify(testError);
      
      // This demonstrates the bug: message property is missing from serialization
      expect(serialized).not.toContain('Access Denied');
      expect(serialized).toContain('AccessDenied'); // name and code are present
    });

    /**
     * Test Case 2: DynamoDB PutItem ValidationException Error
     * 
     * When DynamoDB PutItem throws a ValidationException, the error should be logged
     * with complete information including the MESSAGE property.
     * 
     * BUG CONDITION: Error.message is non-enumerable and doesn't appear in JSON.stringify
     * EXPECTED: Logged output contains error.message ("Invalid attribute value")
     * ACTUAL (unfixed): Logged output contains name, code, but NOT message
     */
    it('should log complete DynamoDB ValidationException error details including message', async () => {
      // Create a realistic AWS SDK error
      const validationError = new Error('Invalid attribute value') as any;
      validationError.name = 'ValidationException';
      validationError.code = 'ValidationException';
      validationError.statusCode = 400;
      validationError.$metadata = {
        httpStatusCode: 400,
        requestId: 'test-request-id-456',
        attempts: 1
      };

      // Mock S3 to return patient mapping successfully
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-123',
              tciaId: 'TCIA-002',
              patientName: 'Jane Smith',
              tciaCollectionId: 'collection-2'
            }]
          })
        } as any
      });
      
      // Mock S3 to list documents successfully
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'patients/TCIA-002/claims/eob_claim_456.pdf' }
        ]
      });
      
      // Mock S3 CopyObject to succeed
      s3Mock.on(CopyObjectCommand).resolves({});
      
      // Mock DynamoDB PutCommand to throw ValidationException (non-retryable)
      dynamoMock.on(PutCommand).rejects(validationError);
      
      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-002',
          claimId: 'claim-456',
          customerUUID: 'customer-uuid-789'
        }),
      } as any;

      await handler(event);

      // Verify console.error was called
      expect(consoleErrorSpy).toHaveBeenCalled();

      // Find the error log that contains the ValidationException error
      const errorLogs = consoleErrorSpy.mock.calls
        .map(call => call.map((arg: any) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
        .join('\n');

      // CRITICAL ASSERTION: Error message should be present in logs
      // On UNFIXED code, this will FAIL because error.message is non-enumerable
      // On FIXED code, this will PASS because error is properly serialized
      
      // Check that error message is present
      expect(errorLogs).toMatch(/Invalid attribute value/);
      
      // Check that error name or code is present (these already work)
      expect(errorLogs).toMatch(/ValidationException/);
      
      // Demonstrate the bug: message property is missing from JSON.stringify
      const testError = new Error('Invalid attribute value') as any;
      testError.name = 'ValidationException';
      testError.code = 'ValidationException';
      const serialized = JSON.stringify(testError);
      
      // This demonstrates the bug: message property is missing
      expect(serialized).not.toContain('Invalid attribute value');
      expect(serialized).toContain('ValidationException'); // name and code are present
    });

    /**
     * Test Case 3: withRetry Non-Retryable Error Logging
     * 
     * When withRetry catches a non-retryable error, it logs the error directly.
     * The logged error should contain the MESSAGE property.
     * 
     * BUG CONDITION: Line 157 logs error directly, Error.message is non-enumerable
     * EXPECTED: Error object includes message property in serialization
     * ACTUAL (unfixed): Error.message is missing from JSON.stringify output
     */
    it('should log complete error details including message in withRetry', async () => {
      // Create a non-retryable error (AccessDenied)
      const accessDeniedError = new Error('Access Denied') as any;
      accessDeniedError.name = 'AccessDenied';
      accessDeniedError.code = 'AccessDenied';
      accessDeniedError.statusCode = 403;

      // Mock S3 to return patient mapping successfully
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-123',
              tciaId: 'TCIA-003',
              patientName: 'Bob Johnson',
              tciaCollectionId: 'collection-3'
            }]
          })
        } as any
      });
      
      // Mock S3 to list documents successfully
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'patients/TCIA-003/claims/clinical_note.pdf' }
        ]
      });
      
      // Mock S3 CopyObject to throw non-retryable error
      s3Mock.on(CopyObjectCommand).rejects(accessDeniedError);
      
      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-003',
          claimId: 'claim-789',
          customerUUID: 'customer-uuid-abc'
        }),
      } as any;

      await handler(event);

      // Find the specific "Non-retryable error" log from withRetry
      const nonRetryableErrorLog = consoleErrorSpy.mock.calls.find(call => 
        call.some((arg: any) => typeof arg === 'string' && arg.includes('Non-retryable error'))
      );

      expect(nonRetryableErrorLog).toBeDefined();

      // CRITICAL ASSERTION: The error argument should contain message property
      // On UNFIXED code: The error.message won't be in JSON.stringify output
      // On FIXED code: The error will be serialized with message property
      
      if (nonRetryableErrorLog) {
        const errorArg = nonRetryableErrorLog.find((arg: any) => 
          typeof arg === 'object' && arg !== null
        );
        
        if (errorArg) {
          const serialized = JSON.stringify(errorArg);
          
          // The bug: Error.message is non-enumerable
          // After fix: Should contain error message
          expect(serialized).toContain('Access Denied');
          
          // These properties already work (they're enumerable on AWS SDK errors)
          expect(serialized).toContain('AccessDenied');
        }
      }
    });

    /**
     * Test Case 4: Promise.allSettled Error Logging
     * 
     * When Promise.allSettled catches a rejected promise, result.reason contains
     * the Error object. This should be serialized before logging.
     * 
     * BUG CONDITION: Line 254 logs result.reason directly without serialization
     * EXPECTED: result.reason is serialized to extract error properties
     * ACTUAL (unfixed): result.reason is logged as `{}`
     */
    it('should log complete error details in Promise.allSettled for result.reason', async () => {
      // Create an error that will be caught by Promise.allSettled
      const processingError = new Error('Document processing failed') as any;
      processingError.name = 'ProcessingError';
      processingError.code = 'PROCESSING_FAILED';

      // Mock S3 to return patient mapping successfully
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patients: [{
              syntheaId: 'synthea-123',
              tciaId: 'TCIA-004',
              patientName: 'Alice Williams',
              tciaCollectionId: 'collection-4'
            }]
          })
        } as any
      });
      
      // Mock S3 to list documents successfully
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'patients/TCIA-004/claims/radiology_report.pdf' }
        ]
      });
      
      // Mock S3 CopyObject to throw error
      s3Mock.on(CopyObjectCommand).rejects(processingError);
      
      const event = {
        httpMethod: 'POST',
        path: '/claims/load',
        headers: { 'x-tenant-id': 'test-tenant' },
        body: JSON.stringify({
          patientId: 'TCIA-004',
          claimId: 'claim-xyz',
          customerUUID: 'customer-uuid-def'
        }),
      } as any;

      await handler(event);

      // Find the structured log for "Document processing failed"
      const processingFailedLog = consoleLogSpy.mock.calls.find(call => 
        call.some((arg: any) => {
          if (typeof arg === 'string') {
            try {
              const parsed = JSON.parse(arg);
              return parsed.message === 'Document processing failed';
            } catch {
              return false;
            }
          }
          return false;
        })
      );

      expect(processingFailedLog).toBeDefined();

      if (processingFailedLog) {
        const logEntry = processingFailedLog.find((arg: any) => typeof arg === 'string');
        if (logEntry) {
          const parsed = JSON.parse(logEntry);
          
          // CRITICAL ASSERTION: The error field should contain error details
          // On UNFIXED code: parsed.error will be {} (empty object)
          // On FIXED code: parsed.error will contain message, name, code, stack
          
          expect(parsed.error).toBeDefined();
          
          // Check that error is not an empty object
          const errorKeys = Object.keys(parsed.error || {});
          expect(errorKeys.length).toBeGreaterThan(0);
          
          // Should contain error message or name
          const errorString = JSON.stringify(parsed.error);
          expect(errorString).not.toBe('{}');
          
          // Should contain meaningful error information
          const hasErrorInfo = 
            parsed.error.message || 
            parsed.error.name || 
            parsed.error.code ||
            errorString.includes('processing') ||
            errorString.includes('failed');
          
          expect(hasErrorInfo).toBeTruthy();
        }
      }
    });
  });

  describe('Counterexample Documentation', () => {
    /**
     * This test documents the specific counterexamples found when running
     * the bug condition tests on UNFIXED code.
     * 
     * Expected counterexamples:
     * 1. Error.message property is non-enumerable and doesn't appear in JSON.stringify
     * 2. Error.stack property is non-enumerable and doesn't appear in JSON.stringify
     * 3. Custom properties (name, code) that are enumerable DO appear
     * 4. AWS SDK adds enumerable properties ($metadata) which DO appear
     */
    it('documents that Error.message and Error.stack are non-enumerable', () => {
      // This is the root cause of the bug
      const error = new Error('Test error message');
      error.name = 'TestError';
      (error as any).code = 'TEST_CODE';

      // Demonstrate the bug: JSON.stringify on Error doesn't include message/stack
      const serialized = JSON.stringify(error);
      
      // Error properties exist
      expect(error.message).toBe('Test error message');
      expect(error.name).toBe('TestError');
      expect((error as any).code).toBe('TEST_CODE');
      expect(error.stack).toBeDefined();
      
      // But message and stack don't appear in JSON.stringify output (non-enumerable)
      expect(serialized).not.toContain('Test error message');
      expect(serialized).not.toContain('stack');
      
      // However, custom properties that are enumerable DO appear
      // (This is why AWS SDK errors show name, code, $metadata but not message)
      expect(serialized).toContain('TestError');
      expect(serialized).toContain('TEST_CODE');
    });
  });
});
