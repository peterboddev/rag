import { validateFileType } from '../frontend/src/types';

describe('Frontend Types Validation', () => {
  describe('validateFileType', () => {
    test('should accept valid PDF files', () => {
      const result = validateFileType('document.pdf', 'application/pdf');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept valid text files', () => {
      const result = validateFileType('document.txt', 'text/plain');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should accept valid image files', () => {
      const result = validateFileType('image.jpg', 'image/jpeg');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should reject unsupported file extensions', () => {
      const result = validateFileType('document.xyz', 'application/pdf');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unsupported file extension');
    });

    test('should reject unsupported content types', () => {
      const result = validateFileType('document.pdf', 'application/unknown');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Unsupported content type');
    });

    test('should handle case insensitive extensions', () => {
      const result = validateFileType('DOCUMENT.PDF', 'application/pdf');
      expect(result.isValid).toBe(true);
    });

    test('should validate Word documents', () => {
      const docResult = validateFileType('document.doc', 'application/msword');
      expect(docResult.isValid).toBe(true);

      const docxResult = validateFileType('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(docxResult.isValid).toBe(true);
    });
  });
});