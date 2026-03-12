import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.REGION || 'us-east-1' });
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'medical-claims-synthetic-data-dev';

interface PatientDetail {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claims: ClaimSummary[];
}

interface ClaimSummary {
  claimId: string;
  documentCount: number;
  documentTypes: string[];
}

interface PatientMapping {
  [key: string]: {
    synthea_patient_id: string;
    tcia_collection_id: string;
    patient_name: string;
  };
}

interface MappingFile {
  patient_mappings: Array<{
    synthea_id: string;
    tcia_id: string;
    patient_name: string;
  }>;
}

/**
 * Lambda handler for GET /patients/{patientId}
 * Retrieves patient details and associated claims from S3
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Patient Detail Request:', JSON.stringify(event, null, 2));

  try {
    // Extract patient ID from path parameters
    const patientId = event.pathParameters?.patientId;
    
    if (!patientId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing patientId',
          message: 'Patient ID is required in the path'
        }),
      };
    }

    // Load patient mapping to get patient name and TCIA collection ID
    const mapping = await loadPatientMapping();
    const patientInfo = mapping[patientId];

    if (!patientInfo) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Patient not found',
          message: `Patient ${patientId} not found in mapping`
        }),
      };
    }

    // List claims for this patient
    const claims = await listPatientClaims(patientId);

    const patientDetail: PatientDetail = {
      patientId,
      patientName: patientInfo.patient_name,
      tciaCollectionId: patientInfo.tcia_collection_id,
      claims,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(patientDetail),
    };
  } catch (error) {
    console.error('Error retrieving patient details:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
    };
  }
};

/**
 * Load patient mapping from S3
 */
async function loadPatientMapping(): Promise<PatientMapping> {
  try {
    const command = new GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: 'mapping.json',
    });

    const response = await s3Client.send(command);
    const mappingData = await response.Body?.transformToString();
    
    if (!mappingData) {
      throw new Error('Empty mapping file');
    }

    const mappingFile: MappingFile = JSON.parse(mappingData);
    
    // Convert array format to object format expected by the handler
    const mapping: PatientMapping = {};
    for (const entry of mappingFile.patient_mappings) {
      mapping[entry.tcia_id] = {
        synthea_patient_id: entry.synthea_id,
        tcia_collection_id: entry.tcia_id,
        patient_name: entry.patient_name || 'Unknown Patient',
      };
    }
    
    return mapping;
  } catch (error) {
    console.error('Error loading patient mapping:', error);
    throw new Error('Failed to load patient mapping');
  }
}

/**
 * List claims for a patient by examining S3 structure
 */
async function listPatientClaims(patientId: string): Promise<ClaimSummary[]> {
  try {
    const claimsPrefix = `patients/${patientId}/claims/`;
    
    const command = new ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: claimsPrefix,
      Delimiter: '/',
    });

    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      return [];
    }

    // Group documents by claim ID
    const claimMap = new Map<string, Set<string>>();
    
    for (const obj of response.Contents) {
      if (!obj.Key) continue;
      
      // Extract claim ID from filename
      // Format: cms1500_claim_{id}.pdf, eob_{id}.pdf, radiology_report_{id}.pdf
      const fileName = obj.Key.split('/').pop();
      if (!fileName) continue;

      let claimId: string | null = null;
      let docType: string | null = null;

      if (fileName.startsWith('cms1500_claim_')) {
        claimId = fileName.replace('cms1500_claim_', '').replace(/\.(pdf|txt)$/, '');
        docType = 'CMS1500';
      } else if (fileName.startsWith('eob_')) {
        claimId = fileName.replace('eob_', '').replace(/\.(pdf|txt)$/, '');
        docType = 'EOB';
      } else if (fileName.startsWith('radiology_report_')) {
        claimId = fileName.replace('radiology_report_', '').replace(/\.(pdf|txt)$/, '');
        docType = 'Radiology Report';
      }

      if (claimId && docType) {
        if (!claimMap.has(claimId)) {
          claimMap.set(claimId, new Set());
        }
        claimMap.get(claimId)!.add(docType);
      }
    }

    // Convert map to array of claim summaries
    const claims: ClaimSummary[] = [];
    for (const [claimId, docTypes] of claimMap.entries()) {
      claims.push({
        claimId,
        documentCount: docTypes.size,
        documentTypes: Array.from(docTypes),
      });
    }

    return claims;
  } catch (error) {
    console.error('Error listing patient claims:', error);
    throw new Error('Failed to list patient claims');
  }
}
