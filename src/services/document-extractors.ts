/**
 * Document Extractors — pure-function module for extracting structured data
 * from document text using regex patterns.
 *
 * Ported from agents/full_context_agent/agent.py:
 *   _extract_financial_data_impl, _extract_timeline_data_impl, _find_dates, _parse_date
 *
 * No AWS SDK dependencies — takes text strings, returns structured data.
 */

/** Single payment found in document text */
export interface ExtractedPayment {
  amount: number;
  rawText: string;
  context: string; // label that preceded the amount, e.g. "copay"
}

/** Financial data extracted from a single document */
export interface ExtractedFinancials {
  payments: ExtractedPayment[];
  totalValue: number;
  minPayment: number;
  maxPayment: number;
}

/** Date found in document text */
export interface ExtractedDate {
  date: string;       // ISO format YYYY-MM-DD
  label: string;      // e.g. "service date", "birth date"
  rawText: string;    // original matched text
}

/** Date data extracted from a single document */
export interface ExtractedDates {
  dates: ExtractedDate[];
  earliestDate: string | null;  // ISO format
  latestDate: string | null;    // ISO format
}

/** Medical codes extracted from a single document */
export interface ExtractedCodes {
  diagnosisCodes: string[];  // ICD-10 codes, e.g. ["F10.20", "J06.9"]
  procedureCodes: string[];  // CPT codes, e.g. ["99213", "99214"]
  providerNames: string[];   // Provider names found
}

// ---------------------------------------------------------------------------
// Date labels used for date extraction (ported from Python _extract_timeline_data_impl)
// ---------------------------------------------------------------------------

const DATE_LABELS: string[] = [
  // Patient dates
  'birth date', 'dob', 'date of birth', 'born',
  // Service dates
  'service date', 'date of service', 'dos', 'encounter date', 'visit date',
  'appointment date', 'consultation date', 'examination date',
  // Medical procedure dates
  'procedure date', 'treatment date', 'surgery date', 'operation date',
  'test date', 'lab date', 'imaging date', 'x-ray date', 'mri date',
  // Facility dates
  'admission date', 'discharge date', 'admission', 'discharge',
  'check-in date', 'check-out date',
  // Billing dates
  'payment date', 'paid date', 'date paid', 'billing date', 'invoice date',
  'claim date', 'processed date', 'adjudicated', 'submitted',
  // Insurance dates
  'effective date', 'coverage date', 'policy date', 'expiration date',
  'authorization date', 'approval date',
];

// ---------------------------------------------------------------------------
// Currency regex patterns (ported from Python _extract_financial_data_impl)
// ---------------------------------------------------------------------------

interface CurrencyPattern {
  regex: RegExp;
  contextLabel: string; // default context when no label captured
}

const CURRENCY_PATTERNS: CurrencyPattern[] = [
  // Standard currency: $1,234.56
  { regex: /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'currency' },
  // 1,234.56 USD / dollars
  { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?)/gi, contextLabel: 'currency' },
  // Labeled amounts
  { regex: /(?:amount|total|payment|charge|cost|fee|copay|deductible|balance|claim):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'labeled' },
  { regex: /(?:paid|billed|charged|owed|due|allowed):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'labeled' },
  // Insurance-specific terms
  { regex: /(?:coinsurance|copayment|premium|benefit):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'insurance' },
  { regex: /(?:reimbursement|adjustment|write[- ]?off):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'insurance' },
  // Medical billing terms
  { regex: /(?:procedure|service|office visit|consultation)\s+(?:cost|fee|charge):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, contextLabel: 'medical' },
  // Line item patterns
  { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:\$|dollars?|USD)\s*(?:each|per|total)/gi, contextLabel: 'line-item' },
];

// ---------------------------------------------------------------------------
// parseDate
// ---------------------------------------------------------------------------

/**
 * Parse a date string in ISO (YYYY-MM-DD) or US (MM/DD/YYYY) format.
 * Returns ISO string (YYYY-MM-DD) or null if parsing fails.
 */
