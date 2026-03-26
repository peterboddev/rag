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

// src/lambda/claim-status-history.ts
var claim_status_history_exports = {};
__export(claim_status_history_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_status_history_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION || "us-east-1" });
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var STATUS_HISTORY_TABLE = process.env.STATUS_HISTORY_TABLE || "rag-app-claim-status-history-dev";
var CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};
var handler = async (event) => {
  console.log("Claim Status History Request:", JSON.stringify({ method: event.httpMethod, path: event.path }));
  const claimId = event.pathParameters?.claimId;
  if (!claimId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing claimId" }) };
  }
  try {
    if (event.httpMethod === "GET") {
      return await getHistory(claimId);
    } else if (event.httpMethod === "POST") {
      return await addStatusEntry(claimId, event);
    }
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (error) {
    console.error("Error in claim-status-history:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" })
    };
  }
};
async function getHistory(claimId) {
  const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
    TableName: STATUS_HISTORY_TABLE,
    KeyConditionExpression: "claimId = :cid",
    ExpressionAttributeValues: { ":cid": claimId },
    ScanIndexForward: true
    // oldest first
  }));
  const history = (result.Items || []).map((item) => ({
    claimId: item.claimId,
    timestamp: item.timestamp,
    status: item.status,
    changedBy: item.changedBy,
    note: item.note
  }));
  const currentStatus = history.length > 0 ? history[history.length - 1].status : "Submitted";
  const response = { claimId, currentStatus, history };
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
}
async function addStatusEntry(claimId, event) {
  const body = JSON.parse(event.body || "{}");
  const { status, note, changedBy } = body;
  if (!status) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing status field" }) };
  }
  const validStatuses = ["Submitted", "Under Review", "Approved", "Denied", "Pending Information"];
  if (!validStatuses.includes(status)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` }) };
  }
  const entry = {
    claimId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    status,
    changedBy: changedBy || "system",
    note
  };
  await docClient.send(new import_lib_dynamodb.PutCommand({
    TableName: STATUS_HISTORY_TABLE,
    Item: entry
  }));
  return { statusCode: 201, headers: CORS_HEADERS, body: JSON.stringify(entry) };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
