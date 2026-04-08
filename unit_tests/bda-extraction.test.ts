import { parseBdaResponse, emptyBdaExtraction, BdaExtraction } from '../src/services/bda-extraction';

describe('bda-extraction', () => {
  describe('emptyBdaExtraction', () => {
    it('returns correct default structure', () => {
      const result = emptyBdaExtraction();
      expect(result.patient).toEqual({ patientName: null, patientId: null, dateOfBirth: null });
      expect(result.financials).toEqual({ billedAmount: 0, allowedAmount: 0, paidAmount: 0, patientResponsibility: 0 });
      expect(result.dates).toEqual({ serviceDate: null, paymentDate: null });
      expect(result.claimStatus).toBeNull();
      expect(result.diagnosisCodes).toEqual([]);
      expect(result.procedureCodes).toEqual([]);
      expect(result.providerName).toBeNull();
      expect(result.providerNPI).toBeNull();
    });
  });

  describe('parseBdaResponse', () => {
    it('returns all defaults for empty object', () => {
      const result = parseBdaResponse({});
      expect(result).toEqual(emptyBdaExtraction());
    });

    it('keeps present fields and defaults missing ones', () => {
      const result = parseBdaResponse({
        patient: { patientName: 'Jane Doe' },
        financials: { billedAmount: 1500 },
        claimStatus: 'approved',
      });
      expect(result.patient.patientName).toBe('Jane Doe');
      expect(result.patient.patientId).toBeNull();
      expect(result.financials.billedAmount).toBe(1500);
      expect(result.financials.allowedAmount).toBe(0);
      expect(result.claimStatus).toBe('approved');
      expect(result.diagnosisCodes).toEqual([]);
    });

    it('clamps negative financial amounts to 0', () => {
      const result = parseBdaResponse({
        financials: {
          billedAmount: -100,
          allowedAmount: -50,
          paidAmount: -25,
          patientResponsibility: -10,
        },
      });
      expect(result.financials.billedAmount).toBe(0);
      expect(result.financials.allowedAmount).toBe(0);
      expect(result.financials.paidAmount).toBe(0);
      expect(result.financials.patientResponsibility).toBe(0);
    });

    it('handles full valid BDA response', () => {
      const raw = {
        patient: { patientName: 'John Smith', patientId: 'MEM-123', dateOfBirth: '1990-05-15' },
        financials: { billedAmount: 1500, allowedAmount: 1200, paidAmount: 960, patientResponsibility: 240 },
        dates: { serviceDate: '2024-01-15', paymentDate: '2024-02-01' },
        claimStatus: 'approved',
        diagnosisCodes: ['F10.20', 'J06.9'],
        procedureCodes: ['99213'],
        providerName: 'Dr. Smith',
        providerNPI: '1234567890',
      };
      const result = parseBdaResponse(raw);
      expect(result.patient.patientName).toBe('John Smith');
      expect(result.financials.billedAmount).toBe(1500);
      expect(result.dates.serviceDate).toBe('2024-01-15');
      expect(result.diagnosisCodes).toEqual(['F10.20', 'J06.9']);
      expect(result.procedureCodes).toEqual(['99213']);
      expect(result.providerNPI).toBe('1234567890');
    });

    it('filters non-string items from code arrays', () => {
      const result = parseBdaResponse({
        diagnosisCodes: ['F10.20', 123, null, 'J06.9'],
        procedureCodes: [99213, '99214'],
      });
      expect(result.diagnosisCodes).toEqual(['F10.20', 'J06.9']);
      expect(result.procedureCodes).toEqual(['99214']);
    });

    it('handles non-object patient/financials/dates gracefully', () => {
      const result = parseBdaResponse({
        patient: 'not an object',
        financials: 42,
        dates: null,
      });
      expect(result.patient).toEqual({ patientName: null, patientId: null, dateOfBirth: null });
      expect(result.financials).toEqual({ billedAmount: 0, allowedAmount: 0, paidAmount: 0, patientResponsibility: 0 });
      expect(result.dates).toEqual({ serviceDate: null, paymentDate: null });
    });
  });
});
