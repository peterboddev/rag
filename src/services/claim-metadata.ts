/**
 * Claim Metadata Extraction Service
 * 
 * Extracts claim-specific fields from medical documents, particularly CMS-1500 forms.
 * Parses extracted text to identify diagnosis codes, monetary amounts, and dates.
 */

import { ClaimMetadata } from '../types';

export interface ExtractedClaimData {
  filingDate?: string;
  primaryDiagnosis?: string;
  claimedAmount?: number;
  approvedAmount?: number;
}

/**
 * Extract claim metadata from document text
 * Focuses on CMS-1500 forms and EOB documents
 */
export function extractClaimMetadata(
  extractedText: string,
  documentType: ClaimMetadata['documentType']
): ExtractedClaimData {
  const metadata: ExtractedClaimData = {};

  if (documentType === 'CMS1500') {
    return extractCMS1500Metadata(extractedText);
  } else if (documentType === 'EOB') {
    return extractEOBMetadata(extractedText);
  }

  return metadata;
}

/**
 * Extract metadata from CMS-1500 form text
 * CMS-1500 is the standard health insurance claim form
 */
function extractCMS1500Metadata(text: string): ExtractedClaimData {
  const metadata: ExtractedClaimData = {};

  // Extract filing date (Box 1 - Date of Service)
  // Common formats: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
  const filingDate = extractFilingDate(text);
  if (filingDate) {
    metadata.filingDate = filingDate;
  }

  // Extract primary diagnosis code (Box 21 - ICD-10 codes)
  // Format: Letter followed by 2 digits, optional decimal and 1-2 more digits
  const diagnosis = extractDiagnosisCode(text);
  if (diagnosis) {
    metadata.primaryDiagnosis = diagnosis;
  }

  // Extract claimed amount (Box 28 - Total Charge)
  // Look for dollar amounts near "total charge", "amount charged", etc.
  const claimedAmount = extractClaimedAmount(text);
  if (claimedAmount) {
    metadata.claimedAmount = claimedAmount;
  }

  return metadata;
}

/**
 * Extract metadata from Explanation of Benefits (EOB) document
 */
function extractEOBMetadata(text: string): ExtractedClaimData {
  const metadata: ExtractedClaimData = {};

  // Extract filing date
  const filingDate = extractFilingDate(text);
  if (filingDate) {
    metadata.filingDate = filingDate;
  }

  // Extract diagnosis from EOB
  const diagnosis = extractDiagnosisCode(text);
  if (diagnosis) {
    metadata.primaryDiagnosis = diagnosis;
  }

  // Extract claimed amount
  const claimedAmount = extractClaimedAmount(text);
  if (claimedAmount) {
    metadata.claimedAmount = claimedAmount;
  }

  // Extract approved/paid amount (specific to EOB)
  const approvedAmount = extractApprovedAmount(text);
  if (approvedAmount) {
    metadata.approvedAmount = approvedAmount;
  }

  return metadata;
}

/**
 * Extract filing date from document text
 * Looks for common date patterns and keywords
 */
function extractFilingDate(text: string): string | undefined {
  // Keywords that often precede dates in medical claims
  const dateKeywords = [
    'date of service',
    'service date',
    'filing date',
    'claim date',
    'date filed',
    'dos'
  ];

  // Try to find dates near keywords
  for (const keyword of dateKeywords) {
    const keywordIndex = text.toLowerCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      // Look for date in next 100 characters after keyword
      const searchText = text.substring(keywordIndex, keywordIndex + 100);
      const date = extractDateFromText(searchText);
      if (date) {
        return date;
      }
    }
  }

  // If no keyword match, try to find any date in the document
  // Prefer dates in YYYY-MM-DD format or recent dates
  const allDates = extractAllDates(text);
  if (allDates.length > 0) {
    // Return the first date found (usually the filing date appears early)
    return allDates[0];
  }

  return undefined;
}

/**
 * Extract date from text segment
 * Supports multiple date formats
 */
function extractDateFromText(text: string): string | undefined {
  // ISO format: YYYY-MM-DD
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return isoMatch[0];
  }

  // US format: MM/DD/YYYY or MM-DD-YYYY
  const usMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    // Convert to ISO format
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return undefined;
}

/**
 * Extract all dates from text
 */
function extractAllDates(text: string): string[] {
  const dates: string[] = [];

  // Find all ISO format dates
  const isoMatches = text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g);
  for (const match of isoMatches) {
    dates.push(match[0]);
  }

  // Find all US format dates and convert to ISO
  const usMatches = text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g);
  for (const match of usMatches) {
    const [, month, day, year] = match;
    dates.push(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  }

  return dates;
}

/**
 * Extract ICD-10 diagnosis code from text
 * ICD-10 format: Letter + 2 digits + optional decimal + 1-2 digits
 * Examples: C50.9, J44.0, E11.9
 */
function extractDiagnosisCode(text: string): string | undefined {
  // Keywords that often precede diagnosis codes
  const diagnosisKeywords = [
    'diagnosis',
    'icd-10',
    'icd10',
    'dx',
    'primary diagnosis',
    'principal diagnosis'
  ];

  // Try to find diagnosis codes near keywords
  for (const keyword of diagnosisKeywords) {
    const keywordIndex = text.toLowerCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      // Look for ICD-10 code in next 200 characters after keyword
      const searchText = text.substring(keywordIndex, keywordIndex + 200);
      const code = extractICD10Code(searchText);
      if (code) {
        return code;
      }
    }
  }

  // If no keyword match, try to find any ICD-10 code in the document
  const code = extractICD10Code(text);
  return code;
}

