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

// src/lambda/claim-loader.ts
var claim_loader_exports = {};
__export(claim_loader_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_loader_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_client_cloudwatch = require("@aws-sdk/client-cloudwatch");

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

// src/lambda/claim-loader.ts
var s3Client = new import_client_s3.S3Client({
  region: process.env.REGION,
  maxAttempts: 3
  // Enable automatic retries for S3 operations
});
var dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({
  region: process.env.REGION,
  maxAttempts: 3
  // Enable automatic retries for DynamoDB operations
}));
var cloudWatchClient = null;
function getCloudWatchClient() {
  if (!cloudWatchClient) {
    cloudWatchClient = new import_client_cloudwatch.CloudWatchClient({ region: process.env.REGION });
  }
  return cloudWatchClient;
}
var DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1e3,
  // 1 second
  maxDelay: 1e4,
  // 10 seconds
  backoffMultiplier: 2
};
function logStructured(level, message, metadata = {}) {
  const logEntry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    message,
    service: "claim-loader",
    ...metadata
  };
  console.log(JSON.stringify(logEntry));
}
function serializeError(error) {
  if (error === null || error === void 0) {
    return error;
  }
  if (!(error instanceof Error)) {
    return error;
  }
  const serialized = {
    message: error.message,
    name: error.name,
    stack: error.stack
  };
  if ("code" in error && error.code !== void 0) {
    serialized.code = error.code;
  }
  if ("statusCode" in error && error.statusCode !== void 0) {
    serialized.statusCode = error.statusCode;
  }
  if ("requestId" in error && error.requestId !== void 0) {
    serialized.requestId = error.requestId;
  }
  if ("retryable" in error && error.retryable !== void 0) {
    serialized.retryable = error.retryable;
  }
  try {
    for (const key in error) {
      if (error.hasOwnProperty(key) && !(key in serialized)) {
        const value = error[key];
        if (typeof value !== "object" || value === null) {
          serialized[key] = value;
        }
      }
    }
  } catch (e) {
    serialized._serializationError = "Failed to enumerate all properties";
  }
  return serialized;
}
async function publishMetric(metricName, value, unit = import_client_cloudwatch.StandardUnit.Count, dimensions = {}) {
  try {
    const client = getCloudWatchClient();
    await client.send(new import_client_cloudwatch.PutMetricDataCommand({
      Namespace: "InsuranceClaimPortal",
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: /* @__PURE__ */ new Date(),
          Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
        }
      ]
    }));
  } catch (error) {
    console.error("Failed to publish metric:", error);
  }
}
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
var SOURCE_BUCKET = process.env.SOURCE_BUCKET || "medical-claims-synthetic-data-dev";
var PLATFORM_BUCKET = process.env.DOCUMENTS_BUCKET || "rag-app-v2-documents-dev";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRetryableError(error) {
  const retryableErrors = [
    "NetworkingError",
    "TimeoutError",
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailable",
    "InternalServerError",
    "RequestTimeout",
    "SlowDown"
  ];
  const errorName = error.name || error.code || "";
  const errorMessage = error.message || "";
  return retryableErrors.some(
    (retryable) => errorName.includes(retryable) || errorMessage.includes(retryable)
  );
}
async function withRetry(operation, config = DEFAULT_RETRY_CONFIG, operationName = "operation") {
  let lastError;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        console.error(`Non-retryable error in ${operationName}:`, serializeError(error));
        throw error;
      }
      if (attempt === config.maxRetries - 1) {
        console.error(`Max retries reached for ${operationName}:`, serializeError(error));
        throw error;
      }
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelay
      );
      console.log(`Retrying ${operationName} after ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`);
      await sleep(delay);
    }
  }
  throw lastError;
}
var handler = async (event) => {
  const startTime = Date.now();
  try {
    logStructured("INFO", "Claim Loader Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path
    });
    await publishMetric("LambdaInvocations", 1, import_client_cloudwatch.StandardUnit.Count, { FunctionName: "claim-loader" });
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
      await publishMetric("AuthenticationErrors", 1, import_client_cloudwatch.StandardUnit.Count, { FunctionName: "claim-loader" });
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
    const { patientId, claimId, customerUUID } = request;
    if (!patientId || !claimId || !customerUUID) {
      await publishMetric("ValidationErrors", 1, import_client_cloudwatch.StandardUnit.Count, { FunctionName: "claim-loader" });
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Missing required fields: patientId, claimId, customerUUID"
        })
      };
    }
    logStructured("INFO", "Loading claim documents", { patientId, claimId, customerUUID, tenantId });
    const patientMapping = await loadPatientMapping(patientId);
    const jobId = v4_default();
    const claimDocuments = await listClaimDocuments(patientId);
    const totalDocuments = claimDocuments.length;
    logStructured("INFO", "Found claim documents", { patientId, claimId, totalDocuments });
    await publishMetric("ClaimDocumentsFound", totalDocuments, import_client_cloudwatch.StandardUnit.Count, {
      FunctionName: "claim-loader",
      PatientId: patientId
    });
    const batchSize = 10;
    let documentsProcessed = 0;
    const errors = [];
    for (let i = 0; i < claimDocuments.length; i += batchSize) {
      const batch = claimDocuments.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((doc) => processDocument(doc, patientId, claimId, customerUUID, tenantId, patientMapping))
      );
      batchResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          documentsProcessed++;
        } else {
          const docKey = batch[index];
          errors.push(`Failed to process ${docKey}: ${result.reason}`);
          logStructured("ERROR", "Document processing failed", { docKey, error: serializeError(result.reason) });
        }
      });
      logStructured("INFO", "Batch processed", {
        batchNumber: Math.floor(i / batchSize) + 1,
        documentsProcessed,
        totalDocuments
      });
    }
    await publishMetric("DocumentsProcessedSuccessfully", documentsProcessed, import_client_cloudwatch.StandardUnit.Count, {
      FunctionName: "claim-loader"
    });
    if (errors.length > 0) {
      await publishMetric("DocumentProcessingErrors", errors.length, import_client_cloudwatch.StandardUnit.Count, {
        FunctionName: "claim-loader"
      });
    }
    const duration = Date.now() - startTime;
    await publishMetric("LambdaDuration", duration, import_client_cloudwatch.StandardUnit.Milliseconds, {
      FunctionName: "claim-loader"
    });
    const response = {
      jobId,
      status: errors.length === 0 ? "completed" : "completed_with_errors",
      documentsProcessed,
      totalDocuments,
      message: errors.length === 0 ? `Successfully loaded ${documentsProcessed} documents` : `Loaded ${documentsProcessed} of ${totalDocuments} documents. ${errors.length} errors occurred.`
    };
    logStructured("INFO", "Claim loading completed", {
      jobId,
      documentsProcessed,
      totalDocuments,
      errorCount: errors.length,
      duration
    });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logStructured("ERROR", "Error in claim loader", {
      error: serializeError(error),
      duration
    });
    await publishMetric("LambdaErrors", 1, import_client_cloudwatch.StandardUnit.Count, { FunctionName: "claim-loader" });
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
async function loadPatientMapping(patientId) {
  return withRetry(async () => {
    console.log("Loading patient mapping", { patientId });
    const response = await s3Client.send(new import_client_s3.GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: "mapping.json"
    }));
    const mappingData = await response.Body?.transformToString();
    if (!mappingData) {
      throw new Error("Failed to read mapping.json");
    }
    const mapping = JSON.parse(mappingData);
    const patientMappings = mapping.patient_mappings || mapping.patients || [];
    const patientEntry = patientMappings.find(
      (p) => p.tcia_id === patientId || p.tciaId === patientId
    );
    if (!patientEntry) {
      console.warn("Patient not found in mapping, using default", { patientId });
      return {
        syntheaId: "unknown",
        tciaId: patientId,
        patientName: `Patient ${patientId}`,
        tciaCollectionId: "unknown"
      };
    }
    return {
      syntheaId: patientEntry.synthea_id || patientEntry.syntheaId || "unknown",
      tciaId: patientEntry.tcia_id || patientEntry.tciaId,
      patientName: patientEntry.patient_name || patientEntry.patientName || `Patient ${patientId}`,
      tciaCollectionId: patientEntry.tcia_id || patientEntry.tciaCollectionId || "unknown"
    };
  }, DEFAULT_RETRY_CONFIG, "loadPatientMapping").catch((error) => {
    console.error("Error loading patient mapping after retries:", serializeError(error));
    return {
      syntheaId: "unknown",
      tciaId: patientId,
      patientName: `Patient ${patientId}`,
      tciaCollectionId: "unknown"
    };
  });
}
async function listClaimDocuments(patientId) {
  try {
    const documents = [];
    const claimsPrefix = `patients/${patientId}/claims/`;
    let continuationToken;
    do {
      const response = await s3Client.send(new import_client_s3.ListObjectsV2Command({
        Bucket: SOURCE_BUCKET,
        Prefix: claimsPrefix,
        ContinuationToken: continuationToken
      }));
      if (response.Contents) {
        const files = response.Contents.filter((obj) => obj.Key && (obj.Key.endsWith(".pdf") || obj.Key.endsWith(".txt"))).map((obj) => obj.Key);
        documents.push(...files);
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    const clinicalNotesPrefix = `patients/${patientId}/clinical-notes/`;
    continuationToken = void 0;
    do {
      const clinicalResponse = await s3Client.send(new import_client_s3.ListObjectsV2Command({
        Bucket: SOURCE_BUCKET,
        Prefix: clinicalNotesPrefix,
        ContinuationToken: continuationToken
      }));
      if (clinicalResponse.Contents) {
        const files = clinicalResponse.Contents.filter((obj) => obj.Key && (obj.Key.endsWith(".pdf") || obj.Key.endsWith(".txt"))).map((obj) => obj.Key);
        documents.push(...files);
      }
      continuationToken = clinicalResponse.NextContinuationToken;
    } while (continuationToken);
    console.log("Listed claim documents", { patientId, documentCount: documents.length });
    return documents;
  } catch (error) {
    console.error("Error listing claim documents:", error);
    throw error;
  }
}
async function processDocument(sourceKey, patientId, claimId, customerUUID, tenantId, patientMapping) {
  return withRetry(async () => {
    console.log("Processing document", { sourceKey, patientId, claimId });
    const fileName = sourceKey.split("/").pop();
    const documentType = determineDocumentType(fileName);
    const contentType = fileName.endsWith(".pdf") ? "application/pdf" : "text/plain";
    const documentId = v4_default();
    const destKey = `uploads/${tenantId}/${customerUUID}/${documentId}/${fileName}`;
    await s3Client.send(new import_client_s3.CopyObjectCommand({
      Bucket: PLATFORM_BUCKET,
      CopySource: `${SOURCE_BUCKET}/${sourceKey}`,
      Key: destKey,
      ContentType: contentType,
      MetadataDirective: "REPLACE",
      Metadata: {
        customeruuid: customerUUID,
        tenantid: tenantId,
        documentid: documentId,
        originalfilename: fileName,
        processingmode: "sync",
        sourcebucket: SOURCE_BUCKET,
        sourcekey: sourceKey
      }
    }));
    console.log("Document copied to platform bucket", { sourceKey, destKey, documentId });
    const metadataSidecar = {
      metadataAttributes: {
        claimId,
        patientId,
        patientName: patientMapping.patientName,
        documentType: determineDocumentType(fileName)
      }
    };
    await s3Client.send(new import_client_s3.PutObjectCommand({
      Bucket: PLATFORM_BUCKET,
      Key: `${destKey}.metadata.json`,
      Body: JSON.stringify(metadataSidecar),
      ContentType: "application/json"
    }));
    console.log("Metadata sidecar written", { key: `${destKey}.metadata.json`, claimId, patientId });
    const claimMetadata = {
      patientId,
      patientName: patientMapping.patientName,
      tciaCollectionId: patientMapping.tciaCollectionId,
      claimId,
      documentType
    };
    const processingMetadata = {
      isEncrypted: false,
      hasTextContent: true,
      processingMode: "sync",
      retryHistory: []
    };
    const documentRecord = {
      documentId,
      customerUuid: customerUUID,
      tenantId,
      fileName,
      s3Key: destKey,
      contentType,
      processingStatus: "queued",
      processingMetadata,
      claimMetadata,
      retryCount: 0,
      maxRetries: 3,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await dynamoClient.send(new import_lib_dynamodb.PutCommand({
      TableName: DOCUMENTS_TABLE,
      Item: documentRecord
    }));
    console.log("Document record created", { documentId, fileName, documentType });
  }, DEFAULT_RETRY_CONFIG, `processDocument-${sourceKey}`);
}
function determineDocumentType(fileName) {
  const lowerFileName = fileName.toLowerCase();
  if (lowerFileName.includes("cms1500") || lowerFileName.includes("cms_1500")) {
    return "CMS1500";
  } else if (lowerFileName.includes("eob")) {
    return "EOB";
  } else if (lowerFileName.includes("radiology") || lowerFileName.includes("report")) {
    return "Radiology Report";
  } else if (lowerFileName.includes("clinical") || lowerFileName.includes("note")) {
    return "Clinical Note";
  }
  return "Clinical Note";
}
function extractTenantFromToken(event) {
  const headers = event.headers || {};
  const tenantIdHeader = headers["x-tenant-id"] || headers["X-Tenant-Id"];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }
  return "local-dev-tenant";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
