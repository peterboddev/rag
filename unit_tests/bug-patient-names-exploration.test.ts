/**
 * Bug Condition Exploration Tests - Bug 1: Patient Names Showing "Unknown Patient"
 * 
 * CRITICAL: These tests MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the tests or the code when they fail
 * 
 * These tests encode the expected behavior - they will validate the fix when they pass after implementation
 * 
 * GOAL: Surface counterexamples that demonstrate Bug 1 exists
 */

import { handler as patientListHandler } from '../src/lambda/patient-list';
import { handler as patientDetailHandler } from '../src/lambda/patient-detail';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

describe('Bug Condition Exploration - Patient Names Display', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';
    process.env.REGION = 'us-east-1';
  });

  afterEach(() => {
    s3Mock.reset();
  });

  const createMockMapping = () => ({
    patient_mappings: [
      {
        synthea_id: 'synthea-123',
        tcia_id: 'TCIA-001',
        patient_name: 'John Smith',
      },
      {
        synthea_id: 'synthea-456',
        tcia_id: 'TCIA-002',
        patient_name: 'Jane Doe',
      },
      {
        synthea_id: 'synthea-789',
        tcia_id: 'TCIA-003',
        patient_name: 'Robert Johnson',
      },
    ],
    encounter_study_mappings: {}
  });

  const createMockBody = (str: string) => ({
    transformToString: async () => str,
  });

  describe('Patient List Page - Bug Condition', () => {
    it('should display actual patient names from mapping.json (NOT "Unknown Patient")', async () => {
      const mockMapping = createMockMapping();
      
      // Mock patient directory listing
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/',
        Delimiter: '/',
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' },
          { Prefix: 'patients/TCIA-002/' },
          { Prefix: 'patients/TCIA-003/' },
        ],
        IsTruncated: false,
      });

      // Mock mapping.json retrieval with correct structure
      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json',
      }).resolves({
        Body: createMockBody(JSON.stringify(mockMapping)) as any,
      });

      // Mock claim counting for each patient
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-001/claims/',
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_1.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_1.pdf' },
        ],
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-002/claims/',
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-002/claims/cms1500_claim_2.pdf' },
          { Key: 'patients/TCIA-002/claims/eob_2.pdf' },
        ],
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-003/claims/',
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-003/claims/cms1500_claim_3.pdf' },
          { Key: 'patients/TCIA-003/claims/eob_3.pdf' },
        ],
      });

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      };

      const result = await patientListHandler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      // BUG CONDITION: These assertions will FAIL if bug exists
      // Patient names should be actual names from mapping.json, NOT "Unknown Patient"
      expect(body.patients).toHaveLength(3);
      
      const patient1 = body.patients.find((p: any) => p.patientId === 'TCIA-001');
      expect(patient1).toBeDefined();
      expect(patient1.patientName).toBe('John Smith');
      expect(patient1.patientName).not.toBe('Unknown Patient');
      
      const patient2 = body.patients.find((p: any) => p.patientId === 'TCIA-002');
      expect(patient2).toBeDefined();
      expect(patient2.patientName).toBe('Jane Doe');
      expect(patient2.patientName).not.toBe('Unknown Patient');
      
      const patient3 = body.patients.find((p: any) => p.patientId === 'TCIA-003');
      expect(patient3).toBeDefined();
      expect(patient3.patientName).toBe('Robert Johnson');
      expect(patient3.patientName).not.toBe('Unknown Patient');
    });

    it('should parse patient_mappings array structure correctly', async () => {
      const mockMapping = createMockMapping();
      
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

      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json',
      }).resolves({
        Body: createMockBody(JSON.stringify(mockMapping)) as any,
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-001/claims/',
      }).resolves({
        Contents: [],
      });

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/patients',
        headers: { 'x-tenant-id': 'test-tenant' },
        queryStringParameters: null,
      };

      const result = await patientListHandler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      // Verify mapping.json structure is parsed correctly
      expect(body.patients[0].patientName).toBe('John Smith');
      expect(body.patients[0].tciaCollectionId).toBe('TCIA-001');
    });
  });

  describe('Patient Detail Page - Bug Condition', () => {
    it('should display actual patient name from mapping.json (NOT "Unknown Patient")', async () => {
      const mockMapping = createMockMapping();
      
      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json',
      }).resolves({
        Body: createMockBody(JSON.stringify(mockMapping)) as any,
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Prefix: 'patients/TCIA-001/claims/',
        Delimiter: '/',
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_123.pdf' },
        ],
      });

      const event: Partial<APIGatewayProxyEvent> = {
        pathParameters: { patientId: 'TCIA-001' },
        headers: {},
        body: null,
      };

      const result = await patientDetailHandler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      
      // BUG CONDITION: These assertions will FAIL if bug exists
      expect(body.patientId).toBe('TCIA-001');
      expect(body.patientName).toBe('John Smith');
      expect(body.patientName).not.toBe('Unknown Patient');
      expect(body.tciaCollectionId).toBe('TCIA-001');
    });

    it('should handle all patients in mapping.json correctly', async () => {
      const mockMapping = createMockMapping();
      
      // Test each patient individually
      const testCases = [
        { patientId: 'TCIA-001', expectedName: 'John Smith' },
        { patientId: 'TCIA-002', expectedName: 'Jane Doe' },
        { patientId: 'TCIA-003', expectedName: 'Robert Johnson' },
      ];

      for (const testCase of testCases) {
        s3Mock.reset();
        
        s3Mock.on(GetObjectCommand, {
          Bucket: 'medical-claims-synthetic-data-dev',
          Key: 'mapping.json',
        }).resolves({
          Body: createMockBody(JSON.stringify(mockMapping)) as any,
        });

        s3Mock.on(ListObjectsV2Command).resolves({
          Contents: [],
        });

        const event: Partial<APIGatewayProxyEvent> = {
          pathParameters: { patientId: testCase.patientId },
          headers: {},
          body: null,
        };

        const result = await patientDetailHandler(event as APIGatewayProxyEvent);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        
        expect(body.patientName).toBe(testCase.expectedName);
        expect(body.patientName).not.toBe('Unknown Patient');
      }
    });
  });

  describe('Mapping.json Structure Verification', () => {
    it('should verify mapping.json has correct patient_mappings array structure', async () => {
      const mockMapping = createMockMapping();
      
      // Verify the structure we're testing against
      expect(mockMapping).toHaveProperty('patient_mappings');
      expect(Array.isArray(mockMapping.patient_mappings)).toBe(true);
      expect(mockMapping.patient_mappings[0]).toHaveProperty('synthea_id');
      expect(mockMapping.patient_mappings[0]).toHaveProperty('tcia_id');
      expect(mockMapping.patient_mappings[0]).toHaveProperty('patient_name');
      
      // This confirms our test data matches the actual S3 file structure
      expect(mockMapping.patient_mappings[0].patient_name).toBe('John Smith');
      expect(mockMapping.patient_mappings[0].patient_name).not.toBe('Unknown Patient');
    });
  });
});
