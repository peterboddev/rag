import { validateFileType, isTextDocument, requiresTextract, SUPPORTED_FILE_EXTENSIONS } from '../src/types';
import fc from 'fast-check';

describe('Feature: multi-tenant-document-manager', () => {
  describe('File Type Validation', () => {
    it('should validate supported file types correctly', () => {
      // Test supported extensions
      expect(validateFileType('document.pdf', 'application/pdf')).toEqual({ isValid: true });
      expect(validateFileType('document.txt', 'text/plain')).toEqual({ isValid: true });
      expect(validateFileType('image.jpg', 'image/jpeg')).toEqual({ isValid: true });
      
      // Test unsupported extensions
      expect(validateFileType('document.xyz', 'application/xyz')).toEqual({
        isValid: false,
        error: expect.stringContaining('Unsupported file extension')
      });
    });

    it('Property 1: File Type Validation - for any file, validation should correctly identify supported vs unsupported types', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1 }),
        fc.oneof(
          ...SUPPORTED_FILE_EXTENSIONS.map(ext => fc.constant(ext)),
          fc.string({ minLength: 1 }).map(s => `.${s}`)
        ),
        (filename, extension) => {
          const fullFilename = filename + extension;
          const result = validateFileType(fullFilename, 'application/pdf'); // Use a supported content type
          
          if (SUPPORTED_FILE_EXTENSIONS.includes(extension as any)) {
            return result.isValid === true;
          } else {
            return result.isValid === false && result.error !== undefined;
          }
        }
      ), { numRuns: 100 });
    });
  });

  describe('Document Type Detection', () => {
    it('should correctly identify text documents', () => {
      expect(isTextDocument('text/plain')).toBe(true);
      expect(isTextDocument('application/pdf')).toBe(false);
      expect(isTextDocument('image/jpeg')).toBe(false);
    });

    it('should correctly identify documents requiring Textract', () => {
      expect(requiresTextract('application/pdf')).toBe(true);
      expect(requiresTextract('image/jpeg')).toBe(true);
      expect(requiresTextract('text/plain')).toBe(false);
      expect(requiresTextract('application/unsupported')).toBe(false);
    });
  });
});