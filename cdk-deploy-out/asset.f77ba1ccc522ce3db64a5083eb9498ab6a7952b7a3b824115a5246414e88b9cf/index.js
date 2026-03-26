"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lambda/document-upload.ts
var document_upload_exports = {};
__export(document_upload_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(document_upload_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");

// node_modules/uuid/dist/esm-node/rng.js
var import_crypto = __toESM(require("crypto"));
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    import_crypto.default.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

// node_modules/uuid/dist/esm-node/native.js
var import_crypto2 = __toESM(require("crypto"));
var native_default = {
  randomUUID: import_crypto2.default.randomUUID
};

// node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/types/index.ts
var SUPPORTED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/tiff"
];
var SUPPORTED_FILE_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif"
];
var isTextDocument = (contentType) => {
  return contentType === "text/plain";
};
var requiresTextract = (contentType) => {
  return !isTextDocument(contentType) && SUPPORTED_FILE_TYPES.includes(contentType);
};
var validateFileType = (fileName, contentType) => {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf("."));
  if (!SUPPORTED_FILE_EXTENSIONS.includes(extension)) {
    return {
      isValid: false,
      error: `Unsupported file extension: ${extension}. Supported types: ${SUPPORTED_FILE_EXTENSIONS.join(", ")}`
    };
  }
  if (!SUPPORTED_FILE_TYPES.includes(contentType)) {
    return {
      isValid: false,
      error: `Unsupported content type: ${contentType}`
    };
  }
  return { isValid: true };
};