/**
 * Extract ICD-10 code from text segment
 */
function extractICD10Code(text: string): string | undefined {
  // ICD-10 pattern: Letter + 2 digits + optional (decimal + 1-2 digits)
  const icd10Match = text.match(/\b([A-Z]\d{2}(?:\.\d{1,2})?)\b/);
  if (icd10Match) {
    return icd10Match[1];
  }

  return undefined;
}

/**
 * Extract claimed amount from text
 * Looks for dollar amounts near relevant keywords
 */
function extractClaimedAmount(text: string): number | undefined {
  // Keywords that often precede claimed amounts
  const amountKeywords = [
    'total charge',
    'amount charged',
    'billed amount',
    'claim amount',
    'charges',
    'total billed'
  ];

  // Try to find amounts near keywords
  for (const keyword of amountKeywords) {
    const keywordIndex = text.toLowerCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      // Look for dollar amount in next 100 characters after keyword
      const searchText = text.substring(keywordIndex, keywordIndex + 100);
      const amount = extractDollarAmount(searchText);
      if (amount) {
        return amount;
      }
    }
  }

  // If no keyword match, try to find the largest dollar amount
  // (often the total charge is the largest amount on the form)
  const allAmounts = extractAllDollarAmounts(text);
  if (allAmounts.length > 0) {
    // Return the largest amount found
    return Math.max(...allAmounts);
  }

  return undefined;
}

/**
 * Extract approved/paid amount from EOB text
 */
function extractApprovedAmount(text: string): number | undefined {
  // Keywords specific to approved/paid amounts in EOB
  const approvedKeywords = [
    'approved amount',
    'allowed amount',
    'paid amount',
    'amount paid',
    'payment',
    'reimbursement',
    'covered amount'
  ];

  // Try to find amounts near keywords
  for (const keyword of approvedKeywords) {
    const keywordIndex = text.toLowerCase().indexOf(keyword);
    if (keywordIndex !== -1) {
      // Look for dollar amount in next 100 characters after keyword
      const searchText = text.substring(keywordIndex, keywordIndex + 100);
      const amount = extractDollarAmount(searchText);
      if (amount) {
        return amount;
      }
    }
  }

  return undefined;
}

/**
 * Extract dollar amount from text segment
 * Handles formats: $1,234.56, $1234.56, 1,234.56, 1234.56
 */
function extractDollarAmount(text: string): number | undefined {
  // Match dollar amounts with optional dollar sign and commas
  const amountMatch = text.match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (amountMatch) {
    // Remove commas and parse as float
    const amountStr = amountMatch[1].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    
    // Validate amount is reasonable (between $1 and $1,000,000)
    if (amount >= 1 && amount <= 1000000) {
      return amount;
    }
  }

  return undefined;
}

/**
 * Extract all dollar amounts from text
 */
function extractAllDollarAmounts(text: string): number[] {
  const amounts: number[] = [];
  
  // Find all dollar amounts
  const amountMatches = text.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g);
  for (const match of amountMatches) {
    const amountStr = match[1].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    
    // Only include reasonable amounts
    if (amount >= 1 && amount <= 1000000) {
      amounts.push(amount);
    }
  }

  return amounts;
}

/**
 * Validate extracted claim metadata
 * Ensures data quality and consistency
 */
export function validateClaimMetadata(metadata: ExtractedClaimData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate filing date format
  if (metadata.filingDate) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(metadata.filingDate)) {
      errors.push('Invalid filing date format. Expected YYYY-MM-DD');
    }
  }

  // Validate diagnosis code format (ICD-10)
  if (metadata.primaryDiagnosis) {
    const icd10Regex = /^[A-Z]\d{2}(?:\.\d{1,2})?$/;
    if (!icd10Regex.test(metadata.primaryDiagnosis)) {
      errors.push('Invalid ICD-10 diagnosis code format');
    }
  }

  // Validate claimed amount is positive
  if (metadata.claimedAmount !== undefined) {
    if (metadata.claimedAmount <= 0) {
      errors.push('Claimed amount must be positive');
    }
  }

  // Validate approved amount is positive
  if (metadata.approvedAmount !== undefined) {
    if (metadata.approvedAmount <= 0) {
      errors.push('Approved amount must be positive');
    }
  }

  // Validate approved amount does not exceed claimed amount
  if (metadata.claimedAmount && metadata.approvedAmount) {
    if (metadata.approvedAmount > metadata.claimedAmount) {
      errors.push('Approved amount cannot exceed claimed amount');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Merge extracted metadata with existing claim metadata
 * Preserves existing values and only adds new extracted values
 */
export function mergeClaimMetadata(
  existing: ClaimMetadata,
  extracted: ExtractedClaimData
): ClaimMetadata {
  return {
    ...existing,
    filingDate: existing.filingDate || extracted.filingDate,
    primaryDiagnosis: existing.primaryDiagnosis || extracted.primaryDiagnosis,
    claimedAmount: existing.claimedAmount || extracted.claimedAmount,
    approvedAmount: existing.approvedAmount || extracted.approvedAmount
  };
}
