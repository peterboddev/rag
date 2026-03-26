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

// src/lambda/chunking-cleanup-status.ts
var chunking_cleanup_status_exports = {};
__export(chunking_cleanup_status_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(chunking_cleanup_status_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
var CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME;
var handler = async (event) => {
  try {
    console.log("Get Chunking Cleanup Status Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters
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
    const customerUUID = event.pathParameters?.customerUUID;
    const jobId = event.pathParameters?.jobId;
    if (!customerUUID || !jobId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Missing customerUUID or jobId in path" })
      };
    }
    const result = await dynamoClient.send(new import_lib_dynamodb.GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: {
        uuid: customerUUID,
        tenantId
      }
    }));
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Customer not found" })
      };
    }
    const customer = result.Item;
    const response = {
      jobId,
      status: customer.chunkingCleanupStatus === "none" ? "pending" : customer.chunkingCleanupStatus || "pending",
      progress: customer.chunkingCleanupStatus === "completed" ? 100 : customer.chunkingCleanupStatus === "in_progress" ? 50 : 0,
      embeddingsRemoved: 0,
      // This would need to be tracked separately for detailed reporting
      embeddingsToRemove: 0,
      // This would need to be calculated
      documentsReprocessed: 0,
      // This would need to be tracked separately
      errors: [],
      startedAt: customer.lastChunkingUpdate || (/* @__PURE__ */ new Date()).toISOString(),
      completedAt: customer.chunkingCleanupStatus === "completed" ? customer.lastCleanupAt : void 0
    };
    console.log("Successfully retrieved cleanup status", {
      customerUUID,
      jobId,
      status: response.status,
      progress: response.progress
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
    console.error("Error in get chunking cleanup status:", error);
    const statusCode = error instanceof Error && error.message.includes("not found") ? 404 : 500;
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: statusCode === 404 ? "Customer or job not found" : "Internal server error",
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
