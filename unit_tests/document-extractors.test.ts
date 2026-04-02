import {
  parseDate,
  extractFinancialData,
  extractDates,
  extractMedicalCodes,
  ExtractedFinancials,
  ExtractedDates,
  ExtractedCodes,
} from '../src/services/document-extractors';

describe('document-extractors', () => {
  describe('parseDate', () => {
    it('parses ISO format YYYY-MM-DD', () => {
      expect(parseDate('2024-01-15')).toBe('2024-01-15');
    });

    it('parses US format MM/DD/YYYY', () => {
      expect(parseDate('01/15/2024')).toBe('2024-01-15');
    });

    it('parses US format with single-digit month/day', () => {
      expect(parseDate('1/5/2024')).toBe('2024-01-05');
    });

    it('returns null for invalid month', () => {
      expect(parseDate('2024-13-01')).toBeNull();
    });

    it('returns null for invalid day', () => {
      expect(parseDate('2024-01-32')).toBeNull();
    });

    it('returns null for non-date strings', () => {
      expect(parseDate('not-a-date')).toBeNull();
      expect(parseDate('')).toBeNull();
      expect(parseDate('hello')).toBeNull();
    });
  });

  describe('extractFinancialData', () => {
    it('returns empty defaults for empty text', () => {
      const result = extractFinancialData('');
      expect(result.payments).toEqual([]);
      expect(result.totalValue).toBe(0);
      expect(result.minPayment).toBe(0);
      expect(result.maxPayment).toBe(0);
    });

    it('returns empty defaults for text with no financial data', () => {
      const result = extractFinancialData('This is a medical report with no amounts.');
      expect(result.payments).toEqual([]);
      expect(result.totalValue).toBe(0);
    });

    it('extracts dollar amounts with $ prefix', () => {
      const result = extractFinancialData('The charge was $250.00');
      expect(result.payments.length).toBeGreaterThanOrEqual(1);
      expect(result.payments.some(p => p.amount === 250)).toBe(true);
    });

    it('extracts comma-separated dollar amounts', () => {
      const result = extractFinancialData('Total billed: $1,234.56');
      expect(result.payments.some(p => p.amount === 1234.56)).toBe(true);
    });

    it('extracts labeled amounts', () => {
      const result = extractFinancialData('copay: $50.00\ndeductible: $200.00');
      expect(result.payments.length).toBeGreaterThanOrEqual(2);
      expect(result.totalValue).toBeGreaterThanOrEqual(250);
    });

    it('computes correct min/max/total', () => {
      const result = extractFinancialData('amount: $100.00\namount: $300.00\namount: $200.00');
      expect(result.minPayment).toBe(100);
      expect(result.maxPayment).toBe(300);
      expect(result.totalValue).toBe(600);
    });

    it('totalValue equals sum of payment amounts', () => {
      const result = extractFinancialData('fee: $10.00\ncost: $20.00\ncharge: $30.00');
      const sum = result.payments.reduce((s, p) => s + p.amount, 0);
      expect(result.totalValue).toBeCloseTo(sum, 2);
    });
  });

  describe('extractDates', () => {
    it('returns empty defaults for empty text', () => {
      const result = extractDates('');
      expect(result.dates).toEqual([]);
      expect(result.earliestDate).toBeNull();
      expect(result.latestDate).toBeNull();
    });

    it('returns empty defaults for text with no labeled dates', () => {
      const result = extractDates('This is a report with no dates.');
      expect(result.dates).toEqual([]);
      expect(result.earliestDate).toBeNull();
    });

    it('extracts ISO dates near labels', () => {
      const result = extractDates('Service Date: 2024-01-15');
      expect(result.dates.length).toBe(1);
      expect(result.dates[0].date).toBe('2024-01-15');
      expect(result.dates[0].label).toBe('service date');
    });

    it('extracts US format dates near labels', () => {
      const result = extractDates('Birth Date: 03/20/1990');
      expect(result.dates.length).toBe(1);
      expect(result.dates[0].date).toBe('1990-03-20');
    });

    it('computes earliest and latest dates', () => {
      const text = 'Service Date: 2024-06-15\nBirth Date: 1990-03-20\nDischarge Date: 2024-07-01';
      const result = extractDates(text);
      expect(result.earliestDate).toBe('1990-03-20');
      expect(result.latestDate).toBe('2024-07-01');
    });

    it('all dates are in ISO format', () => {
      const text = 'Admission Date: 01/15/2024\nDischarge Date: 2024-01-20';
      const result = extractDates(text);
      for (const d of result.dates) {
        expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe('extractMedicalCodes', () => {
    it('returns empty defaults for empty text', () => {
      const result = extractMedicalCodes('');
      expect(result.diagnosisCodes).toEqual([]);
      expect(result.procedureCodes).toEqual([]);
      expect(result.providerNames).toEqual([]);
    });

    it('extracts ICD-10 codes', () => {
      const result = extractMedicalCodes('Diagnosis: F10.20 and J06.9');
      expect(result.diagnosisCodes).toContain('F10.20');
      expect(result.diagnosisCodes).toContain('J06.9');
    });

    it('extracts ICD-10 codes without decimal', () => {
      const result = extractMedicalCodes('Code: M54');
      expect(result.diagnosisCodes).toContain('M54');
    });

    it('extracts CPT codes', () => {
      const result = extractMedicalCodes('CPT: 99213 and CPT 99214');
      expect(result.procedureCodes).toContain('99213');
      expect(result.procedureCodes).toContain('99214');
    });

    it('extracts provider names', () => {
      const result = extractMedicalCodes('Provider Name: Dr. Smith\nProvider Name: Dr. Jones');
      expect(result.providerNames).toContain('Dr. Smith');
      expect(result.providerNames).toContain('Dr. Jones');
    });

    it('handles mixed content', () => {
      const text = 'Patient has F10.20\nCPT: 99213\nProvider Name: Dr. Smith';
      const result = extractMedicalCodes(text);
      expect(result.diagnosisCodes.length).toBeGreaterThanOrEqual(1);
      expect(result.procedureCodes.length).toBeGreaterThanOrEqual(1);
      expect(result.providerNames.length).toBeGreaterThanOrEqual(1);
    });
  });
});
