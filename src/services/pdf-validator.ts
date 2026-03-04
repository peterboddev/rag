import { PDFValidationResult, ValidationError, ValidationWarning } from '../types';

export class PDFValidatorService {
  private static readonly PDF_HEADER = '%PDF-';
  private static readonly MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
  private static readonly SUPPORTED_PDF_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0'];

  /**
   * Validates a PDF file buffer and returns comprehensive validation results
   */
  static async validatePDF(fileBuffer: Buffer, fileName: string): Promise<PDFValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    let pdfVersion: string | undefined;
    let isEncrypted = false;
    let hasTextContent = false;
    let pageCount = 0;
    const fileSizeBytes = fileBuffer.length;

    try {
      // 1. Check file size
      if (fileSizeBytes > this.MAX_FILE_SIZE) {
        errors.push({
          code: 'FILE_TOO_LARGE',
          message: `File size ${Math.round(fileSizeBytes / (1024 * 1024))}MB exceeds maximum allowed size of 500MB`,
          severity: 'error',
          suggestedAction: 'Please reduce the file size or split into smaller documents'
        });
      }

      // 2. Validate PDF header
      const headerValidation = this.validatePDFHeader(fileBuffer);
      if (!headerValidation.isValid) {
        errors.push({
          code: 'INVALID_PDF_HEADER',
          message: 'File does not appear to be a valid PDF document',
          severity: 'error',
          suggestedAction: 'Please ensure the file is a valid PDF and try again'
        });
      } else {
        pdfVersion = headerValidation.version;
      }

      // 3. Check PDF version compatibility
      if (pdfVersion && !this.SUPPORTED_PDF_VERSIONS.includes(pdfVersion)) {
        warnings.push({
          code: 'UNSUPPORTED_PDF_VERSION',
          message: `PDF version ${pdfVersion} may not be fully supported`,
          suggestedAction: 'Consider converting to PDF version 1.7 or 2.0 for best compatibility'
        });
      }

      // 4. Check for encryption
      isEncrypted = this.checkPDFEncryption(fileBuffer);
      if (isEncrypted) {
        errors.push({
          code: 'PDF_ENCRYPTED',
          message: 'PDF document is password-protected or encrypted',
          severity: 'error',
          suggestedAction: 'Please provide an unencrypted version of the PDF document'
        });
      }

      // 5. Estimate page count and text content (basic heuristics)
      const contentAnalysis = this.analyzePDFContent(fileBuffer);
      pageCount = contentAnalysis.estimatedPageCount;
      hasTextContent = contentAnalysis.hasTextContent;

      if (!hasTextContent && !isEncrypted) {
        warnings.push({
          code: 'NO_TEXT_CONTENT',
          message: 'PDF appears to contain only images or no extractable text',
          suggestedAction: 'Consider using OCR tools or providing a text-based version of the document'
        });
      }

      // 6. Check for potential corruption
      const corruptionCheck = this.checkPDFIntegrity(fileBuffer);
      if (!corruptionCheck.isValid) {
        errors.push({
          code: 'PDF_CORRUPTED',
          message: 'PDF file appears to be corrupted or incomplete',
          severity: 'error',
          suggestedAction: 'Please try re-saving or re-exporting the PDF document'
        });
      }

    } catch (error) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: `Error during PDF validation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'error',
        suggestedAction: 'Please try uploading the document again'
      });
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      pdfVersion,
      isEncrypted,
      hasTextContent,
      pageCount,
      fileSizeBytes,
      errors,
      warnings
    };
  }

  /**
   * Validates PDF header and extracts version
   */
  private static validatePDFHeader(fileBuffer: Buffer): { isValid: boolean; version?: string } {
    if (fileBuffer.length < 8) {
      return { isValid: false };
    }

    const header = fileBuffer.subarray(0, 8).toString('ascii');
    
    if (!header.startsWith(this.PDF_HEADER)) {
      return { isValid: false };
    }

    // Extract version (e.g., "%PDF-1.4")
    const versionMatch = header.match(/%PDF-(\d+\.\d+)/);
    if (versionMatch) {
      return { isValid: true, version: versionMatch[1] };
    }

    return { isValid: true };
  }

  /**
   * Checks if PDF is encrypted by looking for encryption markers
   */
  private static checkPDFEncryption(fileBuffer: Buffer): boolean {
    const content = fileBuffer.toString('binary');
    
    // Look for encryption-related keywords in the PDF structure
    const encryptionMarkers = [
      '/Encrypt',
      '/Filter/Standard',
      '/Filter/V2',
      '/UserPassword',
      '/OwnerPassword'
    ];

    return encryptionMarkers.some(marker => content.includes(marker));
  }

  /**
   * Analyzes PDF content to estimate page count and text presence
   */
  private static analyzePDFContent(fileBuffer: Buffer): { estimatedPageCount: number; hasTextContent: boolean } {
    const content = fileBuffer.toString('binary');
    
    // Estimate page count by looking for page objects
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    const estimatedPageCount = pageMatches ? pageMatches.length : 1;

    // Check for text content indicators
    const textIndicators = [
      '/Font',
      'BT', // Begin text
      'ET', // End text
      'Tj', // Show text
      'TJ', // Show text with individual glyph positioning
      '/Contents'
    ];

    const hasTextContent = textIndicators.some(indicator => content.includes(indicator));

    return {
      estimatedPageCount: Math.max(1, estimatedPageCount),
      hasTextContent
    };
  }

  /**
   * Performs basic integrity check on PDF structure
   */
  private static checkPDFIntegrity(fileBuffer: Buffer): { isValid: boolean } {
    const content = fileBuffer.toString('binary');
    
    // Check for essential PDF structure elements
    const requiredElements = [
      '%PDF-', // Header
      'trailer', // Trailer
      'startxref' // Cross-reference table pointer
    ];

    const hasRequiredElements = requiredElements.every(element => content.includes(element));
    
    // Check if file ends properly (should end with %%EOF or similar)
    const endsWithEOF = content.endsWith('%%EOF') || content.includes('%%EOF');

    return {
      isValid: hasRequiredElements && endsWithEOF
    };
  }

  /**
   * Creates a user-friendly error message from validation results
   */
  static createErrorMessage(validationResult: PDFValidationResult): string {
    if (validationResult.isValid) {
      return '';
    }

    const errorMessages = validationResult.errors.map(error => error.message);
    const warningMessages = validationResult.warnings.map(warning => warning.message);

    let message = 'PDF validation failed:\n';
    
    if (errorMessages.length > 0) {
      message += '\nErrors:\n' + errorMessages.map(msg => `• ${msg}`).join('\n');
    }
    
    if (warningMessages.length > 0) {
      message += '\nWarnings:\n' + warningMessages.map(msg => `• ${msg}`).join('\n');
    }

    return message;
  }

  /**
   * Gets suggested actions from validation results
   */
  static getSuggestedActions(validationResult: PDFValidationResult): string[] {
    const actions: string[] = [];
    
    validationResult.errors.forEach(error => {
      if (error.suggestedAction) {
        actions.push(error.suggestedAction);
      }
    });

    validationResult.warnings.forEach(warning => {
      if (warning.suggestedAction) {
        actions.push(warning.suggestedAction);
      }
    });

    return [...new Set(actions)]; // Remove duplicates
  }
}