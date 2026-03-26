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

// src/lambda/claim-summary-orchestrator.ts
var claim_summary_orchestrator_exports = {};
__export(claim_summary_orchestrator_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(claim_summary_orchestrator_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
var import_client_bedrock_agent_runtime = require("@aws-sdk/client-bedrock-agent-runtime");

// src/services/summary-cache.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var import_client_s3 = require("@aws-sdk/client-s3");
var SUMMARY_CACHE_TABLE = process.env.SUMMARY_CACHE_TABLE || "Summary_Cache_Table";
var SUMMARY_CONTENT_BUCKET = process.env.SUMMARY_CONTENT_BUCKET || "summary-content-bucket";
var AWS_REGION = process.env.AWS_REGION || "us-east-1";
var CACHE_TTL_SECONDS = 24 * 60 * 60;
var dynamoClient = new import_client_dynamodb.DynamoDBClient({ region: AWS_REGION });
var docClient = import_lib_dynamodb.DynamoDBDocumentClient.from(dynamoClient);
var s3Client = new import_client_s3.S3Client({ region: AWS_REGION });
function buildCacheKey(claimId, strategy, chunkingMethod, useReranker) {
  const method = chunkingMethod || "none";
  const key = `${claimId}#${strategy}#${method}`;
  return strategy === "graph-rag" && useReranker ? `${key}#reranker` : key;
}
function buildS3Path(claimId, strategy, chunkingMethod) {
  const method = chunkingMethod || "none";
  return `summaries/${claimId}/${strategy}/${method}.json`;
}
async function getCachedSummary(cacheKey) {
  try {
    const getResult = await docClient.send(
      new import_lib_dynamodb.GetCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Key: { cacheKey }
      })
    );
    if (!getResult.Item) {
      return null;
    }
    const metadata = getResult.Item;
    const s3Result = await s3Client.send(
      new import_client_s3.GetObjectCommand({
        Bucket: SUMMARY_CONTENT_BUCKET,
        Key: metadata.s3Key
      })
    );
    const contentString = await s3Result.Body?.transformToString();
    if (!contentString) {
      console.log("Cache content not found in S3", { cacheKey, s3Key: metadata.s3Key });
      return null;
    }
    const content = JSON.parse(contentString);
    return {
      ...metadata,
      content
    };
  } catch (error) {
    if (error.name === "NoSuchKey" || error.name === "ResourceNotFoundException") {
      return null;
    }
    console.log("Error retrieving cached summary", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
async function cacheSummary(cacheKey, summary, documentIds = []) {
  try {
    const [claimId, strategy, chunkingMethod] = cacheKey.split("#");
    const s3Key = buildS3Path(claimId, strategy, chunkingMethod);
    const ttl = Math.floor(Date.now() / 1e3) + CACHE_TTL_SECONDS;
    await s3Client.send(
      new import_client_s3.PutObjectCommand({
        Bucket: SUMMARY_CONTENT_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(summary),
        ContentType: "application/json"
      })
    );
    const cacheMetadata = {
      cacheKey,
      s3Key,
      strategy,
      chunkingMethod: chunkingMethod !== "none" ? chunkingMethod : void 0,
      documentCount: summary.documentCount,
      documentIds,
      processingTime: summary.processingTime,
      generatedAt: summary.generatedAt,
      evaluation: summary.evaluation,
      ttl
    };
    await docClient.send(
      new import_lib_dynamodb.PutCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Item: cacheMetadata
      })
    );
    console.log("Summary cached successfully", {
      cacheKey,
      s3Key,
      documentCount: summary.documentCount,
      ttl: new Date(ttl * 1e3).toISOString()
    });
  } catch (error) {
    console.log("Error caching summary", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// src/lambda/claim-summary-orchestrator.ts
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || "rag-app-v2-documents-dev";
var EVALUATION_RESULTS_TABLE = process.env.EVALUATION_RESULTS_TABLE || "evaluation-results-table";
var BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
var KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || "";
var GRAPH_RAG_KNOWLEDGE_BASE_ID = process.env.GRAPH_RAG_KNOWLEDGE_BASE_ID || "";
var dynamoClient2 = new import_client_dynamodb2.DynamoDBClient({ region: process.env.REGION || "us-east-1" });
var docClient2 = import_lib_dynamodb2.DynamoDBDocumentClient.from(dynamoClient2);
var bedrockClient = new import_client_bedrock_runtime.BedrockRuntimeClient({ region: BEDROCK_REGION });
var bedrockAgentClient = new import_client_bedrock_agent_runtime.BedrockAgentRuntimeClient({ region: BEDROCK_REGION });
var VALID_STRATEGIES = ["full-context", "rag", "graph-rag"];
var VALID_CHUNKING_METHODS = ["full-document", "semantic"];
var CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS"
};
function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message })
  };
}
function successResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}
function validateRequest(body) {
  if (!body) {
    return { valid: false, error: "Missing required field: strategy" };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { valid: false, error: "Invalid JSON in request body" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { valid: false, error: "Missing required field: strategy" };
  }
  const request = parsed;
  if (!request.strategy) {
    return { valid: false, error: "Missing required field: strategy" };
  }
  if (!VALID_STRATEGIES.includes(request.strategy)) {
    return { valid: false, error: "Invalid strategy. Must be one of: full-context, rag, graph-rag" };
  }
  const strategy = request.strategy;
  if (strategy === "rag") {
    if (!request.chunkingMethod) {
      return { valid: false, error: "Missing required field: chunkingMethod (required when strategy is rag)" };
    }
    if (!VALID_CHUNKING_METHODS.includes(request.chunkingMethod)) {
      return { valid: false, error: "Invalid chunkingMethod. Must be one of: full-document, semantic" };
    }
  }
  return {
    valid: true,
    request: {
      strategy,
      chunkingMethod: request.chunkingMethod,
      forceRegenerate: request.forceRegenerate === true,
      includeEvaluation: request.includeEvaluation === true,
      useReranker: request.useReranker === true
    }
  };
}
async function queryClaimDocuments(claimId, tenantId) {
  try {
    const command = new import_lib_dynamodb2.QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: "tenant-documents-index",
      KeyConditionExpression: "tenantId = :tenantId",
      FilterExpression: "claimMetadata.claimId = :claimId",
      ExpressionAttributeValues: {
        ":tenantId": tenantId,
        ":claimId": claimId
      }
    });
    const response = await docClient2.send(command);
    return response.Items || [];
  } catch (error) {
    console.error("Error querying claim documents via GSI, falling back to scan:", error);
    try {
      const scanCommand = new import_lib_dynamodb2.ScanCommand({
        TableName: DOCUMENTS_TABLE,
        FilterExpression: "claimMetadata.claimId = :claimId",
        ExpressionAttributeValues: {
          ":claimId": claimId
        }
      });
      const scanResponse = await docClient2.send(scanCommand);
      return scanResponse.Items || [];
    } catch (fallbackError) {
      console.error("Fallback scan also failed:", fallbackError);
      throw new Error("Failed to query claim documents");
    }
  }
}
async function invokeBedrockNovaPro(prompt) {
  const command = new import_client_bedrock_runtime.InvokeModelCommand({
    modelId: "amazon.nova-pro-v1:0",
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ text: prompt }]
        }
      ],
      inferenceConfig: {
        max_new_tokens: 4e3,
        temperature: 0.3
      }
    })
  });
  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const outputText = responseBody?.output?.message?.content?.[0]?.text || responseBody?.completion || "";
  return outputText;
}
function buildSummaryPrompt(documentsText, strategy) {
  return `You are an insurance claims analyst. Analyze the following claim documents and provide:

1. A comprehensive summary of the claim including patient information, diagnoses, procedures, service dates, provider information, and amounts.

2. Data anomaly detection - identify any inconsistencies including:
   - Chronological impossibilities (service dates before birth dates, payment dates before service dates)
   - Contradictory information across documents
   - Diagnosis codes inconsistent with patient demographics
   - Duplicate or conflicting information
   - Unrealistic data patterns

IMPORTANT: Dates in these documents use MM/DD/YYYY format. When comparing dates, you MUST convert them to YYYY-MM-DD format first to determine chronological order. For example, 10/03/1964 means October 3, 1964 and 08/10/1946 means August 10, 1946. A service date of 10/03/1964 is AFTER a birth date of 08/10/1946 (the patient was 18 years old), so that is NOT an anomaly. Only flag a chronological impossibility when the service date is genuinely earlier than the birth date (i.e., the YYYY year of service is less than the YYYY year of birth, or same year but earlier month/day).

Format your response as JSON with this exact structure:
{
  "summary": "Your comprehensive summary text here",
  "anomalies": [
    {
      "description": "Description of the anomaly",
      "severity": "critical|warning|info",
      "sourceDocument": "document name",
      "dataValues": {"key": "value"}
    }
  ]
}

Strategy used: ${strategy}

Documents:
${documentsText}`;
}
function parseSummaryResponse(responseText) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || responseText,
        anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies.map((a) => ({
          description: a.description || "",
          severity: ["critical", "warning", "info"].includes(a.severity) ? a.severity : "info",
          sourceDocument: a.sourceDocument || "Unknown",
          dataValues: a.dataValues || {}
        })) : []
      };
    }
  } catch {
  }
  return {
    summary: responseText,
    anomalies: []
  };
}
async function resolvePatientId(claimId, tenantId) {
  try {
    const docs = await queryClaimDocuments(claimId, tenantId);
    const patientId = docs.find((d) => d.claimMetadata?.patientId)?.claimMetadata?.patientId;
    if (patientId) {
      console.log(`Resolved patientId=${patientId} for claimId=${claimId}`);
    }
    return patientId || null;
  } catch (error) {
    console.error("Failed to resolve patientId for claimId:", claimId, error);
    return null;
  }
}
async function executeFullContextStrategy(documents) {
  const documentsText = documents.map((doc) => `--- Document: ${doc.fileName} ---
${doc.extractedText || ""}`).join("\n\n");
  const prompt = buildSummaryPrompt(documentsText, "full-context");
  const responseText = await invokeBedrockNovaPro(prompt);
  return parseSummaryResponse(responseText);
}
async function executeRagStrategy(claimId, chunkingMethod, patientId) {
  const filterKey = patientId ? "patientId" : "claimId";
  const filterValue = patientId || claimId;
  const vectorSearchConfig = {
    numberOfResults: 20,
    filter: {
      equals: { key: filterKey, value: filterValue }
    }
  };
  console.log(`RAG KB filter: ${filterKey}=${filterValue}`);
  const retrieveCommand = new import_client_bedrock_agent_runtime.RetrieveCommand({
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig
    }
  });
  const retrievalResponse = await bedrockAgentClient.send(retrieveCommand);
  const chunks = retrievalResponse.retrievalResults || [];
  if (chunks.length === 0) {
    console.warn(`No KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    return { summary: "", anomalies: [], documentCount: 0 };
  }
  const chunksText = chunks.map((chunk, i) => {
    const source = chunk.location?.s3Location?.uri || `Chunk ${i + 1}`;
    return `--- Chunk from: ${source} ---
${chunk.content?.text || ""}`;
  }).join("\n\n");
  const uniqueSources = new Set(
    chunks.map((c) => c.location?.s3Location?.uri).filter(Boolean)
  );
  const prompt = buildSummaryPrompt(chunksText, `rag (${chunkingMethod} chunking)`);
  const responseText = await invokeBedrockNovaPro(prompt);
  const parsed = parseSummaryResponse(responseText);
  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length
  };
}
async function executeGraphRagStrategy(claimId, useReranker = false, patientId) {
  const filterKey = patientId ? "patientId" : "claimId";
  const filterValue = patientId || claimId;
  console.log(`GraphRAG KB filter: ${filterKey}=${filterValue}`);
  const retrieveInput = {
    knowledgeBaseId: GRAPH_RAG_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 20,
        filter: {
          equals: { key: filterKey, value: filterValue }
        }
      }
    }
  };
  if (useReranker) {
    retrieveInput.retrievalConfiguration.rerankingConfiguration = {
      type: "BEDROCK_RERANKING_MODEL",
      bedrockRerankingConfiguration: {
        modelConfiguration: {
          modelArn: `arn:aws:bedrock:${process.env.AWS_REGION || "us-east-1"}::foundation-model/cohere.rerank-v3-5:0`
        }
      }
    };
  }
  const retrieveCommand = new import_client_bedrock_agent_runtime.RetrieveCommand(retrieveInput);
  const retrievalResponse = await bedrockAgentClient.send(retrieveCommand);
  const chunks = retrievalResponse.retrievalResults || [];
  if (chunks.length === 0) {
    console.warn(`No GraphRAG KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    return { summary: "", anomalies: [], documentCount: 0 };
  }
  const chunksText = chunks.map((chunk, i) => {
    const source = chunk.location?.s3Location?.uri || `Chunk ${i + 1}`;
    return `--- Chunk from: ${source} ---
${chunk.content?.text || ""}`;
  }).join("\n\n");
  const uniqueSources = new Set(
    chunks.map((c) => c.location?.s3Location?.uri).filter(Boolean)
  );
  const prompt = buildSummaryPrompt(chunksText, "graph-rag (Neptune Analytics GraphRAG)");
  const responseText = await invokeBedrockNovaPro(prompt);
  const parsed = parseSummaryResponse(responseText);
  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length
  };
}
async function getEvaluationScores(claimId, strategyKey) {
  try {
    const command = new import_lib_dynamodb2.QueryCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      KeyConditionExpression: "claimId = :claimId AND strategyKey = :strategyKey",
      ExpressionAttributeValues: {
        ":claimId": claimId,
        ":strategyKey": strategyKey
      }
    });
    const response = await docClient2.send(command);
    const item = response.Items?.[0];
    if (!item) return void 0;
    return {
      helpfulness: item.helpfulness,
      faithfulness: item.faithfulness,
      completeness: item.completeness,
      anomalyAccuracy: item.anomalyAccuracy,
      evaluatedAt: item.evaluatedAt
    };
  } catch (error) {
    console.error("Error fetching evaluation scores:", error);
    return void 0;
  }
}
async function handleGetEvaluations(claimId) {
  console.log("Handling GET /evaluations for claimId:", claimId);
  try {
    const command = new import_lib_dynamodb2.QueryCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      KeyConditionExpression: "claimId = :claimId",
      ExpressionAttributeValues: {
        ":claimId": claimId
      }
    });
    const response = await docClient2.send(command);
    const items = response.Items || [];
    const evaluations = items.map((item) => {
      const [strategy, chunkingMethod] = item.strategyKey.split("#");
      return {
        strategy,
        chunkingMethod: chunkingMethod !== "none" ? chunkingMethod : null,
        evaluation: {
          helpfulness: item.helpfulness,
          faithfulness: item.faithfulness,
          completeness: item.completeness,
          anomalyAccuracy: item.anomalyAccuracy,
          evaluatedAt: item.evaluatedAt
        }
      };
    });
    return successResponse(200, {
      claimId,
      evaluations
    });
  } catch (error) {
    console.error("Error fetching evaluations:", error);
    return errorResponse(500, "Failed to retrieve evaluation results");
  }
}
async function handlePostSummary(claimId, request, tenantId) {
  const startTime = Date.now();
  if (!request.forceRegenerate) {
    const cacheKey = buildCacheKey(claimId, request.strategy, request.chunkingMethod, request.useReranker);
    console.log("Checking cache for key:", cacheKey);
    try {
      const cached = await getCachedSummary(cacheKey);
      if (cached) {
        console.log("Cache hit for key:", cacheKey);
        const cachedResponse = {
          ...cached.content,
          cached: true,
          cachedAt: (/* @__PURE__ */ new Date()).toISOString(),
          generatedAt: cached.generatedAt
        };
        if (request.includeEvaluation) {
          const strategyKey = `${request.strategy}#${request.chunkingMethod || "none"}`;
          const evaluation = await getEvaluationScores(claimId, strategyKey);
          if (evaluation) {
            cachedResponse.evaluation = evaluation;
          }
        }
        return successResponse(200, cachedResponse);
      }
    } catch (error) {
      console.error("Cache read failed, proceeding with generation:", error);
    }
  }
  let summary;
  let anomalies;
  let documentCount;
  let documentIds = [];
  try {
    const patientId = await resolvePatientId(claimId, tenantId);
    if (request.strategy === "rag") {
      console.log("Executing RAG strategy with chunkingMethod:", request.chunkingMethod);
      const ragResult = await executeRagStrategy(
        claimId,
        request.chunkingMethod || "semantic",
        patientId
      );
      if (ragResult.documentCount === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }
      summary = ragResult.summary;
      anomalies = ragResult.anomalies;
      documentCount = ragResult.documentCount;
    } else if (request.strategy === "graph-rag") {
      const useReranker = request.useReranker ?? false;
      console.log("Executing graph-rag strategy for claimId:", claimId, "useReranker:", useReranker);
      try {
        const graphRagResult = await executeGraphRagStrategy(claimId, useReranker, patientId);
        if (graphRagResult.documentCount === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        summary = graphRagResult.summary;
        anomalies = graphRagResult.anomalies;
        documentCount = graphRagResult.documentCount;
      } catch (error) {
        console.error("Graph RAG failed, falling back to full-context:", error);
        const documents = await queryClaimDocuments(claimId, tenantId);
        if (documents.length === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        const summarizable = documents.filter((d) => d.extractedText?.trim());
        if (summarizable.length === 0) {
          return errorResponse(400, "No summarizable content available.");
        }
        documentIds = summarizable.map((d) => d.documentId);
        documentCount = summarizable.length;
        const result = await executeFullContextStrategy(summarizable);
        summary = result.summary;
        anomalies = result.anomalies;
      }
    } else {
      console.log("Querying documents for claimId:", claimId);
      const documents = await queryClaimDocuments(claimId, tenantId);
      if (documents.length === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }
      const summarizableDocuments = documents.filter(
        (doc) => doc.extractedText && doc.extractedText.trim().length > 0
      );
      if (summarizableDocuments.length === 0) {
        return errorResponse(
          400,
          "No summarizable content available. Documents are still processing or have no extracted text."
        );
      }
      documentIds = summarizableDocuments.map((doc) => doc.documentId);
      documentCount = summarizableDocuments.length;
      console.log("Executing full-context strategy with", documentCount, "documents");
      const result = await executeFullContextStrategy(summarizableDocuments);
      summary = result.summary;
      anomalies = result.anomalies;
    }
  } catch (error) {
    console.error("Agent invocation failed:", error);
    return errorResponse(502, "Summary generation failed. Please try again later.");
  }
  const processingTime = Date.now() - startTime;
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const response = {
    summary,
    anomalies,
    strategy: request.strategy,
    chunkingMethod: request.chunkingMethod,
    documentCount,
    processingTime,
    generatedAt,
    cached: false,
    useReranker: request.strategy === "graph-rag" ? request.useReranker : void 0
  };
  if (request.includeEvaluation) {
    const strategyKey = `${request.strategy}#${request.chunkingMethod || "none"}`;
    const evaluation = await getEvaluationScores(claimId, strategyKey);
    if (evaluation) {
      response.evaluation = evaluation;
    }
  }
  try {
    const cacheKey = buildCacheKey(claimId, request.strategy, request.chunkingMethod, request.useReranker);
    await cacheSummary(cacheKey, response, documentIds);
    console.log("Summary cached successfully for key:", cacheKey);
  } catch (error) {
    console.error("Failed to cache summary:", error);
  }
  return successResponse(200, response);
}
var handler = async (event) => {
  console.log("Claim Summary Orchestrator Request:", JSON.stringify({
    path: event.path,
    httpMethod: event.httpMethod,
    pathParameters: event.pathParameters,
    body: event.body ? "(present)" : "(empty)"
  }));
  try {
    const claimId = event.pathParameters?.claimId;
    if (!claimId) {
      console.log("Validation failed: Missing claimId parameter");
      return errorResponse(400, "Missing claimId parameter");
    }
    if (event.httpMethod === "GET" && (event.path?.endsWith("/evaluations") || event.resource?.endsWith("/evaluations"))) {
      return handleGetEvaluations(claimId);
    }
    const validation = validateRequest(event.body);
    if (!validation.valid) {
      console.log("Validation failed:", validation.error);
      return errorResponse(400, validation.error);
    }
    const request = validation.request;
    console.log("Validated request:", JSON.stringify({
      claimId,
      strategy: request.strategy,
      chunkingMethod: request.chunkingMethod,
      forceRegenerate: request.forceRegenerate,
      includeEvaluation: request.includeEvaluation
    }));
    return handlePostSummary(claimId, request, extractTenantId(event));
  } catch (error) {
    console.error("Unexpected error in claim summary orchestrator:", error);
    return errorResponse(500, "Internal server error");
  }
};
function extractTenantId(event) {
  const headers = event.headers || {};
  return headers["x-tenant-id"] || headers["X-Tenant-Id"] || "local-dev-tenant";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
