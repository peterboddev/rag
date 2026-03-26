"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lambda/chunk-visualization-get.ts
var chunk_visualization_get_exports = {};
__export(chunk_visualization_get_exports, {
  handler: () => handler,
  optionsHandler: () => optionsHandler
});
module.exports = __toCommonJS(chunk_visualization_get_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var handler = async (event) => {
  const startTime = Date.now();
  console.log("Chunk visualization request received", {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    requestId: event.requestContext.requestId
  });
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
        },
        body: JSON.stringify({
          error: "Method not allowed. Use POST.",
          allowedMethods: ["POST"]
        })
      };
    }
    const tenantId = event.headers["X-Tenant-Id"] || event.headers["x-tenant-id"];
    if (!tenantId) {
      console.error("Missing tenant ID in request headers");
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
        },
        body: JSON.stringify({
          error: "Missing X-Tenant-Id header",
          details: "Tenant ID is required for multi-tenant access control"
        })
      };
    }
    let requestBody;
    try {
      if (!event.body) {
        throw new Error("Request body is required");
      }
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error("Invalid JSON in request body:", parseError);
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
        },
        body: JSON.stringify({
          error: "Invalid JSON in request body",
          details: parseError instanceof Error ? parseError.message : "Unknown parsing error"
        })
      };
    }
    const validationErrors = [];
    if (!requestBody.customerUUID || typeof requestBody.customerUUID !== "string") {
      validationErrors.push("customerUUID is required and must be a string");
    }
    if (!requestBody.documentIds || !Array.isArray(requestBody.documentIds)) {
      validationErrors.push("documentIds is required and must be an array");
    } else if (requestBody.documentIds.length === 0) {
      validationErrors.push("At least one document ID must be provided");
    } else if (requestBody.documentIds.length > 50) {
      validationErrors.push("Maximum 50 documents can be processed at once");
    }
    if (requestBody.documentIds && Array.isArray(requestBody.documentIds)) {
      requestBody.documentIds.forEach((docId, index) => {
        if (!docId || typeof docId !== "string" || docId.trim().length === 0) {
          validationErrors.push(`Document ID at index ${index} is invalid`);
        }
      });
    }
    if (requestBody.chunkingMethod) {
      if (!requestBody.chunkingMethod.id || !requestBody.chunkingMethod.name) {
        validationErrors.push("Chunking method must have id and name fields");
      }
      if (!requestBody.chunkingMethod.parameters || !requestBody.chunkingMethod.parameters.strategy) {
        validationErrors.push("Chunking method must have parameters with strategy field");
      }
    }
    if (validationErrors.length > 0) {
      console.error("Request validation failed:", validationErrors);
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
        },
        body: JSON.stringify({
          error: "Request validation failed",
          details: validationErrors
        })
      };
    }
    console.log("Processing chunk visualization request", {
      customerUUID: requestBody.customerUUID,
      documentCount: requestBody.documentIds.length,
      chunkingMethod: requestBody.chunkingMethod?.id || "default",
      tenantId
    });
    const dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
    const documentsTable = process.env.DOCUMENTS_TABLE_NAME;
    const result = await generateChunksForVisualization(
      dynamoClient,
      documentsTable,
      requestBody.documentIds,
      requestBody.customerUUID,
      tenantId,
      requestBody.chunkingMethod
    );
    const criticalErrors = result.errors.filter((error) => !error.isRetryable);
    if (criticalErrors.length > 0 && result.chunks.length === 0) {
      console.error("Critical errors in chunk generation:", criticalErrors);
      return {
        statusCode: 422,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
        },
        body: JSON.stringify({
          error: "Failed to generate chunks",
          details: criticalErrors.map((err) => ({
            documentId: err.documentId,
            fileName: err.fileName,
            message: err.errorMessage,
            type: err.errorType
          })),
          retryableErrors: result.errors.filter((error) => error.isRetryable).length,
          totalErrors: result.errors.length
        })
      };
    }
    const response = {
      chunks: result.chunks.map((chunk) => ({
        id: chunk.id || "mock-chunk-1",
        text: chunk.text || "Mock chunk text for CORS testing",
        tokenCount: chunk.tokenCount || 10,
        characterCount: chunk.characterCount || 50,
        metadata: {
          chunkIndex: chunk.metadata?.chunkIndex || 0,
          totalChunks: chunk.metadata?.totalChunks || 1,
          chunkingMethod: chunk.metadata?.chunkingMethod || "default",
          overlapStart: chunk.metadata?.overlapStart,
          overlapEnd: chunk.metadata?.overlapEnd,
          confidence: chunk.metadata?.confidence,
          semanticBoundary: chunk.metadata?.semanticBoundary
        },
        sourceDocument: {
          documentId: chunk.sourceDocument?.documentId || "",
          fileName: chunk.sourceDocument?.fileName || "",
          pageNumber: chunk.sourceDocument?.pageNumber,
          sectionTitle: chunk.sourceDocument?.sectionTitle
        }
      })),
      totalChunks: result.totalChunks,
      chunkingMethod: requestBody.chunkingMethod || {
        id: "default",
        name: "Default Chunking",
        description: "Default chunking strategy",
        parameters: { strategy: "default" }
      },
      processingTime: result.processingTime,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (result.errors && result.errors.length > 0) {
      response.errors = result.errors.map((error) => ({
        documentId: error.documentId,
        fileName: error.fileName,
        errorMessage: error.errorMessage,
        errorType: error.errorType,
        isRetryable: error.isRetryable
      }));
    }
    if (result.warnings && result.warnings.length > 0) {
      response.warnings = result.warnings;
    }
    const totalTime = Date.now() - startTime;
    console.log("Chunk visualization completed successfully", {
      totalChunks: result.totalChunks,
      processingTime: result.processingTime,
      totalTime,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      requestId: event.requestContext.requestId
    });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key",
        "Access-Control-Max-Age": "86400"
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error("Unexpected error in chunk visualization handler:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key"
      },
      body: JSON.stringify({
        error: "Internal server error",
        message: "An unexpected error occurred while generating chunks",
        details: error instanceof Error ? error.message : "Unknown error",
        requestId: event.requestContext.requestId,
        processingTime: totalTime
      })
    };
  }
};
var optionsHandler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key",
      "Access-Control-Max-Age": "86400"
    },
    body: ""
  };
};
async function generateChunksForVisualization(dynamoClient, documentsTable, documentIds, customerUUID, tenantId, chunkingMethod) {
  const startTime = Date.now();
  const chunks = [];
  const errors = [];
  const warnings = [];
  try {
    console.log("Generating chunks for visualization", {
      documentIds: documentIds.length,
      customerUUID,
      chunkingMethod: chunkingMethod?.id || "default"
    });
    const maxConcurrentDocs = 3;
    const documentBatches = [];
    for (let i = 0; i < documentIds.length; i += maxConcurrentDocs) {
      documentBatches.push(documentIds.slice(i, i + maxConcurrentDocs));
    }
    let globalChunkIndex = 0;
    for (const batch of documentBatches) {
      const batchPromises = batch.map(async (documentId) => {
        try {
          const result = await dynamoClient.send(new import_lib_dynamodb.QueryCommand({
            TableName: documentsTable,
            KeyConditionExpression: "id = :documentId",
            ExpressionAttributeValues: {
              ":documentId": documentId
            }
          }));
          if (result.Items && result.Items.length > 0) {
            const document = result.Items[0];
            if (document.customerUuid === customerUUID && document.tenantId === tenantId && document.processingStatus === "completed" && document.extractedText) {
              const textLength = document.extractedText.length;
              if (textLength > 1e6) {
                warnings.push(`Document ${document.fileName} is very large (${Math.round(textLength / 1e3)}KB) and may take longer to process`);
              }
              const documentChunks = await generateDocumentChunks(document, chunkingMethod, globalChunkIndex);
              return documentChunks;
            } else {
              errors.push({
                documentId,
                fileName: document.fileName || "Unknown",
                errorMessage: "Document not accessible or not processed",
                errorType: "access_denied",
                isRetryable: false,
                timestamp: (/* @__PURE__ */ new Date()).toISOString()
              });
              return [];
            }
          } else {
            errors.push({
              documentId,
              fileName: "Unknown",
              errorMessage: "Document not found",
              errorType: "validation",
              isRetryable: false,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            });
            return [];
          }
        } catch (error) {
          console.error(`Error processing document ${documentId}:`, error);
          errors.push({
            documentId,
            fileName: "Unknown",
            errorMessage: error instanceof Error ? error.message : "Unknown error",
            errorType: "processing",
            isRetryable: true,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return [];
        }
      });
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((documentChunks) => {
        chunks.push(...documentChunks);
        globalChunkIndex += documentChunks.length;
      });
      if (global.gc) {
        global.gc();
      }
    }
    const processingTime = Date.now() - startTime;
    const totalChunks = chunks.length;
    chunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index + 1;
      chunk.metadata.totalChunks = totalChunks;
    });
    if (totalChunks >= 1500) {
      warnings.push(`Generated ${totalChunks} chunks. Consider using fewer documents or smaller chunk sizes for better performance.`);
    }
    return {
      chunks,
      totalChunks,
      processingTime,
      errors,
      warnings
    };
  } catch (error) {
    console.error("Error in chunk visualization service:", error);
    return {
      chunks: [],
      totalChunks: 0,
      processingTime: Date.now() - startTime,
      errors: [{
        documentId: "all",
        fileName: "Multiple",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorType: "processing",
        isRetryable: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }],
      warnings: []
    };
  }
}
async function generateDocumentChunks(document, chunkingMethod, startingChunkIndex = 0) {
  const chunks = [];
  const text = document.extractedText || "";
  if (!text.trim()) {
    return chunks;
  }
  const method = chunkingMethod || {
    id: "fixed_size_512",
    name: "Fixed Size (512 tokens)",
    description: "Default chunking for visualization",
    parameters: { strategy: "fixed_size", chunkSize: 512, chunkOverlap: 50 }
  };
  const chunkSize = method.parameters.chunkSize || 512;
  const overlap = method.parameters.chunkOverlap || 50;
  const chunkSizeChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const maxChunksPerDoc = 250;
  let startIndex = 0;
  let localChunkIndex = 0;
  while (startIndex < text.length && localChunkIndex < maxChunksPerDoc) {
    const endIndex = Math.min(startIndex + chunkSizeChars, text.length);
    const chunkText = text.substring(startIndex, endIndex);
    if (chunkText.trim()) {
      chunks.push({
        id: `${document.documentId}-chunk-${localChunkIndex}`,
        text: chunkText,
        metadata: {
          chunkIndex: startingChunkIndex + localChunkIndex,
          // Will be updated later with correct global index
          totalChunks: 0,
          // Will be updated later with correct total
          chunkingMethod: method.id,
          overlapStart: localChunkIndex > 0 ? overlap : 0,
          overlapEnd: endIndex < text.length ? overlap : 0,
          confidence: 1,
          semanticBoundary: false
        },
        tokenCount: Math.ceil(chunkText.length / 4),
        characterCount: chunkText.length,
        sourceDocument: {
          documentId: document.documentId,
          fileName: document.fileName || "Unknown",
          pageNumber: 1
        }
      });
    }
    const nextStart = endIndex - overlapChars;
    if (nextStart <= startIndex) {
      startIndex = endIndex;
    } else {
      startIndex = nextStart;
    }
    localChunkIndex++;
    if (startIndex >= text.length) {
      break;
    }
  }
  console.log(`Generated ${chunks.length} chunks for document ${document.fileName}`);
  return chunks;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  optionsHandler
});
