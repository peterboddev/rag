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
 * Uses BDA's structured elements — tables with headers, labeled text fields,
 * and document summary — instead of regex over raw text.
 */
export function parseStandardDocumentOutput(standardOutput: any): BdaExtraction {
  const result = emptyBdaExtraction();
  if (!standardOutput) return result;

  const doc = standardOutput.document || standardOutput;

  // Collect all elements — BDA puts them at root level, not inside document
  const elements: any[] = [];
  if (standardOutput.elements) elements.push(...standardOutput.elements);
  const docObj = standardOutput.document || standardOutput;
  if (docObj.elements) elements.push(...docObj.elements);
  const pages = standardOutput.pages || docObj.pages || [];
  for (const page of pages) {
    if (page.elements) elements.push(...page.elements);
  }

  // Use document-level representation text for labeled field extraction
  const docText = docObj.representation?.text || docObj.text || standardOutput.representation?.text || '';

  // 1. Extract from structured tables (most reliable)
  for (const el of elements) {
    if (el.type !== 'TABLE') continue;
    const headers: string[] = (el.headers || []).map((h: string) => h.toLowerCase().trim());
    const textContent = el.representation?.text || '';
    // Split by newlines — handle \r\n and \n
    const lines = textContent.split(/\r?\n/).filter((l: string) => l.trim());
    // Skip header row if it matches the headers
    const dataRows = lines.length > 1 ? lines.slice(1) : [];

    for (const row of dataRows) {
      const cells = row.split('\t');
      for (let i = 0; i < Math.min(headers.length, cells.length); i++) {
        const header = headers[i];
        const val = (cells[i] || '').trim();
        const numVal = parseFloat(val.replace(/[$,]/g, ''));

        if (header.includes('billed') && !isNaN(numVal)) {
          result.financials.billedAmount = Math.max(0, numVal);
        } else if (header.includes('allowed') && !isNaN(numVal)) {
          result.financials.allowedAmount = Math.max(0, numVal);
        } else if (header.includes('paid') && !isNaN(numVal)) {
          result.financials.paidAmount = Math.max(0, numVal);
        } else if (header.includes('patient') && header.includes('responsib') && !isNaN(numVal)) {
          result.financials.patientResponsibility = Math.max(0, numVal);
        } else if (header.includes('service') && header.includes('date') && val) {
          result.dates.serviceDate = val;
        } else if (header.includes('charge') && !isNaN(numVal)) {
          result.financials.billedAmount = Math.max(result.financials.billedAmount, numVal);
        }
      }
    }
  }

  // 2. Extract labeled fields from document text (e.g., "Patient Name: John Doe")
  const extractLabeled = (text: string, ...labels: string[]): string | null => {
    for (const label of labels) {
      // Match label followed by value, stopping at next label or newline
      const pattern = new RegExp(label + '\\s*[:\\-]\\s*(.+?)(?=\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*\\s*:|\\n|$)', 'i');
      const match = text.match(pattern);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  };

  result.patient.patientName = result.patient.patientName || extractLabeled(docText, 'Patient Name');
  result.patient.patientId = result.patient.patientId || extractLabeled(docText, 'Patient ID', 'Member ID');
  result.patient.dateOfBirth = result.patient.dateOfBirth || extractLabeled(docText, 'Date of Birth', 'DOB');
  result.providerName = result.providerName || extractLabeled(docText, 'Provider', 'Physician', 'Doctor');
  result.claimStatus = result.claimStatus || extractLabeled(docText, 'STATUS', 'Claim Status');

  // Extract service date from labeled text if not found in tables
  if (!result.dates.serviceDate) {
    result.dates.serviceDate = extractLabeled(docText, 'Service Date', 'Date of Service', 'Encounter Date');
  }

  // Extract payment/EOB date (but NOT "Date Issued" which is an admin date)
  if (!result.dates.paymentDate) {
    result.dates.paymentDate = extractLabeled(docText, 'Payment Date', 'Date Paid', 'Date of Payment');
  }

  // 3. Extract financial amounts from labeled text if not found in tables
  const extractAmount = (text: string, ...labels: string[]): number => {
    for (const label of labels) {
      const pattern = new RegExp(label + '\\s*[:\\-]?\\s*\\$([\\d,]+\\.\\d{2})', 'i');
      const match = text.match(pattern);
      if (match) {
        const val = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(val)) return Math.max(0, val);
      }
    }
    return 0;
  };

  if (result.financials.billedAmount === 0) {
    result.financials.billedAmount = extractAmount(docText, 'Billed Amount', 'Total Charge');
  }
  if (result.financials.paidAmount === 0) {
    result.financials.paidAmount = extractAmount(docText, 'Paid Amount', 'Amount Paid');
  }
  if (result.financials.allowedAmount === 0) {
    result.financials.allowedAmount = extractAmount(docText, 'Allowed Amount');
  }
  if (result.financials.patientResponsibility === 0) {
    result.financials.patientResponsibility = extractAmount(docText, 'Patient Responsibility', 'You Owe');
  }

  // 4. Extract diagnosis and procedure codes from text
  const icdPattern = /\b[A-Z]\d{2}(?:\.\d{1,4})?\b/g;
  const icdCodes = docText.match(icdPattern) || [];
  result.diagnosisCodes = Array.from(new Set(icdCodes));

  const cptPattern = /\b\d{5}\b/g;
  const cptCodes = docText.match(cptPattern) || [];
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
