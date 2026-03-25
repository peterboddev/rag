/**
 * Bug Condition Exploration Property Test — Claim Loader Mixed Patient Data
 *
 * This test demonstrates two bugs in `src/lambda/claim-loader.ts`:
 * 1. `listClaimDocuments(patientId)` returns ALL documents for a patient regardless
 *    of which claim was requested — no claimId filtering exists.
 * 2. `processDocument()` creates duplicate DynamoDB records on repeated invocations
 *    because no deduplication check exists.
 *
 * **EXPECTED TO FAIL on unfixed code** — failure confirms the bugs exist.
 *
 * Property 1: Bug Condition — Claim Loader Returns Documents From Other Claims
 *
 * For any { patientId, claimId } input where the patient's S3 directories contain
 * documents for multiple claims, `listClaimDocuments` SHALL return only documents
 * whose filename numeric suffix matches the claimId's numeric suffix.
 * Additionally, `processDocument` called twice for the same sourceKey and claimId
 * SHALL create only 1 DynamoDB record (not 2).
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */

import * as fc from 'fast-check';

// --- Mock setup (before any imports from the module under test) ---

const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ ...params, _type: 'ListObjectsV2' })),
  CopyObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'CopyObject' })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actualPutCommand = jest.fn().mockImplementation((params) => ({ ...params, _type: 'Put' }));
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({ send: mockDynamoSend }),
    },
    PutCommand: actualPutCommand,
    BatchWriteCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'BatchWrite' })),
    ScanCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Scan' })),
  };
});

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutMetricDataCommand: jest.fn().mockImplementation((params) => params),
  StandardUnit: { Count: 'Count', Milliseconds: 'Milliseconds' },
}));

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('test-uuid-1234'),
}));

// Now import the module under test (after mocks are set up)
// We need to access listClaimDocuments and processDocument.
// They are not exported, so we import the whole module and test via handler,
// or we re-require the module. Let's check if they're accessible.

// Since listClaimDocuments and processDocument are not exported from claim-loader.ts,
// we'll test them indirectly through the handler, or access them via require.
// For direct testing, we'll use a workaround: require the module and extract internals.

// Actually, looking at the source, these functions are module-level (not exported).
// We'll test the bug through the handler which calls both functions.
// But for a more targeted test, let's access them by requiring the compiled module.

// For the listClaimDocuments test, we can observe the behavior through the handler:
// The handler calls listClaimDocuments(patientId) and then processDocument for each doc.
// We can count how many processDocument calls happen (via S3 CopyObjectCommand calls)
// to determine how many documents listClaimDocuments returned.

// For the deduplication test, we call the handler twice and count DynamoDB PutCommand calls.

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../src/lambda/claim-loader';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Helper: create a minimal APIGatewayProxyEvent for the claim loader
 */
function createClaimLoaderEvent(patientId: string, claimId: string, customerUUID: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/claims/load',
    pathParameters: null,
    body: JSON.stringify({ patientId, claimId, customerUUID }),
    headers: { 'x-tenant-id': 'test-tenant' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '/claims/load',
  };
}

/**
 * The fixed set of S3 files spanning multiple claims for a patient.
 * These simulate a patient (e.g., TCIA-030) who has documents across claims 000061–000063
 * plus clinical notes from unrelated encounters (000096).
 */
const MULTI_CLAIM_FILES = [
  // Claim 000061 documents (should match claimId with suffix 000061)
  'patients/TEST-PATIENT/claims/cms1500_CLM000061.pdf',
  'patients/TEST-PATIENT/claims/eob_EOB000061.pdf',
  'patients/TEST-PATIENT/claims/radiology_report_RAD000061.pdf',
  // Claim 000062 documents (should NOT match 000061)
  'patients/TEST-PATIENT/claims/cms1500_CLM000062.pdf',
  'patients/TEST-PATIENT/claims/eob_EOB000062.pdf',
  'patients/TEST-PATIENT/claims/radiology_report_RAD000062.pdf',
  // Claim 000063 documents (should NOT match 000061)
  'patients/TEST-PATIENT/claims/cms1500_CLM000063.pdf',
  'patients/TEST-PATIENT/claims/eob_EOB000063.pdf',
  'patients/TEST-PATIENT/claims/radiology_report_RAD000063.pdf',
];

const CLINICAL_NOTE_FILES = [
  // Clinical note matching claim 000061
  'patients/TEST-PATIENT/clinical-notes/clinical_note_NOTE000061.pdf',
  // Clinical notes from OTHER encounters (should NOT match 000061)
  'patients/TEST-PATIENT/clinical-notes/clinical_note_NOTE000096.pdf',
  'patients/TEST-PATIENT/clinical-notes/clinical_note_NOTE000062.pdf',
];

