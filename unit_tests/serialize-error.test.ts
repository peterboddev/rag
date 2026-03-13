import { describe, it, expect } from '@jest/globals';

// Import the serializeError function by extracting it from the claim-loader module
// Since it's not exported, we'll test it through the module's behavior
// For now, we'll create a standalone version for testing

/**
 * Serialize Error objects for logging
 * 
 * JavaScript Error objects have non-enumerable properties (message, name, stack, code)
 * that don't serialize with JSON.stringify(). This utility extracts all relevant
 * properties from Error objects to ensure complete error information is logged.
 * 
 * @param error - The error to serialize (can be Error, AWS SDK error, or any value)
 * @returns Serialized error object with all properties, or the original value if not an Error
 */
function serializeError(error: any): any {
  // Handle null and undefined
  if (error === null || error === undefined) {
    return error;
  }

  // If not an Error object, return as-is
  if (!(error instanceof Error)) {
    return error;
  }

  // Extract standard Error properties
  const serialized: Record<string, any> = {
    message: error.message,
    name: error.name,
    stack: error.stack
  };

  // Extract AWS SDK specific properties (if present)
  // These are typically enumerable but we explicitly extract them for clarity
  if ('code' in error && error.code !== undefined) {
    serialized.code = error.code;
  }

  if ('statusCode' in error && error.statusCode !== undefined) {
    serialized.statusCode = error.statusCode;
  }

  if ('requestId' in error && error.requestId !== undefined) {
    serialized.requestId = error.requestId;
  }

  if ('retryable' in error && error.retryable !== undefined) {
    serialized.retryable = error.retryable;
  }

  // Extract any other enumerable properties that might be useful
  // This catches custom properties added by AWS SDK or application code
  try {
    for (const key in error) {
      if (error.hasOwnProperty(key) && !(key in serialized)) {
        // Avoid circular references by checking if value is an object
        const value = (error as any)[key];
        if (typeof value !== 'object' || value === null) {
          serialized[key] = value;
        }
      }
    }
  } catch (e) {
    // Ignore errors from property enumeration (e.g., circular references)
    serialized._serializationError = 'Failed to enumerate all properties';
  }

  return serialized;
}

describe('serializeError', () => {
  describe('Standard Error Properties', () => {
    it('should extract message, name, and stack from Error objects', () => {
      const error = new Error('Test error message');
      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', 'Test error message');
      expect(serialized).toHaveProperty('name', 'Error');
      expect(serialized).toHaveProperty('stack');
      expect(serialized.stack).toContain('Test error message');
    });

    it('should extract properties from custom Error subclasses', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error message');
      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', 'Custom error message');
      expect(serialized).toHaveProperty('name', 'CustomError');
      expect(serialized).toHaveProperty('stack');
    });
  });

  describe('AWS SDK Error Properties', () => {
    it('should extract AWS SDK specific properties (code, statusCode, requestId, retryable)', () => {
      const awsError: any = new Error('AWS SDK Error');
      awsError.code = 'AccessDenied';
      awsError.statusCode = 403;
      awsError.requestId = 'abc-123-def-456';
      awsError.retryable = false;

      const serialized = serializeError(awsError);

      expect(serialized).toHaveProperty('message', 'AWS SDK Error');
      expect(serialized).toHaveProperty('name', 'Error');
      expect(serialized).toHaveProperty('code', 'AccessDenied');
      expect(serialized).toHaveProperty('statusCode', 403);
      expect(serialized).toHaveProperty('requestId', 'abc-123-def-456');
      expect(serialized).toHaveProperty('retryable', false);
    });

    it('should handle partial AWS SDK properties', () => {
      const awsError: any = new Error('Partial AWS Error');
      awsError.code = 'ThrottlingException';
      // No statusCode, requestId, or retryable

      const serialized = serializeError(awsError);

      expect(serialized).toHaveProperty('code', 'ThrottlingException');
      expect(serialized).not.toHaveProperty('statusCode');
      expect(serialized).not.toHaveProperty('requestId');
      expect(serialized).not.toHaveProperty('retryable');
    });
  });

  describe('Non-Error Values', () => {
    it('should return null as-is', () => {
      const result = serializeError(null);
      expect(result).toBeNull();
    });

    it('should return undefined as-is', () => {
      const result = serializeError(undefined);
      expect(result).toBeUndefined();
    });

    it('should return strings as-is', () => {
      const result = serializeError('error string');
      expect(result).toBe('error string');
    });

    it('should return numbers as-is', () => {
      const result = serializeError(42);
      expect(result).toBe(42);
    });

    it('should return plain objects as-is', () => {
      const obj = { error: 'plain object' };
      const result = serializeError(obj);
      expect(result).toBe(obj);
    });
  });

  describe('Edge Cases', () => {
    it('should handle Error with no message', () => {
      const error = new Error();
      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', '');
      expect(serialized).toHaveProperty('name', 'Error');
      expect(serialized).toHaveProperty('stack');
    });

    it('should handle Error with custom enumerable properties', () => {
      const error: any = new Error('Error with custom props');
      error.customProp = 'custom value';
      error.customNumber = 123;

      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', 'Error with custom props');
      expect(serialized).toHaveProperty('customProp', 'custom value');
      expect(serialized).toHaveProperty('customNumber', 123);
    });

    it('should avoid circular references in custom properties', () => {
      const error: any = new Error('Error with circular ref');
      error.circular = { ref: error }; // Circular reference

      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', 'Error with circular ref');
      // Circular reference should not be included
      expect(serialized).not.toHaveProperty('circular');
    });

    it('should not serialize object properties to avoid circular references', () => {
      const error: any = new Error('Error with object property');
      error.metadata = { key: 'value' };

      const serialized = serializeError(error);

      expect(serialized).toHaveProperty('message', 'Error with object property');
      // Object properties are not serialized to avoid circular references
      expect(serialized).not.toHaveProperty('metadata');
    });
  });

  describe('JSON Serialization', () => {
    it('should produce non-empty JSON when serialized', () => {
      const error = new Error('Test error');
      const serialized = serializeError(error);
      const json = JSON.stringify(serialized);

      expect(json).not.toBe('{}');
      expect(json).toContain('Test error');
      expect(json).toContain('message');
      expect(json).toContain('name');
    });

    it('should produce valid JSON for AWS SDK errors', () => {
      const awsError: any = new Error('AWS Error');
      awsError.code = 'ValidationException';
      awsError.statusCode = 400;

      const serialized = serializeError(awsError);
      const json = JSON.stringify(serialized);

      expect(json).toContain('ValidationException');
      expect(json).toContain('400');
      expect(json).toContain('AWS Error');
    });
  });
});
