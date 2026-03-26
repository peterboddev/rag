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

// src/lambda/document-retrieval.ts
var document_retrieval_exports = {};
__export(document_retrieval_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(document_retrieval_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_s3_request_presigner = require("@aws-sdk/s3-request-presigner");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var s3Client = new import_client_s3.S3Client({ region: process.env.REGION });
var dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var PRESIGNED_URL_EXPIRATION = 3600;
function logStructured(level, message, metadata = {}) {
  const logEntry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    message,
    service: "document-retrieval",
    ...metadata
  };
  console.log(JSON.stringify(logEntry));
}
var handler = async (event) => {
  try {
    logStructured("INFO", "Document Retrieval Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path
    });
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }
    const documentId = event.pathParameters?.documentId;
    if (!documentId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Missing documentId parameter" })
      };
    }
    logStructured("INFO", "Retrieving document", { documentId });
    const documentRecord = await dynamoClient.send(new import_lib_dynamodb.GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: { documentId }
    }));
    if (!documentRecord.Item) {
      logStructured("WARN", "Document not found", { documentId });
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Document not found" })
      };
    }
    const { s3Key, contentType, fileName } = documentRecord.Item;
    const command = new import_client_s3.GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key
    });
    const presignedUrl = await (0, import_s3_request_presigner.getSignedUrl)(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION
    });
    logStructured("INFO", "Generated presigned URL", {
      documentId,
      fileName,
      expiresIn: PRESIGNED_URL_EXPIRATION
    });
    const response = {
      documentUrl: presignedUrl,
      contentType: contentType || "application/octet-stream",
      fileName: fileName || "document"
    };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    logStructured("ERROR", "Error in document retrieval", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : void 0
    });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
