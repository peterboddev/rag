/**
 * BDA Extraction Service — handles Bedrock Data Automation invocation
 * and response parsing for insurance claim documents.
 *
 * Uses the async InvokeDataAutomationAsync API (required for documents/PDFs)
 * with default standard output (no custom blueprint needed).
 * Polls GetDataAutomationStatus until complete, then reads output from S3.
 */

import {
  BedrockDataAutomationRuntimeClient,
  InvokeDataAutomationAsyncCommand,
  GetDataAutomationStatusCommand,
} from '@aws-sdk/client-bedrock-data-automation-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/** Structured extraction result from BDA standard output */
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

/** Create a default empty BdaExtraction object. */
export function emptyBdaExtraction(): BdaExtraction {
  return {
    patient: { patientName: null, patientId: null, dateOfBirth: null },
    financials: { billedAmount: 0, allowedAmount: 0, paidAmount: 0, patientResponsibility: 0 },
    dates: { serviceDate: null, paymentDate: null },
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
 * Parse raw BDA output (custom or standard) into a normalized BdaExtraction.
 * Handles both custom blueprint output and standard document output formats.
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
 * Parse BDA standard document output into a BdaExtraction.
 * Standard output has a different structure than custom blueprint output —
 * it contains document summary, pages, elements with text/tables/forms.
 * We extract financial amounts and dates from the structured text.
 */
export function parseStandardDocumentOutput(standardOutput: any): BdaExtraction {
  const result = emptyBdaExtraction();
  if (!standardOutput) return result;

  // Standard output may have document.summary, pages[].elements[], etc.
  const doc = standardOutput.document || standardOutput;
  const summary = doc.summary || doc.document_summary || '';

  // Try to extract structured data from pages/elements
  const allText: string[] = [];
  if (summary) allText.push(typeof summary === 'string' ? summary : JSON.stringify(summary));

  // Collect text from pages
  const pages = doc.pages || [];
  for (const page of pages) {
    const elements = page.elements || [];
    for (const el of elements) {
      if (el.text) allText.push(el.text);
    }
  }

  // Also check for top-level text content
  if (doc.text) allText.push(doc.text);
  if (doc.content) allText.push(typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content));

  const fullText = allText.join('\n');

  // Extract financial amounts from text using regex
  const amountPattern = /\$[\d,]+\.?\d*/g;
  const amounts = (fullText.match(amountPattern) || [])
    .map(s => parseFloat(s.replace(/[$,]/g, '')))
    .filter(n => !isNaN(n) && n > 0);

  if (amounts.length > 0) {
    // Assign amounts to financial fields heuristically
    const sorted = [...amounts].sort((a, b) => b - a);
    result.financials.billedAmount = sorted[0] || 0;
    result.financials.paidAmount = sorted[1] || 0;
    result.financials.allowedAmount = sorted[2] || 0;
    result.financials.patientResponsibility = sorted[3] || 0;
  }

  // Extract dates
  const datePattern = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/g;
  const dates = fullText.match(datePattern) || [];
  if (dates.length > 0) result.dates.serviceDate = dates[0] ?? null;
  if (dates.length > 1) result.dates.paymentDate = dates[1] ?? null;

  // Extract diagnosis codes (ICD-10 pattern)
  const icdPattern = /[A-Z]\d{2}(?:\.\d{1,4})?/g;
  const icdCodes = fullText.match(icdPattern) || [];
  result.diagnosisCodes = Array.from(new Set(icdCodes));

  // Extract CPT codes (5-digit numeric)
  const cptPattern = /\b\d{5}\b/g;
  const cptCodes = fullText.match(cptPattern) || [];
  result.procedureCodes = Array.from(new Set(cptCodes));

  return result;
}

/** Sleep helper for polling */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse s3://bucket/key URI */
function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

/**
 * Invoke BDA async to process a document, poll for completion, read output from S3.
 * Uses default standard output (no custom blueprint).
 *
 * @param s3Bucket - Source document bucket
 * @param s3Key - Source document key
 * @param projectArn - BDA project ARN
 * @param blueprintArn - Optional blueprint ARN (pass empty string to skip)
 * @param region - AWS region
 * @param outputBucket - S3 bucket for BDA output (defaults to source bucket)
 */
export async function invokeBdaExtraction(
  s3Bucket: string,
  s3Key: string,
  projectArn: string,
  blueprintArn: string,
  region: string,
  outputBucket?: string
): Promise<BdaExtraction | null> {
  try {
    const client = new BedrockDataAutomationRuntimeClient({ region });
    const s3Client = new S3Client({ region });
    const outBucket = outputBucket || s3Bucket;
    const outputPrefix = `bda-output/${s3Key.replace(/\.[^.]+$/, '')}`;

    // Build the async invocation request
    const input: any = {
      inputConfiguration: {
        s3Uri: `s3://${s3Bucket}/${s3Key}`,
      },
      dataAutomationConfiguration: {
        dataAutomationProjectArn: projectArn,
      },
      outputConfiguration: {
        s3Uri: `s3://${outBucket}/${outputPrefix}/`,
      },
      dataAutomationProfileArn: process.env.BDA_PROFILE_ARN || `arn:aws:bedrock:${region}:${process.env.AWS_ACCOUNT_ID || '450683699755'}:data-automation-profile/us.data-automation-v1`,
    };

    // Only include blueprints if a real ARN is provided
    if (blueprintArn && !blueprintArn.includes('placeholder') && !blueprintArn.includes('000000000000')) {
      input.blueprints = [{ blueprintArn }];
    }

    const invokeCmd = new InvokeDataAutomationAsyncCommand(input);
    const invokeResp = await client.send(invokeCmd);
    const invocationArn = invokeResp.invocationArn;

    if (!invocationArn) {
      console.warn('BDA: InvokeDataAutomationAsync did not return an invocationArn');
      return null;
    }

    console.log('BDA async job started', { invocationArn });

    // Poll for completion (max ~3 minutes with 10s intervals)
    const maxAttempts = 18;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(10000);

      const statusCmd = new GetDataAutomationStatusCommand({ invocationArn });
      const statusResp = await client.send(statusCmd);
      const status = statusResp.status;

      console.log('BDA poll', { attempt: i + 1, status });

      if (status === 'Success' as any || status === 'COMPLETED' as any) {
        // Read output from S3
        const outputConfig = statusResp.outputConfiguration;
        const outputS3Uri = outputConfig?.s3Uri;

        if (outputS3Uri) {
          const parsed = parseS3Uri(outputS3Uri);
          if (parsed) {
            try {
              // BDA outputS3Uri points to job_metadata.json — result is at sibling path
              const baseKey = parsed.key.replace(/job_metadata\.json$/, '').replace(/\/$/, '');
              const resultKey = `${baseKey}/0/standard_output/0/result.json`;
              const getObj = await s3Client.send(new GetObjectCommand({
                Bucket: parsed.bucket,
                Key: resultKey,
              }));
              const body = await getObj.Body?.transformToString();
              if (body) {
                const outputJson = JSON.parse(body);
                // Check for custom output first, then standard
                if (outputJson.custom_output || outputJson.inference_result) {
                  return parseBdaResponse(outputJson.custom_output || outputJson.inference_result);
                }
                // Standard document output
                return parseStandardDocumentOutput(outputJson.standard_output || outputJson);
              }
            } catch (s3Err) {
              console.warn('BDA: failed to read output from S3', {
                error: s3Err instanceof Error ? s3Err.message : 'Unknown',
                outputS3Uri,
              });
            }
          }
        }

        return emptyBdaExtraction();
      }

      if (status === 'FAILED' as any || status === 'ServiceError' || status === 'ClientError') {
        console.warn('BDA async job failed', { status, invocationArn });
        return null;
      }
    }

    console.warn('BDA async job timed out after polling', { invocationArn });
    return null;
  } catch (error) {
    console.warn('BDA extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      s3Bucket,
      s3Key,
    });
    return null;
  }
}
