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

// src/lambda/claim-status.ts
var claim_status_exports = {};
__export(claim_status_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_status_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION || "us-east-1" });
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var DOCUMENTS_TABLE_NAME = process.env.DOCUMENTS_TABLE_NAME || "rag-app-v2-documents-dev";
var handler = async (event) => {
  console.log("Claim Status Request:", JSON.stringify(event, null, 2));
  try {
    const claimId = event.pathParameters?.claimId;
    if (!claimId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Missing claimId",
          message: "Claim ID is required in the path"
        })
      };
    }
    const headers = event.headers || {};
    const tenantId = headers["x-tenant-id"] || headers["X-Tenant-Id"] || "local-dev-tenant";
    const documents = await queryClaimDocuments(claimId, tenantId);
    if (documents.length === 0) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          claimId,
          status: "not_loaded",
          documentsProcessed: 0,
          totalDocuments: 0,
          documents: []
        })
      };
    }
    const totalDocuments = documents.length;
    const completedDocuments = documents.filter((d) => d.processingStatus === "completed").length;
    const failedDocuments = documents.filter((d) => d.processingStatus === "failed").length;
    const processingDocuments = documents.filter(
      (d) => d.processingStatus === "processing" || d.processingStatus === "queued"
    ).length;
    let overallStatus;
    if (failedDocuments === totalDocuments) {
      overallStatus = "failed";
    } else if (completedDocuments === totalDocuments) {
      overallStatus = "completed";
    } else if (processingDocuments > 0) {
      overallStatus = "processing";
    } else {
      overallStatus = "loading";
    }
    const claimStatus = {
      claimId,
      status: overallStatus,
      documentsProcessed: completedDocuments,
      totalDocuments,
      documents: documents.map((doc) => ({
        documentId: doc.documentId,
        fileName: doc.fileName,
        processingStatus: doc.processingStatus,
        documentType: doc.claimMetadata?.documentType,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
      }))
    };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(claimStatus)
    };
  } catch (error) {
    console.error("Error retrieving claim status:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error occurred"
      })
    };
  }
};
async function queryClaimDocuments(claimId, tenantId) {
  try {
    const command = new import_lib_dynamodb.QueryCommand({
      TableName: DOCUMENTS_TABLE_NAME,
      IndexName: "tenant-documents-index",
      // Use existing GSI
      KeyConditionExpression: "tenantId = :tenantId",
      FilterExpression: "claimMetadata.claimId = :claimId",
      ExpressionAttributeValues: {
        ":tenantId": tenantId,
        ":claimId": claimId
      }
    });
    const response = await docClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error("Error querying claim documents:", error);
    try {
      const scanCommand = new import_lib_dynamodb.QueryCommand({
        TableName: DOCUMENTS_TABLE_NAME,
        IndexName: "tenant-documents-index",
        KeyConditionExpression: "tenantId = :tenantId",
        ExpressionAttributeValues: {
          ":tenantId": tenantId
        }
      });
      const scanResponse = await docClient.send(scanCommand);
      const allDocs = scanResponse.Items || [];
      return allDocs.filter(
        (doc) => doc.claimMetadata && doc.claimMetadata.claimId === claimId
      );
    } catch (fallbackError) {
      console.error("Fallback query also failed:", fallbackError);
      throw new Error("Failed to query claim documents");
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
