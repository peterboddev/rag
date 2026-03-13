/**
 * Preservation Property Tests
 * 
 * These tests verify that existing functionality remains unchanged after the fix
 * They should PASS on both unfixed and fixed code
 * 
 * GOAL: Ensure no regressions are introduced
 */

import { handler as patientListHandler } from '../src/lambda/patient-list';
import { handler as patientDetailHandler } from '../src/lambda/patient-detail';
import { handler as claimLoaderHandler } from '../src/lambda/claim-loader';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBDocumentClient);
const cloudWatchMock = mockClient(CloudWatchClient);

describe('Preservation Property Tests', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
    
    // Mock CloudWatch to prevent dynamic import errors
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
    
    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';
    process.env.DOCUMENTS_TABLE_NAME = 'test-documents-table';
    process.env.PLATFORM_DOCUMENTS_BUCKET = 'test-platform-bucket';
    process.env.REGION = 'us-east-1';
  });

  afterEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    cloudWatchMock.reset();
  });

  describe('Claim Count Preservation', () => {
    it('should continue to display correct claim counts for each patient', async () => {
      // Mock patient listing
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/',
        Delimiter: '/',
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' },
        ],
        IsTruncated: false,
      });

      // Mock mapping.json
      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json',
      }).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patient_mappings: [{
              synthea_id: 'synthea-123',
              tcia_id: 'TCIA-001',
              patient_name: 'John Doe'
            }]
          })
        } as any
      });

      // Mock claim counting - 3 claims
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-001/claims/',
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_1.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_claim_1.pdf' },
          { Key: 'patients/TCIA-001/claims/cms1500_claim_2.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_claim_2.pdf' },
          { Key: 'patients/TCIA-001/claims/cms1500_claim_3.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_claim_3.pdf' },
        ],
      });

      const event = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      } as any;

      const result = await patientListHandler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      // Claim count should be accurate (3 claims)
      expect(body.patients[0].claimCount).toBe(3);
    });
  });

  describe('S3 Access Preservation', () => {
    it('should continue to access S3 files correctly', async () => {
      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json',
      }).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patient_mappings: [{
              synthea_id: 'synthea-123',
              tcia_id: 'TCIA-001',
              patient_name: 'John Doe'
            }]
          })
        } as any
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [],
      });

      const event = {
        pathParameters: { patientId: 'TCIA-001' },
        headers: {},
        body: null,
      } as any;

      const result = await patientDetailHandler(event);

      // Should successfully access S3 and return 200
      expect(result.statusCode).toBe(200);
    });
  });

  describe('CORS Preservation', () => {
    it('should continue to include CORS headers in all responses', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      } as any;

      const result = await patientListHandler(event);

      // CORS headers must be present
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });

  describe('Navigation Preservation', () => {
    it('should continue to support patient list to patient detail navigation', async () => {
      // Test patient list
      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/',
      }).resolves({
        CommonPrefixes: [{ Prefix: 'patients/TCIA-001/' }],
        IsTruncated: false,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patient_mappings: [{
              synthea_id: 'synthea-123',
              tcia_id: 'TCIA-001',
              patient_name: 'John Doe'
            }]
          })
        } as any
      });

      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/TCIA-001/claims/',
      }).resolves({
        Contents: [],
      });

      const listEvent = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      } as any;

      const listResult = await patientListHandler(listEvent);
      expect(listResult.statusCode).toBe(200);
      
      const listBody = JSON.parse(listResult.body);
      const patientId = listBody.patients[0].patientId;

      // Test patient detail with the ID from list
      const detailEvent = {
        pathParameters: { patientId },
        headers: {},
        body: null,
      } as any;

      const detailResult = await patientDetailHandler(detailEvent);
      expect(detailResult.statusCode).toBe(200);
    });
  });

  describe('API Gateway Authorization Preservation', () => {
    it('should continue to handle authenticated requests correctly', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      } as any;

      const result = await patientListHandler(event);

      // Should accept authenticated requests
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Other Endpoints Preservation', () => {
    it('should continue to handle claim loader endpoint correctly', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => JSON.stringify({
            patient_mappings: [{
              synthea_id: 'synthea-123',
              tcia_id: 'TCIA-001',
              patient_name: 'John Doe'
            }]
          })
        } as any
      });

      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' }
        ]
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

      const result = await claimLoaderHandler(event);

      // Should continue to work correctly
      expect(result.statusCode).toBe(200);
    });
  });
});
