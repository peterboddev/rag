import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.REGION || 'us-east-1' });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'medical-claims-synthetic-data-dev';

// Cache configuration
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedPatientList {
  patients: PatientSummary[];
  timestamp: number;
  mapping: Map<string, PatientMapping>;
}

// In-memory cache for patient list (survives across warm Lambda invocations)
let patientListCache: CachedPatientList | null = null;

// Test helper function to reset cache (only for testing)
export const resetCache = () => {
  patientListCache = null;
};

interface PatientMapping {
  syntheaId: string;
  tciaId: string;
  patientName: string;
  tciaCollectionId: string;
}

interface PatientSummary {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claimCount: number;
}

interface PatientListResponse {
  patients: PatientSummary[];
  nextToken?: string;
  totalCount: number;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Patient List Lambda invoked', {
      httpMethod: event.httpMethod,
      path: event.path,
      queryParams: event.queryStringParameters
    });

    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Extract tenant_id from JWT token
    const tenantId = extractTenantFromToken(event);
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Unauthorized: Missing tenant_id' }),
      };
    }

    // Get pagination parameters
    const limit = parseInt(event.queryStringParameters?.limit || '50', 10);
    const nextToken = event.queryStringParameters?.nextToken;

    // Check if we can use cached data (only for first page without pagination)
    if (!nextToken && patientListCache && (Date.now() - patientListCache.timestamp) < CACHE_TTL_MS) {
      console.log('Returning cached patient list', {
        cacheAge: Date.now() - patientListCache.timestamp,
        patientCount: patientListCache.patients.length
      });

      const response: PatientListResponse = {
        patients: patientListCache.patients.slice(0, limit),
        nextToken: patientListCache.patients.length > limit ? 'cached-page-2' : undefined,
        totalCount: patientListCache.patients.length
      };

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT'
        },
        body: JSON.stringify(response),
      };
    }

    // List patient directories from S3
    const patientDirectories = await listPatientDirectories(limit, nextToken);

    // Load patient mapping data (use cached mapping if available)
    let patientMapping: Map<string, PatientMapping>;
    if (patientListCache && (Date.now() - patientListCache.timestamp) < CACHE_TTL_MS) {
      patientMapping = patientListCache.mapping;
      console.log('Using cached patient mapping');
    } else {
      patientMapping = await loadPatientMapping();
    }

    // Enrich patient data with metadata and claim counts
    const patients = await enrichPatientData(patientDirectories.patients, patientMapping);

    // Cache the full patient list (only for first page)
    if (!nextToken) {
      patientListCache = {
        patients,
        timestamp: Date.now(),
        mapping: patientMapping
      };
      console.log('Patient list cached', { patientCount: patients.length });
    }

    const response: PatientListResponse = {
      patients,
      nextToken: patientDirectories.nextToken,
      totalCount: patients.length
    };

    console.log('Patient list generated successfully', {
      patientCount: patients.length,
      hasNextToken: !!patientDirectories.nextToken
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in patient list:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

function extractTenantFromToken(event: APIGatewayProxyEvent): string | null {
  // For local development, allow tenant_id in headers
  const tenantIdHeader = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }

  // TODO: Implement proper JWT parsing when Cognito is integrated
  return 'local-dev-tenant'; // Default for local development
}

async function listPatientDirectories(
  limit: number,
  continuationToken?: string
): Promise<{ patients: string[]; nextToken?: string }> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: 'patients/',
      Delimiter: '/',
      MaxKeys: limit,
      ContinuationToken: continuationToken
    });

    const response = await s3Client.send(command);

    // Extract patient IDs from common prefixes (directories)
    const patients = (response.CommonPrefixes || [])
      .map(prefix => {
        const match = prefix.Prefix?.match(/patients\/(TCIA-[^/]+)\//);
        return match ? match[1] : null;
      })
      .filter((id): id is string => id !== null);

    console.log('Listed patient directories from S3', {
      patientCount: patients.length,
      hasMore: response.IsTruncated
    });

    return {
      patients,
      nextToken: response.NextContinuationToken
    };

  } catch (error) {
    console.error('Error listing patient directories:', error);
    throw new Error(`Failed to list patient directories: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function loadPatientMapping(): Promise<Map<string, PatientMapping>> {
  try {
    const command = new GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: 'mapping.json'
    });

    const response = await s3Client.send(command);
    const mappingData = await response.Body?.transformToString();

    if (!mappingData) {
      throw new Error('Empty mapping.json file');
    }

    const mappings: PatientMapping[] = JSON.parse(mappingData);
    const mappingMap = new Map<string, PatientMapping>();

    mappings.forEach(mapping => {
      mappingMap.set(mapping.tciaId, mapping);
    });

    console.log('Loaded patient mapping', {
      mappingCount: mappingMap.size
    });

    return mappingMap;

  } catch (error) {
    console.error('Error loading patient mapping:', error);
    // Return empty map if mapping file doesn't exist or is invalid
    return new Map();
  }
}

async function enrichPatientData(
  patientIds: string[],
  mappingData: Map<string, PatientMapping>
): Promise<PatientSummary[]> {
  const enrichedPatients: PatientSummary[] = [];

  for (const patientId of patientIds) {
    try {
      // Get patient metadata from mapping
      const mapping = mappingData.get(patientId);

      // Count claim documents for this patient
      const claimCount = await countPatientClaims(patientId);

      enrichedPatients.push({
        patientId,
        patientName: mapping?.patientName || 'Unknown Patient',
        tciaCollectionId: mapping?.tciaCollectionId || 'N/A',
        claimCount
      });

    } catch (error) {
      console.error(`Error enriching patient ${patientId}:`, error);
      // Include patient with default values if enrichment fails
      enrichedPatients.push({
        patientId,
        patientName: 'Unknown Patient',
        tciaCollectionId: 'N/A',
        claimCount: 0
      });
    }
  }

  return enrichedPatients;
}

async function countPatientClaims(patientId: string): Promise<number> {
  try {
    const command = new ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: `patients/${patientId}/claims/`,
      MaxKeys: 1000 // Reasonable limit for counting
    });

    const response = await s3Client.send(command);

    // Count unique claim files (excluding .txt versions, count only PDFs)
    const claimFiles = (response.Contents || [])
      .filter(obj => obj.Key?.endsWith('.pdf'))
      .filter(obj => {
        // Count CMS1500 and EOB forms as separate claims
        const key = obj.Key || '';
        return key.includes('cms1500_') || key.includes('eob_');
      });

    // Count unique claim IDs (each claim has cms1500 and eob)
    const claimIds = new Set<string>();
    claimFiles.forEach(file => {
      const match = file.Key?.match(/claim_(\d+)/);
      if (match) {
        claimIds.add(match[1]);
      }
    });

    return claimIds.size;

  } catch (error) {
    console.error(`Error counting claims for patient ${patientId}:`, error);
    return 0;
  }
}
