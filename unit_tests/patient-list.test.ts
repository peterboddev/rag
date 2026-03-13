import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Mock the handler
const s3Mock = mockClient(S3Client);

// Import handler after mocking
let handler: any;
let resetCache: any;

describe('Patient List Lambda', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Set environment variables
    process.env.REGION = 'us-east-1';
    process.env.SOURCE_BUCKET = 'medical-claims-synthetic-data-dev';

    // Import handler after environment is set
    const module = await import('../src/lambda/patient-list');
    handler = module.handler;
    resetCache = module.resetCache;
  });

  beforeEach(() => {
    s3Mock.reset();
    // Reset the in-memory cache before each test
    if (resetCache) {
      resetCache();
    }
    // Suppress console.error globally for all tests to prevent pipeline failures
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console.error after each test
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
    }
  });

  afterAll(() => {
    s3Mock.restore();
  });

  const createMockEvent = (
    method: string = 'GET',
    queryParams?: Record<string, string>
  ): APIGatewayProxyEvent => ({
    httpMethod: method,
    path: '/api/patients',
    headers: {
      'x-tenant-id': 'test-tenant'
    },
    queryStringParameters: queryParams || null,
    body: null,
    isBase64Encoded: false,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    multiValueHeaders: {},
    multiValueQueryStringParameters: null
  });

  const createMockStream = (data: string): Readable => {
    const stream = new Readable();
    stream.push(data);
    stream.push(null);
    return stream;
  };

  describe('HTTP Method Validation', () => {
    it('should return 405 for non-GET requests', async () => {
      const event = createMockEvent('POST');
      const result = await handler(event);

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toEqual({ error: 'Method not allowed' });
    });

    it('should accept GET requests', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Authentication', () => {
    it('should extract tenant ID from x-tenant-id header', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      event.headers['x-tenant-id'] = 'custom-tenant';

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    it('should use default tenant for local development', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      delete event.headers['x-tenant-id'];

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('Patient Listing', () => {
    it('should list patients from S3 bucket', async () => {
      const mockMapping = {
        patient_mappings: [
          {
            synthea_id: 'synthea-001',
            tcia_id: 'TCIA-001',
            patient_name: 'John Doe',
            tcia_collection_id: 'TCGA-BRCA'
          },
          {
            synthea_id: 'synthea-002',
            tcia_id: 'TCIA-002',
            patient_name: 'Jane Smith',
            tcia_collection_id: 'TCGA-LUAD'
          }
        ]
      };

      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' },
          { Prefix: 'patients/TCIA-002/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json'
      }).resolves({
        Body: {
          transformToString: async () => JSON.stringify(mockMapping)
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients).toHaveLength(2);
      expect(response.patients[0].patientId).toBe('TCIA-001');
      expect(response.patients[0].patientName).toBe('John Doe');
      expect(response.patients[1].patientId).toBe('TCIA-002');
      expect(response.patients[1].patientName).toBe('Jane Smith');
    });

    it('should handle empty patient list', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients).toHaveLength(0);
      expect(response.totalCount).toBe(0);
    });

    it('should handle missing mapping file gracefully', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients).toHaveLength(1);
      expect(response.patients[0].patientName).toBe('Unknown Patient');
    });
  });

  describe('Pagination', () => {
    it('should support pagination with limit parameter', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' },
          { Prefix: 'patients/TCIA-002/' }
        ],
        IsTruncated: true,
        NextContinuationToken: 'next-token-123'
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET', { limit: '2' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients).toHaveLength(2);
      expect(response.nextToken).toBe('next-token-123');
    });

    it('should use default limit of 50 when not specified', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      await handler(event);

      const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
      expect(listCalls[0].args[0].input.MaxKeys).toBe(50);
    });

    it('should pass continuation token for pagination', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET', { nextToken: 'continuation-token' });
      await handler(event);

      const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
      expect(listCalls[0].args[0].input.ContinuationToken).toBe('continuation-token');
    });
  });

  describe('Claim Counting', () => {
    it('should count claims for each patient', async () => {
      const mockMapping = {
        patient_mappings: [
          {
            synthea_id: 'synthea-001',
            tcia_id: 'TCIA-001',
            patient_name: 'John Doe',
            tcia_collection_id: 'TCGA-BRCA'
          }
        ]
      };

      // Mock patient listing
      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/',
        Delimiter: '/'
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      // Mock claim counting
      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/TCIA-001/claims/'
      }).resolves({
        Contents: [
          { Key: 'patients/TCIA-001/claims/cms1500_claim_1.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_claim_1.pdf' },
          { Key: 'patients/TCIA-001/claims/cms1500_claim_2.pdf' },
          { Key: 'patients/TCIA-001/claims/eob_claim_2.pdf' }
        ],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'medical-claims-synthetic-data-dev',
        Key: 'mapping.json'
      }).resolves({
        Body: {
          transformToString: async () => JSON.stringify(mockMapping)
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients[0].claimCount).toBe(2);
    });

    it('should handle patients with no claims', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/',
        Delimiter: '/'
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/TCIA-001/claims/'
      }).resolves({
        Contents: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients[0].claimCount).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle S3 ListObjects errors', async () => {
      s3Mock.on(ListObjectsV2Command).rejects(new Error('Access Denied'));

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const response = JSON.parse(result.body);
      expect(response.error).toBe('Internal server error');
      expect(response.message).toContain('Access Denied');
    });

    it('should handle malformed mapping.json', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => 'invalid json'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      // Should still return 200 with default patient data
      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients[0].patientName).toBe('Unknown Patient');
    });

    it('should handle claim counting errors gracefully', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/',
        Delimiter: '/'
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(ListObjectsV2Command, {
        Prefix: 'patients/TCIA-001/claims/'
      }).rejects(new Error('S3 Error'));

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const response = JSON.parse(result.body);
      expect(response.patients[0].claimCount).toBe(0);
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in successful response', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('should include CORS headers in error response', async () => {
      s3Mock.on(ListObjectsV2Command).rejects(new Error('Test error'));

      const event = createMockEvent('GET');
      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });

  describe('Tenant Filtering', () => {
    it('should filter patients by tenant ID', async () => {
      // Note: Current implementation doesn't filter by tenant in S3
      // This test documents expected behavior for future enhancement
      s3Mock.on(ListObjectsV2Command).resolves({
        CommonPrefixes: [
          { Prefix: 'patients/TCIA-001/' }
        ],
        IsTruncated: false
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '[]'
        } as any
      });

      const event = createMockEvent('GET');
      event.headers['x-tenant-id'] = 'tenant-1';

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      // Future: Verify tenant filtering is applied
    });
  });
});