/**
 * Extract the numeric suffix from a string (e.g., "EOB000061" → "000061", "cms1500_CLM000061.pdf" → "000061")
 */
function extractNumericSuffix(id: string): string | null {
  // Strip file extension if present, then match trailing digits
  const baseName = id.replace(/\.[^.]+$/, '');
  const match = baseName.match(/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Extract filename from an S3 key
 */
function extractFileName(key: string): string {
  return key.split('/').pop()!;
}

/**
 * Set up S3 mock to return multi-claim files for any patient.
 * The mock handles ListObjectsV2 (for listing), GetObject (for mapping.json),
 * CopyObject and PutObject (for processDocument).
 */
function setupS3MockForMultiClaimPatient(patientId: string) {
  // Replace TEST-PATIENT with the actual patientId in file keys
  const claimFiles = MULTI_CLAIM_FILES.map((f) => f.replace('TEST-PATIENT', patientId));
  const clinicalFiles = CLINICAL_NOTE_FILES.map((f) => f.replace('TEST-PATIENT', patientId));

  mockS3Send.mockImplementation((command: any) => {
    // Handle GetObject for mapping.json
    if (command._type === 'GetObject') {
      return Promise.resolve({
        Body: {
          transformToString: () =>
            Promise.resolve(
              JSON.stringify({
                patient_mappings: [
                  {
                    tcia_id: patientId,
                    synthea_id: 'synthea-001',
                    patient_name: 'Test Patient',
                    tcia_collection_id: 'test-collection',
                  },
                ],
              })
            ),
        },
      });
    }

    // Handle ListObjectsV2
    if (command._type === 'ListObjectsV2') {
      const prefix: string = command.Prefix || '';
      if (prefix.includes('/claims/')) {
        return Promise.resolve({
          Contents: claimFiles.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }
      if (prefix.includes('/clinical-notes/')) {
        return Promise.resolve({
          Contents: clinicalFiles.map((key) => ({ Key: key })),
          NextContinuationToken: undefined,
        });
      }
      return Promise.resolve({ Contents: [], NextContinuationToken: undefined });
    }

    // Handle CopyObject and PutObject (for processDocument)
    if (command._type === 'CopyObject' || command._type === 'PutObject') {
      return Promise.resolve({});
    }

    return Promise.resolve({});
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockS3Send.mockReset();
  mockDynamoSend.mockReset();
  // Stateful DynamoDB mock: tracks Put records and returns them on Scan
  const storedRecords: any[] = [];
  mockDynamoSend.mockImplementation((command: any) => {
    if (command._type === 'Put') {
      storedRecords.push(command.Item);
      return Promise.resolve({});
    }
    if (command._type === 'Scan') {
      const filterFn = command.FilterExpression;
      const fn = command.ExpressionAttributeValues?.[':fn'];
      const cid = command.ExpressionAttributeValues?.[':cid'];
      const matching = storedRecords.filter(
        (r) => r.fileName === fn && r.claimMetadata?.claimId === cid
      );
      return Promise.resolve({ Items: matching, Count: matching.length });
    }
    return Promise.resolve({});
  });
});

// --- Generators ---

/** Generate a claimId with a known prefix and numeric suffix */
const claimPrefixArb = fc.constantFrom('EOB', 'CLM', 'RAD');
const claimNumberArb = fc.constantFrom('000061', '000062', '000063');
const claimIdArb = fc.tuple(claimPrefixArb, claimNumberArb).map(([prefix, num]) => `${prefix}${num}`);

/** Generate a patientId */
const patientIdArb = fc.stringMatching(/^TCIA-\d{3}$/).filter((s) => s.length >= 5);

// --- Property Tests ---

describe('Property 1: Bug Condition — Claim Loader Returns Documents From Other Claims', () => {
  /**
   * For any { patientId, claimId } input where the patient's S3 directories contain
   * documents for multiple claims, every document processed by the handler should
   * have a filename whose numeric suffix matches the claimId's numeric suffix.
   *
   * On UNFIXED code, listClaimDocuments returns ALL documents regardless of claim,
   * so documents with non-matching suffixes will be processed — this test FAILS.
   *
   * **Validates: Requirements 1.1, 1.2, 1.3**
   */
  it('should only process documents whose filename numeric suffix matches the claimId suffix', async () => {
    await fc.assert(
      fc.asyncProperty(patientIdArb, claimIdArb, async (patientId, claimId) => {
        // Reset mocks
        mockS3Send.mockReset();
        mockDynamoSend.mockReset();
        // Stateful DynamoDB mock for this property run
        const storedRecords: any[] = [];
        mockDynamoSend.mockImplementation((command: any) => {
          if (command._type === 'Put') {
            storedRecords.push(command.Item);
            return Promise.resolve({});
          }
          if (command._type === 'Scan') {
            const fn = command.ExpressionAttributeValues?.[':fn'];
            const cid = command.ExpressionAttributeValues?.[':cid'];
            const matching = storedRecords.filter(
              (r) => r.fileName === fn && r.claimMetadata?.claimId === cid
            );
            return Promise.resolve({ Items: matching, Count: matching.length });
          }
          return Promise.resolve({});
        });

        setupS3MockForMultiClaimPatient(patientId);

        const event = createClaimLoaderEvent(patientId, claimId, 'test-customer-uuid');
        const result = await handler(event);
        const body = JSON.parse(result.body);

        // Extract the numeric suffix from the claimId
        const claimSuffix = extractNumericSuffix(claimId);
        expect(claimSuffix).not.toBeNull();

        // Count how many documents were processed (totalDocuments from response)
        const totalDocuments: number = body.totalDocuments;

        // Count how many files in our mock data match the claim suffix
        const allFiles = [
          ...MULTI_CLAIM_FILES.map((f) => f.replace('TEST-PATIENT', patientId)),
          ...CLINICAL_NOTE_FILES.map((f) => f.replace('TEST-PATIENT', patientId)),
        ];
        const matchingFiles = allFiles.filter((f) => {
          const fileName = extractFileName(f);
          const fileSuffix = extractNumericSuffix(fileName);
          return fileSuffix === claimSuffix;
        });
        const nonMatchingFiles = allFiles.filter((f) => {
          const fileName = extractFileName(f);
          const fileSuffix = extractNumericSuffix(fileName);
          return fileSuffix !== claimSuffix;
        });

        // ASSERTION: totalDocuments should equal the number of matching files ONLY
        // On buggy code, totalDocuments will be ALL files (12), not just matching ones
        expect(totalDocuments).toBe(matchingFiles.length);

        // ASSERTION: non-matching files should NOT have been processed
        // We verify by checking that CopyObjectCommand was called only for matching files
        const copyObjectCalls = mockS3Send.mock.calls.filter(
          (call: any[]) => call[0]?._type === 'CopyObject'
        );
        expect(copyObjectCalls.length).toBe(matchingFiles.length);

        // Verify each copied file has a matching suffix
        for (const call of copyObjectCalls) {
          const copySource: string = call[0].CopySource || '';
          const sourceFileName = extractFileName(copySource);
          const sourceSuffix = extractNumericSuffix(sourceFileName);
          expect(sourceSuffix).toBe(claimSuffix);
        }
      }),
      { numRuns: 20 }
    );
  });
});

describe('Property 1b: Bug Condition — processDocument Creates Duplicate Records', () => {
  /**
   * When the handler is called twice for the same patientId and claimId,
   * only 1 set of DynamoDB PutCommand calls should be made (deduplication).
   * On UNFIXED code, 2 sets of PutCommand calls are made — this test FAILS.
   *
   * **Validates: Requirements 1.4**
   */
  it('should create only 1 DynamoDB record per document when handler is called twice', async () => {
    await fc.assert(
      fc.asyncProperty(patientIdArb, claimIdArb, async (patientId, claimId) => {
        // Reset mocks
        mockS3Send.mockReset();
        mockDynamoSend.mockReset();
        // Stateful DynamoDB mock for dedup testing
        const storedRecords: any[] = [];
        mockDynamoSend.mockImplementation((command: any) => {
          if (command._type === 'Put') {
            storedRecords.push(command.Item);
            return Promise.resolve({});
          }
          if (command._type === 'Scan') {
            const fn = command.ExpressionAttributeValues?.[':fn'];
            const cid = command.ExpressionAttributeValues?.[':cid'];
            const matching = storedRecords.filter(
              (r) => r.fileName === fn && r.claimMetadata?.claimId === cid
            );
            return Promise.resolve({ Items: matching, Count: matching.length });
          }
          return Promise.resolve({});
        });

        setupS3MockForMultiClaimPatient(patientId);

        const event = createClaimLoaderEvent(patientId, claimId, 'test-customer-uuid');

        // Call handler FIRST time
        await handler(event);

        // Count PutCommand calls from first invocation
        const putCallsAfterFirst = mockDynamoSend.mock.calls.filter(
          (call: any[]) => call[0]?._type === 'Put'
        ).length;

        // Call handler SECOND time (same inputs)
        await handler(event);

        // Count PutCommand calls after second invocation
        const putCallsAfterSecond = mockDynamoSend.mock.calls.filter(
          (call: any[]) => call[0]?._type === 'Put'
        ).length;

        // ASSERTION: The second invocation should NOT create additional DynamoDB records
        // On buggy code, putCallsAfterSecond will be 2x putCallsAfterFirst
        expect(putCallsAfterSecond).toBe(putCallsAfterFirst);
      }),
      { numRuns: 20 }
    );
  });
});
