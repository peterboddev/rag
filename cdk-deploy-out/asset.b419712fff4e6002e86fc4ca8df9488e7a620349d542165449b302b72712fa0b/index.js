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

// src/lambda/claim-export-pdf.ts
var claim_export_pdf_exports = {};
__export(claim_export_pdf_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_export_pdf_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION || "us-east-1" });
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME || "rag-app-v2-documents-dev";
var STATUS_HISTORY_TABLE = process.env.STATUS_HISTORY_TABLE || "rag-app-claim-status-history-dev";
var CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};
var handler = async (event) => {
  console.log("Claim Export Request:", JSON.stringify({ method: event.httpMethod, path: event.path }));
  const claimId = event.pathParameters?.claimId;
  if (!claimId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing claimId" }) };
  }
  try {
    const docsResult = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: "tenant-documents-index",
      KeyConditionExpression: "tenantId = :tid",
      FilterExpression: "attribute_exists(claimMetadata) AND claimMetadata.claimId = :cid",
      ExpressionAttributeValues: { ":tid": "local-dev-tenant", ":cid": claimId }
    }));
    const documents = docsResult.Items || [];
    let history = [];
    try {
      const histResult = await docClient.send(new import_lib_dynamodb.QueryCommand({
        TableName: STATUS_HISTORY_TABLE,
        KeyConditionExpression: "claimId = :cid",
        ExpressionAttributeValues: { ":cid": claimId },
        ScanIndexForward: true
      }));
      history = histResult.Items || [];
    } catch {
    }
    const claimMeta = documents[0]?.claimMetadata || {};
    const lines = [];
    lines.push("=".repeat(60));
    lines.push(`CLAIM EXPORT REPORT`);
    lines.push(`Claim ID: ${claimId}`);
    lines.push(`Patient: ${claimMeta.patientName || "N/A"} (${claimMeta.patientId || "N/A"})`);
    lines.push(`TCIA Collection: ${claimMeta.tciaCollectionId || "N/A"}`);
    lines.push(`Primary Diagnosis: ${claimMeta.primaryDiagnosis || "N/A"}`);
    lines.push(`Filing Date: ${claimMeta.filingDate || "N/A"}`);
    lines.push(`Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`);
    lines.push("=".repeat(60));
    lines.push("");
    lines.push("--- STATUS HISTORY ---");
    if (history.length === 0) {
      lines.push("No status history recorded.");
    } else {
      for (const h of history) {
        lines.push(`  ${h.timestamp} | ${h.status} | ${h.changedBy || "system"}${h.note ? ` | ${h.note}` : ""}`);
      }
    }
    lines.push("");
    lines.push("--- DOCUMENTS ---");
    lines.push(`Total: ${documents.length}`);
    for (const doc of documents) {
      lines.push(`  - ${doc.fileName} (${doc.claimMetadata?.documentType || "Unknown"}) [${doc.processingStatus}]`);
      if (doc.extractedText) {
        const preview = doc.extractedText.substring(0, 200).replace(/\n/g, " ");
        lines.push(`    Preview: ${preview}...`);
      }
    }
    lines.push("");
    lines.push("=".repeat(60));
    lines.push("END OF REPORT");
    const exportContent = lines.join("\n");
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        claimId,
        fileName: `claim-${claimId}-export.txt`,
        contentType: "text/plain",
        content: exportContent,
        documentCount: documents.length,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      })
    };
  } catch (error) {
    console.error("Error in claim-export-pdf:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" })
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
