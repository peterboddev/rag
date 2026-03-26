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

// src/lambda/claim-search.ts
var claim_search_exports = {};
__export(claim_search_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_search_exports);
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");
var dynamoClient = new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION || "us-east-1" });
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var bedrockAgent = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({ region: process.env.BEDROCK_REGION || "us-east-1" });
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME || "rag-app-v2-documents-dev";
var KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || "";
var CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};
var handler = async (event) => {
  console.log("Claim Search Request:", JSON.stringify({ method: event.httpMethod, path: event.path }));
  try {
    const body = JSON.parse(event.body || "{}");
    const { query, documentType, limit } = body;
    if (!query || query.trim().length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "Missing or empty query" }) };
    }
    const maxResults = Math.min(limit || 10, 20);
    let results = [];
    if (KNOWLEDGE_BASE_ID) {
      const retrieveResponse = await bedrockAgent.send(new import_client_bedrock_agent_runtime.RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: { numberOfResults: maxResults }
        }
      }));
      const kbResults = retrieveResponse.retrievalResults || [];
      for (const r of kbResults) {
        const uri = r.location?.s3Location?.uri || "";
        const score = r.score ?? 0;
        const excerpt = r.content?.text || "";
        const docMeta = await findDocumentByS3Key(uri);
        results.push({
          documentId: docMeta?.documentId || uri,
          claimId: docMeta?.claimMetadata?.claimId || "unknown",
          fileName: docMeta?.fileName || uri.split("/").pop() || "unknown",
          excerpt: excerpt.substring(0, 500),
          score,
          documentType: docMeta?.claimMetadata?.documentType
        });
      }
    } else {
      results = await fallbackTextSearch(query, maxResults);
    }
    if (documentType) {
      results = results.filter((r) => r.documentType === documentType);
    }
    const response = {
      query,
      results,
      totalResults: results.length
    };
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
  } catch (error) {
    console.error("Error in claim-search:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error", message: error instanceof Error ? error.message : "Unknown error" })
    };
  }
};
async function findDocumentByS3Key(s3Uri) {
  try {
    const key = s3Uri.replace(/^s3:\/\/[^/]+\//, "");
    if (!key) return null;
    const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: "tenant-documents-index",
      KeyConditionExpression: "tenantId = :tid",
      FilterExpression: "s3Key = :s3k",
      ExpressionAttributeValues: { ":tid": "local-dev-tenant", ":s3k": key },
      Limit: 1
    }));
    return result.Items?.[0] || null;
  } catch {
    return null;
  }
}
async function fallbackTextSearch(query, limit) {
  try {
    const result = await docClient.send(new import_lib_dynamodb.QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: "tenant-documents-index",
      KeyConditionExpression: "tenantId = :tid",
      ExpressionAttributeValues: { ":tid": "local-dev-tenant" }
    }));
    const lowerQuery = query.toLowerCase();
    const matches = (result.Items || []).filter((item) => {
      const text = (item.extractedText || "").toLowerCase();
      const name = (item.fileName || "").toLowerCase();
      return text.includes(lowerQuery) || name.includes(lowerQuery);
    }).slice(0, limit).map((item) => ({
      documentId: item.documentId || item.id,
      claimId: item.claimMetadata?.claimId || "unknown",
      fileName: item.fileName,
      excerpt: (item.extractedText || "").substring(0, 500),
      score: 1,
      documentType: item.claimMetadata?.documentType
    }));
    return matches;
  } catch {
    return [];
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
