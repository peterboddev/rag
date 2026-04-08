import fc from 'fast-check';
import { parseBdaResponse, emptyBdaExtraction, BdaExtraction } from '../src/services/bda-extraction';

/**
 * Property 1: BDA extraction structural validity
 * **Validates: Requirements 3.1–3.6**
 *
 * For any arbitrary object, parseBdaResponse returns a valid BdaExtraction where
 * all financial amounts are non-negative numbers, patient fields are string or null,
 * date fields are string or null, code arrays are string arrays, and claimStatus is string or null.
 */
describe('Property 1: BDA extraction structural validity', () => {
  it('parseBdaResponse always returns structurally valid BdaExtraction for any input', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const input = (typeof raw === 'object' && raw !== null && !Array.isArray(raw))
          ? raw as Record<string, any>
          : {};
        const result = parseBdaResponse(input);

        // Financial amounts are non-negative numbers
        expect(typeof result.financials.billedAmount).toBe('number');
        expect(typeof result.financials.allowedAmount).toBe('number');
        expect(typeof result.financials.paidAmount).toBe('number');
        expect(typeof result.financials.patientResponsibility).toBe('number');
        expect(result.financials.billedAmount).toBeGreaterThanOrEqual(0);
        expect(result.financials.allowedAmount).toBeGreaterThanOrEqual(0);
        expect(result.financials.paidAmount).toBeGreaterThanOrEqual(0);
        expect(result.financials.patientResponsibility).toBeGreaterThanOrEqual(0);

        // Patient fields are string or null
        expect(result.patient.patientName === null || typeof result.patient.patientName === 'string').toBe(true);
        expect(result.patient.patientId === null || typeof result.patient.patientId === 'string').toBe(true);
        expect(result.patient.dateOfBirth === null || typeof result.patient.dateOfBirth === 'string').toBe(true);

        // Date fields are string or null
        expect(result.dates.serviceDate === null || typeof result.dates.serviceDate === 'string').toBe(true);
        expect(result.dates.paymentDate === null || typeof result.dates.paymentDate === 'string').toBe(true);

        // Code arrays are string arrays
        expect(Array.isArray(result.diagnosisCodes)).toBe(true);
        expect(Array.isArray(result.procedureCodes)).toBe(true);
        result.diagnosisCodes.forEach(c => expect(typeof c).toBe('string'));
        result.procedureCodes.forEach(c => expect(typeof c).toBe('string'));

        // claimStatus is string or null
        expect(result.claimStatus === null || typeof result.claimStatus === 'string').toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Property 2: BDA extraction round-trip
 * **Validates: Requirement 3.7**
 *
 * For any valid BdaExtraction object, serializing to JSON then deserializing
 * and passing through parseBdaResponse produces an object deeply equal to the original.
 */
describe('Property 2: BDA extraction round-trip', () => {
  const bdaExtractionArb = fc.record({
    patient: fc.record({
      patientName: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
      patientId: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
      dateOfBirth: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
    }),
    financials: fc.record({
      billedAmount: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      allowedAmount: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      paidAmount: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
      patientResponsibility: fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    }),
    dates: fc.record({
      serviceDate: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
      paymentDate: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
    }),
    claimStatus: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
    diagnosisCodes: fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
    procedureCodes: fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
    providerName: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
    providerNPI: fc.oneof(fc.string({ minLength: 1 }), fc.constant(null)),
  });

  it('round-trips through JSON serialization and parseBdaResponse', () => {
    fc.assert(
      fc.property(bdaExtractionArb, (extraction) => {
        const roundTripped = parseBdaResponse(JSON.parse(JSON.stringify(extraction)));
        expect(roundTripped).toEqual(extraction);
      }),
      { numRuns: 100 }
    );
  });
});
