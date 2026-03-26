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

// src/lambda/document-delete.ts
var document_delete_exports = {};
__export(document_delete_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(document_delete_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var s3Client = new import_client_s3.S3Client({ region: process.env.REGION });
var dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
var DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET;
var PLATFORM_DOCUMENTS_BUCKET = process.env.PLATFORM_DOCUMENTS_BUCKET;
var handler = async (event) => {
  try {
    console.log("Document Delete Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path
    });
    if (event.httpMethod !== "DELETE") {
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
    const { documentId, customerUUID } = JSON.parse(event.body || "{}");
    if (!documentId || !customerUUID) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Missing required fields: documentId, customerUUID"
        })
      };
    }
    const getResponse = await dynamoClient.send(new import_lib_dynamodb.GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        documentId
      }
    }));
    if (!getResponse.Item) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Document not found" })
      };
    }
    const document = getResponse.Item;
    if (document.tenantId !== tenantId) {
      return {
        statusCode: 403,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Access denied" })
      };
    }
    console.log("Deleting document", {
      documentId,
      customerUUID,
      fileName: document.fileName,
      s3Key: document.s3Key
    });
    try {
      await s3Client.send(new import_client_s3.DeleteObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: document.s3Key
      }));
      console.log("Deleted original document from S3", { s3Key: document.s3Key });
    } catch (s3Error) {
      console.warn("Failed to delete original document from S3 (may not exist)", {
        s3Key: document.s3Key,
        error: s3Error instanceof Error ? s3Error.message : "Unknown error"
      });
    }
    const platformKey = `processed/${tenantId}/${customerUUID}/${documentId}.txt`;
    try {
      await s3Client.send(new import_client_s3.DeleteObjectCommand({
        Bucket: PLATFORM_DOCUMENTS_BUCKET,
        Key: platformKey
      }));
      console.log("Deleted processed document from platform bucket", { platformKey });
    } catch (s3Error) {
      console.warn("Failed to delete processed document from platform bucket (may not exist)", {
        platformKey,
        error: s3Error instanceof Error ? s3Error.message : "Unknown error"
      });
    }
    await dynamoClient.send(new import_lib_dynamodb.DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        documentId
      }
    }));
    console.log("Document deleted successfully", {
      documentId,
      fileName: document.fileName
    });
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        message: "Document deleted successfully",
        documentId,
        fileName: document.fileName
      })
    };
  } catch (error) {
    console.error("Error deleting document:", error);
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
