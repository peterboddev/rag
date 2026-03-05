import { handler } from '../src/lambda/patient-detail';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

describe('Patient Detail Lambda', () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';
    process.env.REGION = 'us-east-1';
  });

  afterEach(() => {
    s3Mock.reset();
  });

  const createMockEvent = (patientId?: string): Partial<APIGatewayProxyEvent> => ({
    pathParameters: patientId ? { patientId } : undefined,
    headers: {},
    body: null,
  });

  const createMockMapping = () => ({
    'TCIA-001': {
      synthea_patient_id: 'synthea-123',
      tcia_collection_id: 'TCGA-BRCA',
      patient_name: 'John Doe',
    },
    'TCIA-002': {
      synthea_patient_id: 'synthea-456',
      tcia_collection_id: 'TCGA-LUAD',
      patient_name: 'Jane Smith',
    },
  });

  const createMockBody = (str: string) => ({
    transformToString: async () => str,
  });

  it('should return patient details with claims', async () => {
    const mockMapping = createMockMapping();
    
    // Mock mapping.json retrieval - must match the exact command parameters
    s3Mock.on(GetObjectCommand, {
      Bucket: 'medical-claims-synthetic-data-dev',
      Key: 'mapping.json',
    }).resolves({
      Body: createMockBody(JSON.stringify(mockMapping)) as any,
    });

    // Mock claims listing - must match the exact command parameters
    s3Mock.on(ListObjectsV2Command, {
      Bucket: 'medical-claims-synthetic-data-dev',
      Prefix: 'patients/TCIA-001/claims/',
      Delimiter: '/',
    }).resolves({
      Contents: [
        { Key: 'patients/TCIA-001/claims/cms1500_claim_123.pdf' },
        { Key: 'patients/TCIA-001/claims/cms1500_claim_123.txt' },
        { Key: 'patients/TCIA-001/claims/eob_123.pdf' },
        { Key: 'patients/TCIA-001/claims/radiology_report_123.pdf' },
      ],
    });

    const event = createMockEvent('TCIA-001');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.patientId).toBe('TCIA-001');
    expect(body.patientName).toBe('John Doe');
    expect(body.tciaCollectionId).toBe('TCGA-BRCA');
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0].claimId).toBe('123');
    expect(body.claims[0].documentTypes).toContain('CMS1500');
    expect(body.claims[0].documentTypes).toContain('EOB');
    expect(body.claims[0].documentTypes).toContain('Radiology Report');
  });

  it('should return 400 when patientId is missing', async () => {
    const event = createMockEvent();
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Missing patientId');
  });

  it('should return 404 when patient not found in mapping', async () => {
    const mockMapping = createMockMapping();
    
    s3Mock.on(GetObjectCommand, {
      Bucket: 'medical-claims-synthetic-data-dev',
      Key: 'mapping.json',
    }).resolves({
      Body: createMockBody(JSON.stringify(mockMapping)) as any,
    });

    const event = createMockEvent('TCIA-999');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Patient not found');
  });

  it('should handle patient with no claims', async () => {
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
      Contents: [],
    });

    const event = createMockEvent('TCIA-001');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.claims).toHaveLength(0);
  });

  it('should handle multiple claims for same patient', async () => {
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
        { Key: 'patients/TCIA-001/claims/cms1500_claim_456.pdf' },
        { Key: 'patients/TCIA-001/claims/eob_456.pdf' },
      ],
    });

    const event = createMockEvent('TCIA-001');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.claims).toHaveLength(2);
    expect(body.claims.map((c: any) => c.claimId).sort()).toEqual(['123', '456']);
  });

  it('should handle S3 errors gracefully', async () => {
    // Explicitly reject only the mapping.json GetObjectCommand
    s3Mock.on(GetObjectCommand).callsFake((input) => {
      if (input.Key === 'mapping.json') {
        throw new Error('S3 access denied');
      }
      throw new Error('Unexpected S3 call');
    });

    const event = createMockEvent('TCIA-001');
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal server error');
    expect(body.message).toContain('Failed to load patient mapping');
  });

  it('should include CORS headers in response', async () => {
    const event = createMockEvent();
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
    expect(result.headers).toHaveProperty('Content-Type', 'application/json');
  });
});