// src/services/pdf-validator.ts
var PDFValidatorService = class {
  static {
    this.PDF_HEADER = "%PDF-";
  }
  static {
    this.MAX_FILE_SIZE = 500 * 1024 * 1024;
  }
  static {
    // 500MB
    this.SUPPORTED_PDF_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.0"];
  }
  /**
   * Validates a PDF file buffer and returns comprehensive validation results
   */
  static async validatePDF(fileBuffer, fileName) {
    const errors = [];
    const warnings = [];
    let pdfVersion;
    let isEncrypted = false;
    let hasTextContent = false;
    let pageCount = 0;
    const fileSizeBytes = fileBuffer.length;
    try {
      if (fileSizeBytes > this.MAX_FILE_SIZE) {
        errors.push({
          code: "FILE_TOO_LARGE",
          message: `File size ${Math.round(fileSizeBytes / (1024 * 1024))}MB exceeds maximum allowed size of 500MB`,
          severity: "error",
          suggestedAction: "Please reduce the file size or split into smaller documents"
        });
      }
      const headerValidation = this.validatePDFHeader(fileBuffer);
      if (!headerValidation.isValid) {
        errors.push({
          code: "INVALID_PDF_HEADER",
          message: "File does not appear to be a valid PDF document",
          severity: "error",
          suggestedAction: "Please ensure the file is a valid PDF and try again"
        });
      } else {
        pdfVersion = headerValidation.version;
      }
      if (pdfVersion && !this.SUPPORTED_PDF_VERSIONS.includes(pdfVersion)) {
        warnings.push({
          code: "UNSUPPORTED_PDF_VERSION",
          message: `PDF version ${pdfVersion} may not be fully supported`,
          suggestedAction: "Consider converting to PDF version 1.7 or 2.0 for best compatibility"
        });
      }
      isEncrypted = this.checkPDFEncryption(fileBuffer);
      if (isEncrypted) {
        errors.push({
          code: "PDF_ENCRYPTED",
          message: "PDF document is password-protected or encrypted",
          severity: "error",
          suggestedAction: "Please provide an unencrypted version of the PDF document"
        });
      }
      const contentAnalysis = this.analyzePDFContent(fileBuffer);
      pageCount = contentAnalysis.estimatedPageCount;
      hasTextContent = contentAnalysis.hasTextContent;
      if (!hasTextContent && !isEncrypted) {
        warnings.push({
          code: "NO_TEXT_CONTENT",
          message: "PDF appears to contain only images or no extractable text",
          suggestedAction: "Consider using OCR tools or providing a text-based version of the document"
        });
      }
      const corruptionCheck = this.checkPDFIntegrity(fileBuffer);
      if (!corruptionCheck.isValid) {
        errors.push({
          code: "PDF_CORRUPTED",
          message: "PDF file appears to be corrupted or incomplete",
          severity: "error",
          suggestedAction: "Please try re-saving or re-exporting the PDF document"
        });
      }
    } catch (error) {
      errors.push({
        code: "VALIDATION_ERROR",
        message: `Error during PDF validation: ${error instanceof Error ? error.message : "Unknown error"}`,
        severity: "error",
        suggestedAction: "Please try uploading the document again"
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
  static validatePDFHeader(fileBuffer) {
    if (fileBuffer.length < 8) {
      return { isValid: false };
    }
    const header = fileBuffer.subarray(0, 8).toString("ascii");
    if (!header.startsWith(this.PDF_HEADER)) {
      return { isValid: false };
    }
    const versionMatch = header.match(/%PDF-(\d+\.\d+)/);
    if (versionMatch) {
      return { isValid: true, version: versionMatch[1] };
    }
    return { isValid: true };
  }
  /**
   * Checks if PDF is encrypted by looking for encryption markers
   */
  static checkPDFEncryption(fileBuffer) {
    const content = fileBuffer.toString("binary");
    const encryptionMarkers = [
      "/Encrypt",
      "/Filter/Standard",
      "/Filter/V2",
      "/UserPassword",
      "/OwnerPassword"
    ];
    return encryptionMarkers.some((marker) => content.includes(marker));
  }
  /**
   * Analyzes PDF content to estimate page count and text presence
   */
  static analyzePDFContent(fileBuffer) {
    const content = fileBuffer.toString("binary");
    const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
    const estimatedPageCount = pageMatches ? pageMatches.length : 1;
    const textIndicators = [
      "/Font",
      "BT",
      // Begin text
      "ET",
      // End text
      "Tj",
      // Show text
      "TJ",
      // Show text with individual glyph positioning
      "/Contents"
    ];
    const hasTextContent = textIndicators.some((indicator) => content.includes(indicator));
    return {
      estimatedPageCount: Math.max(1, estimatedPageCount),
      hasTextContent
    };
  }
  /**
   * Performs basic integrity check on PDF structure
   */
  static checkPDFIntegrity(fileBuffer) {
    const content = fileBuffer.toString("binary");
    const requiredElements = [
      "%PDF-",
      // Header
      "trailer",
      // Trailer
      "startxref"
      // Cross-reference table pointer
    ];
    const hasRequiredElements = requiredElements.every((element) => content.includes(element));
    const endsWithEOF = content.endsWith("%%EOF") || content.includes("%%EOF");
    return {
      isValid: hasRequiredElements && endsWithEOF
    };
  }
  /**
   * Creates a user-friendly error message from validation results
   */
  static createErrorMessage(validationResult) {
    if (validationResult.isValid) {
      return "";
    }
    const errorMessages = validationResult.errors.map((error) => error.message);
    const warningMessages = validationResult.warnings.map((warning) => warning.message);
    let message = "PDF validation failed:\n";
    if (errorMessages.length > 0) {
      message += "\nErrors:\n" + errorMessages.map((msg) => `\u2022 ${msg}`).join("\n");
    }
    if (warningMessages.length > 0) {
      message += "\nWarnings:\n" + warningMessages.map((msg) => `\u2022 ${msg}`).join("\n");
    }
    return message;
  }
  /**
   * Gets suggested actions from validation results
   */
  static getSuggestedActions(validationResult) {
    const actions = [];
    validationResult.errors.forEach((error) => {
      if (error.suggestedAction) {
        actions.push(error.suggestedAction);
      }
    });
    validationResult.warnings.forEach((warning) => {
      if (warning.suggestedAction) {
        actions.push(warning.suggestedAction);
      }
    });
    return [...new Set(actions)];
  }
};

// src/services/enhanced-textract.ts
var import_client_textract = require("@aws-sdk/client-textract");
var EnhancedTextractService = class {
  constructor(region) {
    this.defaultRetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1e3,
      maxDelayMs: 3e4,
      backoffMultiplier: 2
    };
    this.textractClient = new import_client_textract.TextractClient({ region });
  }
  /**
   * Extracts text from document with automatic retry logic
   */
  async extractTextWithRetry(params, retryConfig) {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    let lastError = null;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        console.log("Textract extraction attempt", {
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          s3Key: params.s3Key
        });
        const result = await this.extractText(params);
        if (attempt > 0) {
          console.log("Textract extraction succeeded after retry", {
            attempt: attempt + 1,
            s3Key: params.s3Key
          });
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        console.error("Textract extraction failed", {
          attempt: attempt + 1,
          error: lastError.message,
          s3Key: params.s3Key
        });
        if (attempt === config.maxRetries) {
          break;
        }
        if (!this.isRetryableError(lastError)) {
          console.log("Error is not retryable, stopping attempts", {
            error: lastError.message
          });
          break;
        }
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );
        console.log(`Retrying Textract in ${delay}ms...`, {
          attempt: attempt + 1,
          delay
        });
        await this.sleep(delay);
      }
    }
    throw new Error(`Textract failed after ${config.maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`);
  }
  /**
   * Extracts text from document using appropriate Textract method
   */
  async extractText(params) {
    const startTime = Date.now();
    try {
      let response;
      let textBlocks = [];
      let forms = [];
      let tables = [];
      if (params.documentType === "simple") {
        response = await this.textractClient.send(new import_client_textract.DetectDocumentTextCommand({
          Document: {
            S3Object: {
              Bucket: params.s3Bucket,
              Name: params.s3Key
            }
          }
        }));
        textBlocks = response.Blocks || [];
      } else {
        const featureTypes = [];
        if (params.documentType === "forms" || params.documentType === "tables") {
          featureTypes.push("FORMS", "TABLES");
        }
        response = await this.textractClient.send(new import_client_textract.AnalyzeDocumentCommand({
          Document: {
            S3Object: {
              Bucket: params.s3Bucket,
              Name: params.s3Key
            }
          },
          FeatureTypes: featureTypes
        }));
        textBlocks = response.Blocks || [];
        forms = this.extractForms(textBlocks);
        tables = this.extractTables(textBlocks);
      }
      const extractedText = this.extractTextFromBlocks(textBlocks);
      const confidence = this.calculateAverageConfidence(textBlocks);
      const pageCount = this.getPageCount(textBlocks);
      const processingTime = Date.now() - startTime;
      console.log("Textract extraction completed", {
        s3Key: params.s3Key,
        textLength: extractedText.length,
        blockCount: textBlocks.length,
        pageCount,
        confidence,
        processingTime
      });
      return {
        extractedText,
        confidence,
        pageCount,
        processingTime,
        textBlocks,
        forms,
        tables
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error("Textract extraction error", {
        s3Key: params.s3Key,
        error: error instanceof Error ? error.message : "Unknown error",
        processingTime
      });
      throw error;
    }
  }
  /**
   * Determines the appropriate document type based on content analysis
   */
  static determineDocumentType(fileName, contentType) {
    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.includes("form") || lowerFileName.includes("application")) {
      return "forms";
    }
    if (lowerFileName.includes("table") || lowerFileName.includes("data") || lowerFileName.includes("report")) {
      return "tables";
    }
    return "simple";
  }
  /**
   * Determines processing mode based on file size and document complexity
   */
  static determineProcessingMode(fileSizeBytes, documentType) {
    const SYNC_THRESHOLD = 5 * 1024 * 1024;
    const COMPLEX_SYNC_THRESHOLD = 2 * 1024 * 1024;
    const threshold = documentType === "forms" || documentType === "tables" ? COMPLEX_SYNC_THRESHOLD : SYNC_THRESHOLD;
    return fileSizeBytes < threshold ? "sync" : "async";
  }
  /**
   * Determines optimal concurrency level based on document count and sizes
   */
  static determineOptimalConcurrency(documentCount, averageFileSizeBytes) {
    const MAX_CONCURRENT_SYNC = 5;
    const MAX_CONCURRENT_ASYNC = 10;
    if (averageFileSizeBytes < 1024 * 1024) {
      return Math.min(documentCount, MAX_CONCURRENT_SYNC);
    }
    return Math.min(documentCount, MAX_CONCURRENT_ASYNC);
  }
  /**
   * Extracts and orders text from Textract blocks
   */
  extractTextFromBlocks(blocks) {
    const lineBlocks = blocks.filter((block) => block.BlockType === "LINE").sort((a, b) => {
      if (a.Page !== b.Page) {
        return (a.Page || 1) - (b.Page || 1);
      }
      const aTop = a.Geometry?.BoundingBox?.Top || 0;
      const bTop = b.Geometry?.BoundingBox?.Top || 0;
      return aTop - bTop;
    });
    return lineBlocks.map((block) => block.Text || "").filter((text) => text.trim().length > 0).join("\n");
  }
  /**
   * Extracts form data from Textract blocks
   */
  extractForms(blocks) {
    const forms = [];
    const keyValueSets = blocks.filter((block) => block.BlockType === "KEY_VALUE_SET");
    keyValueSets.forEach((kvSet) => {
      if (kvSet.EntityTypes?.includes("KEY")) {
        const key = this.getTextFromRelationships(kvSet, blocks);
        const valueBlock = kvSet.Relationships?.find((rel) => rel.Type === "VALUE");
        if (valueBlock) {
          const value = this.getTextFromRelationships(valueBlock, blocks);
          forms.push({ key, value });
        }
      }
    });
    return forms;
  }
  /**
   * Extracts table data from Textract blocks
   */
  extractTables(blocks) {
    const tables = [];
    const tableBlocks = blocks.filter((block) => block.BlockType === "TABLE");
    tableBlocks.forEach((table) => {
      const rows = [];
      const cellRelationships = table.Relationships?.find((rel) => rel.Type === "CHILD");
      if (cellRelationships) {
        tables.push({ rows });
      }
    });
    return tables;
  }
  /**
   * Gets text from block relationships
   */
  getTextFromRelationships(block, allBlocks) {
    const childRelationship = block.Relationships?.find((rel) => rel.Type === "CHILD");
    if (!childRelationship) return "";
    return childRelationship.Ids.map((id) => allBlocks.find((b) => b.Id === id)).filter((b) => b?.BlockType === "WORD").map((b) => b.Text).join(" ");
  }
  /**
   * Calculates average confidence from blocks
   */
  calculateAverageConfidence(blocks) {
    const confidenceBlocks = blocks.filter((block) => block.Confidence !== void 0);
    if (confidenceBlocks.length === 0) {
      return 0;
    }
    const totalConfidence = confidenceBlocks.reduce((sum, block) => sum + (block.Confidence || 0), 0);
    return totalConfidence / confidenceBlocks.length;
  }
  /**
   * Gets page count from blocks
   */
  getPageCount(blocks) {
    const pages = new Set(blocks.map((block) => block.Page).filter((page) => page !== void 0));
    return Math.max(1, pages.size);
  }
  /**
   * Checks if an error is retryable
   */
  isRetryableError(error) {
    const retryableErrors = [
      "ThrottlingException",
      "InternalServerError",
      "ServiceUnavailableException",
      "ProvisionedThroughputExceededException",
      "RequestTimeoutException",
      "NetworkingError"
    ];
    return retryableErrors.some(
      (retryableError) => error.message.includes(retryableError) || error.name === retryableError
    );
  }
  /**
   * Creates error details from Textract error
   */
  static createErrorDetails(error) {
    let errorType = "textract";
    let suggestedAction = "Please try again later";
    let isRetryable = true;
    if (error.message.includes("InvalidParameterException")) {
      errorType = "validation";
      suggestedAction = "Please check the document format and try again";
      isRetryable = false;
    } else if (error.message.includes("UnsupportedDocumentException")) {
      errorType = "validation";
      suggestedAction = "This document format is not supported. Please try a different format";
      isRetryable = false;
    } else if (error.message.includes("DocumentTooLargeException")) {
      errorType = "validation";
      suggestedAction = "Document is too large. Please reduce the file size and try again";
      isRetryable = false;
    } else if (error.message.includes("ThrottlingException")) {
      errorType = "textract";
      suggestedAction = "Service is busy. The document will be retried automatically";
      isRetryable = true;
    }
    return {
      errorCode: error.name || "TextractError",
      errorMessage: error.message,
      errorType,
      suggestedAction,
      isRetryable
    };
  }
  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

// src/lambda/document-upload.ts
var s3Client = new import_client_s3.S3Client({ region: process.env.REGION });
var dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var handler = async (event) => {
  try {
    console.log("Document Upload Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path
    });
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }
    const tenantId = extractTenantFromToken(event);
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Unauthorized: Missing tenant_id" })
      };
    }
    const request = JSON.parse(event.body || "{}");
    const { customerUUID, fileName, contentType, fileData } = request;
    if (!customerUUID || !fileName || !contentType || !fileData) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Missing required fields: customerUUID, fileName, contentType, fileData"
        })
      };
    }
    const validation = validateFileType(fileName, contentType);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: validation.error })
      };
    }
    const documentId = v4_default();
    const s3Key = `uploads/${tenantId}/${customerUUID}/${documentId}/${fileName}`;
    const fileBuffer = Buffer.from(fileData, "base64");
    let processingMetadata = {
      isEncrypted: false,
      hasTextContent: true,
      processingMode: "sync",
      retryHistory: []
    };
    if (contentType === "application/pdf") {
      console.log("Validating PDF document", { documentId, fileName });
      const pdfValidation = await PDFValidatorService.validatePDF(fileBuffer, fileName);
      if (!pdfValidation.isValid) {
        const errorMessage = PDFValidatorService.createErrorMessage(pdfValidation);
        const suggestedActions = PDFValidatorService.getSuggestedActions(pdfValidation);
        return {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({
            error: "PDF validation failed",
            message: errorMessage,
            suggestedActions,
            validationDetails: pdfValidation
          })
        };
      }
      const documentType = EnhancedTextractService.determineDocumentType(fileName, contentType);
      processingMetadata = {
        pdfVersion: pdfValidation.pdfVersion,
        pageCount: pdfValidation.pageCount,
        isEncrypted: pdfValidation.isEncrypted,
        hasTextContent: pdfValidation.hasTextContent,
        processingMode: EnhancedTextractService.determineProcessingMode(pdfValidation.fileSizeBytes, documentType),
        retryHistory: []
      };
      console.log("PDF validation successful", {
        documentId,
        pdfVersion: pdfValidation.pdfVersion,
        pageCount: pdfValidation.pageCount,
        processingMode: processingMetadata.processingMode
      });
    }
    await s3Client.send(new import_client_s3.PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        customeruuid: customerUUID,
        tenantid: tenantId,
        documentid: documentId,
        originalfilename: fileName,
        processingmode: processingMetadata.processingMode
      }
    }));
    let extractedText;
    let textLength;
    let processingStatus = "queued";
    const processingStartedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (isTextDocument(contentType)) {
      try {
        console.log("Processing text document directly", { documentId });
        extractedText = fileBuffer.toString("utf-8");
        textLength = extractedText.length;
        processingStatus = "completed";
        processingMetadata.processingMode = "sync";
        console.log("Text document processed successfully", {
          documentId,
          textLength
        });
      } catch (error) {
        console.error("Error processing text document:", error);
        processingStatus = "queued";
        processingMetadata.errorDetails = {
          errorCode: "TEXT_PROCESSING_ERROR",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          errorType: "processing",
          suggestedAction: "Document will be retried automatically",
          isRetryable: true
        };
      }
    } else if (requiresTextract(contentType)) {
      processingStatus = "queued";
      console.log("Non-text document queued for processing", {
        documentId,
        contentType,
        processingMode: processingMetadata.processingMode
      });
    }
    const documentRecord = {
      documentId,
      customerUuid: customerUUID,
      tenantId,
      fileName,
      s3Key,
      contentType,
      processingStatus,
      extractedText,
      textLength,
      processingMetadata,
      retryCount: 0,
      maxRetries: 3,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      processingStartedAt: processingStatus === "completed" ? processingStartedAt : void 0,
      processingCompletedAt: processingStatus === "completed" ? (/* @__PURE__ */ new Date()).toISOString() : void 0
    };
    await dynamoClient.send(new import_lib_dynamodb.PutCommand({
      TableName: DOCUMENTS_TABLE,
      Item: documentRecord
    }));
    const response = {
      documentId,
      s3Key,
      processingStatus,
      message: processingStatus === "completed" ? "Document uploaded and processed successfully" : "Document uploaded successfully and queued for processing"
    };
    console.log("Document uploaded successfully", {
      documentId,
      s3Key,
      tenantId,
      customerUUID
    });
    return {
      statusCode: 201,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error("Error in document upload:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error"
      })
    };
  }
};
function extractTenantFromToken(event) {
  const tenantIdHeader = event.headers["x-tenant-id"] || event.headers["X-Tenant-Id"];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }
  return "local-dev-tenant";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
