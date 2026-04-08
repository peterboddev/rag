/**
 * BDA Extraction Service — handles Bedrock Data Automation invocation
 * and response parsing for insurance claim documents.
 *
 * Isolates BDA SDK calls from the document processing Lambda.
 */

import {
  BedrockDataAutomationRuntimeClient,
  InvokeDataAutomationCommand,
} from '@aws-sdk/client-bedrock-data-automation-runtime';

/** Structured extraction result from BDA custom blueprint */
export interface BdaExtraction {
  patient: {
    patientName: string | null;
    patientId: string | null;
    dateOfBirth: string | null;
  };
  financials: {
    billedAmount: number;
    allowedAmount: number;
    paidAmount: number;
    patientResponsibility: number;
  };
  dates: {
    serviceDate: string | null;
    paymentDate: string | null;
  };
  claimStatus: string | null;
  diagnosisCodes: string[];
  procedureCodes: string[];
  providerName: string | null;
  providerNPI: string | null;
}

/**
 * Create a default empty BdaExtraction object.
 */
export function emptyBdaExtraction(): BdaExtraction {
  return {
    patient: {
      patientName: null,
      patientId: null,
      dateOfBirth: null,
    },
    financials: {
      billedAmount: 0,
      allowedAmount: 0,
      paidAmount: 0,
      patientResponsibility: 0,
    },
    dates: {
      serviceDate: null,
      paymentDate: null,
    },
    claimStatus: null,
    diagnosisCodes: [],
    procedureCodes: [],
    providerName: null,
    providerNPI: null,
  };
}

/** Clamp a value to a non-negative number, defaulting to 0. */
function toNonNegativeNumber(val: unknown): number {
  if (typeof val === 'number' && !isNaN(val)) return Math.max(0, val);
  if (typeof val === 'string') {
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

/** Return val as string or null. */
function toStringOrNull(val: unknown): string | null {
  if (typeof val === 'string' && val.length > 0) return val;
  return null;
}

/** Return val as an array of strings. */
function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((item): item is string => typeof item === 'string');
}

/**
 * Parse the raw BDA response into a normalized BdaExtraction object.
 * Applies defaults for missing fields, clamps financial amounts to non-negative.
 */
export function parseBdaResponse(rawOutput: Record<string, any>): BdaExtraction {
  const raw = rawOutput ?? {};
  const rawPatient = (typeof raw.patient === 'object' && raw.patient !== null) ? raw.patient : {};
  const rawFinancials = (typeof raw.financials === 'object' && raw.financials !== null) ? raw.financials : {};
  const rawDates = (typeof raw.dates === 'object' && raw.dates !== null) ? raw.dates : {};

  return {
    patient: {
      patientName: toStringOrNull(rawPatient.patientName),
      patientId: toStringOrNull(rawPatient.patientId),
      dateOfBirth: toStringOrNull(rawPatient.dateOfBirth),
    },
    financials: {
      billedAmount: toNonNegativeNumber(rawFinancials.billedAmount),
      allowedAmount: toNonNegativeNumber(rawFinancials.allowedAmount),
      paidAmount: toNonNegativeNumber(rawFinancials.paidAmount),
      patientResponsibility: toNonNegativeNumber(rawFinancials.patientResponsibility),
    },
    dates: {
      serviceDate: toStringOrNull(rawDates.serviceDate),
      paymentDate: toStringOrNull(rawDates.paymentDate),
    },
    claimStatus: toStringOrNull(raw.claimStatus),
    diagnosisCodes: toStringArray(raw.diagnosisCodes),
    procedureCodes: toStringArray(raw.procedureCodes),
    providerName: toStringOrNull(raw.providerName),
    providerNPI: toStringOrNull(raw.providerNPI),
  };
}

/**
 * Invoke BDA to process a document using the custom insurance claims blueprint.
 * Returns the parsed BdaExtraction or null if processing fails.
 *
 * Uses the sync InvokeDataAutomation API which returns results in outputSegments.
 */
export async function invokeBdaExtraction(
  s3Bucket: string,
  s3Key: string,
  projectArn: string,
  blueprintArn: string,
  region: string
): Promise<BdaExtraction | null> {
  try {
    const client = new BedrockDataAutomationRuntimeClient({ region });

    const command = new InvokeDataAutomationCommand({
      inputConfiguration: {
        s3Uri: `s3://${s3Bucket}/${s3Key}`,
      },
      dataAutomationConfiguration: {
        dataAutomationProjectArn: projectArn,
      },
      blueprints: [
        {
          blueprintArn,
        },
      ],
    } as any);

    const response = await client.send(command);

    // The sync API returns results in outputSegments
    const segments = (response as any).outputSegments;
    if (Array.isArray(segments) && segments.length > 0) {
      // Try customOutput first (blueprint-matched output), then standardOutput
      const rawJson = segments[0].customOutput || segments[0].standardOutput;
      if (rawJson && typeof rawJson === 'string') {
        try {
          const parsed = JSON.parse(rawJson);
          return parseBdaResponse(parsed);
        } catch {
          console.warn('BDA: failed to parse segment output as JSON');
        }
      }
    }

    // Fallback: check if output is at S3 location
    const outputS3Uri = response.outputConfiguration?.s3Uri;
    if (outputS3Uri) {
      console.log('BDA output written to S3, segment parsing unavailable', { outputS3Uri });
    }

    console.warn('BDA response had no parseable output segments');
    return emptyBdaExtraction();
  } catch (error) {
    console.warn('BDA extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      s3Bucket,
      s3Key,
    });
    return null;
  }
}