export function parseDate(dateStr: string): string | null {
  // ISO format: YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  // US format: M/D/YYYY or MM/DD/YYYY
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// findDates — internal helper (ported from Python _find_dates)
// ---------------------------------------------------------------------------

function findDates(text: string, labels: string[]): Array<{ dateStr: string; label: string }> {
  const results: Array<{ dateStr: string; label: string }> = [];
  const textLower = text.toLowerCase();

  const isoPattern = /(\d{4}-\d{2}-\d{2})/g;
  const usPattern = /(\d{1,2}\/\d{1,2}\/\d{4})/g;

  for (const label of labels) {
    const labelLower = label.toLowerCase();
    let idx = textLower.indexOf(labelLower);
    while (idx !== -1) {
      // Look for a date within 80 chars after the label
      const context = text.substring(idx, idx + 80);

      for (const pattern of [isoPattern, usPattern]) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(context)) !== null) {
          results.push({ dateStr: match[1], label });
        }
      }

      idx = textLower.indexOf(labelLower, idx + 1);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// extractFinancialData
// ---------------------------------------------------------------------------

/**
 * Extract financial data from document text using regex patterns.
 * Port of Python _extract_financial_data_impl, operating on a single
 * document's text rather than a list of document dicts.
 */
export function extractFinancialData(text: string): ExtractedFinancials {
  const payments: ExtractedPayment[] = [];
  const seen = new Set<string>(); // deduplicate by "amount|rawText" key

  for (const { regex, contextLabel } of CURRENCY_PATTERNS) {
    // Reset lastIndex for global regex reuse
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const rawText = match[1];
      try {
        const amount = parseFloat(rawText.replace(/,/g, ''));
        if (amount > 0) {
          const key = `${amount}|${rawText}`;
          if (!seen.has(key)) {
            seen.add(key);

            // Try to extract a more specific context label from the match
            const fullMatch = match[0].toLowerCase();
            const labelMatch = fullMatch.match(
              /^(amount|total|payment|charge|cost|fee|copay|deductible|balance|claim|paid|billed|charged|owed|due|allowed|coinsurance|copayment|premium|benefit|reimbursement|adjustment|write[- ]?off)/
            );
            const context = labelMatch ? labelMatch[1] : contextLabel;

            payments.push({ amount, rawText, context });
          }
        }
      } catch {
        // skip unparseable amounts
      }
    }
  }

  if (payments.length === 0) {
    return { payments: [], totalValue: 0, minPayment: 0, maxPayment: 0 };
  }

  const amounts = payments.map(p => p.amount);
  const totalValue = amounts.reduce((sum, a) => sum + a, 0);
  // Round to avoid floating-point drift
  const roundedTotal = Math.round(totalValue * 100) / 100;

  return {
    payments,
    totalValue: roundedTotal,
    minPayment: Math.min(...amounts),
    maxPayment: Math.max(...amounts),
  };
}

// ---------------------------------------------------------------------------
// extractDates
// ---------------------------------------------------------------------------

/**
 * Extract date/timeline data from document text using label+date matching.
 * Port of Python _extract_timeline_data_impl, operating on a single
 * document's text.
 */
export function extractDates(text: string): ExtractedDates {
  const rawMatches = findDates(text, DATE_LABELS);
  const dates: ExtractedDate[] = [];
  const seen = new Set<string>();

  for (const { dateStr, label } of rawMatches) {
    const parsed = parseDate(dateStr);
    if (parsed) {
      const key = `${parsed}|${label}`;
      if (!seen.has(key)) {
        seen.add(key);
        dates.push({ date: parsed, label, rawText: dateStr });
      }
    }
  }

  if (dates.length === 0) {
    return { dates: [], earliestDate: null, latestDate: null };
  }

  const sortedDates = dates.map(d => d.date).sort();
  return {
    dates,
    earliestDate: sortedDates[0],
    latestDate: sortedDates[sortedDates.length - 1],
  };
}

// ---------------------------------------------------------------------------
// extractMedicalCodes
// ---------------------------------------------------------------------------

/**
 * Extract ICD-10 diagnosis codes, CPT procedure codes, and provider names.
 */
export function extractMedicalCodes(text: string): ExtractedCodes {
  // ICD-10: letter followed by 2 digits, optionally a dot and 1-4 digits
  const icd10Pattern = /\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/g;
  const diagnosisCodes = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = icd10Pattern.exec(text)) !== null) {
    diagnosisCodes.add(m[1]);
  }

  // CPT: "CPT" or "cpt" followed by optional colon/space, then 5 digits
  const cptPattern = /(?:CPT|cpt)\s*:?\s*(\d{5})/g;
  const procedureCodes = new Set<string>();
  while ((m = cptPattern.exec(text)) !== null) {
    procedureCodes.add(m[1]);
  }

  // Provider names
  const providerPattern = /[Pp]rovider\s*[Nn]ame\s*:\s*([A-Za-z\s.]+?)(?:\n|$|,)/g;
  const providerNames = new Set<string>();
  while ((m = providerPattern.exec(text)) !== null) {
    const name = m[1].trim();
    if (name) {
      providerNames.add(name);
    }
  }

  return {
    diagnosisCodes: [...diagnosisCodes],
    procedureCodes: [...procedureCodes],
    providerNames: [...providerNames],
  };
}
