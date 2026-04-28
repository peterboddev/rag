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
var import_client_lambda = require("@aws-sdk/client-lambda");
var import_client_bedrock_agentcore = require("@aws-sdk/client-bedrock-agentcore");

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
  return (strategy === "graph-rag" || strategy === "rag") && useReranker ? `${key}#reranker` : key;
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
var AGENTCORE_TIMEOUT_MS = parseInt(process.env.AGENTCORE_TIMEOUT_MS || "120000", 10);
var agentCoreClient = null;
function getAgentCoreClient() {
  if (!agentCoreClient) {
    agentCoreClient = new import_client_bedrock_agentcore.BedrockAgentCoreClient({
      region: process.env.AWS_REGION || BEDROCK_REGION,
      requestHandler: { requestTimeout: AGENTCORE_TIMEOUT_MS }
    });
  }
  return agentCoreClient;
}
async function invokeAgentCoreRuntime(agentRuntimeArn, payload) {
  const body = JSON.stringify(payload);
  console.log(`Invoking AgentCore Runtime: ${agentRuntimeArn}`);
  const command = new import_client_bedrock_agentcore.InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    payload: new TextEncoder().encode(body),
    contentType: "application/json",
    accept: "application/json"
  });
  const response = await getAgentCoreClient().send(command);
  const chunks = [];
  const responseStream = response.response;
  if (responseStream) {
    if (Symbol.asyncIterator in Object(responseStream)) {
      for await (const chunk of responseStream) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    } else if (typeof responseStream.transformToString === "function") {
      chunks.push(await responseStream.transformToString());
    } else if (typeof responseStream.read === "function") {
      for await (const chunk of responseStream) {
        chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      }
    }
  }
  const responseBody = chunks.join("");
  if (response.contentType?.includes("text/event-stream")) {
    const dataLines = responseBody.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.substring(6));
    const fullContent = dataLines.join("");
    try {
      return JSON.parse(fullContent);
    } catch {
      return { summary: fullContent, anomalies: [], documentCount: 0, strategy: "unknown" };
    }
  }
  try {
    return JSON.parse(responseBody);
  } catch {
    throw new Error(`AgentCore Runtime returned invalid JSON: ${responseBody.substring(0, 200)}`);
  }
}
var VALID_STRATEGIES = ["full-context", "rag", "graph-rag", "enriched"];
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
    return { valid: false, error: "Invalid strategy. Must be one of: full-context, rag, graph-rag, enriched" };
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
      useReranker: request.useReranker === true,
      modelId: typeof request.modelId === "string" ? request.modelId : void 0,
      customPrompt: typeof request.customPrompt === "string" ? request.customPrompt : void 0
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
async function invokeBedrockNovaPro(prompt, modelId = "amazon.nova-pro-v1:0") {
  const isClaude = modelId.includes("anthropic");
  const body = isClaude ? {
    anthropic_version: "bedrock-2023-05-31",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4e3,
    temperature: 0.3
  } : {
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { max_new_tokens: 4e3, temperature: 0.3 }
  };
  const command = new import_client_bedrock_runtime.InvokeModelCommand({
    modelId,
    body: JSON.stringify(body)
  });
  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  if (isClaude) {
    return responseBody?.content?.[0]?.text || "";
  }
  return responseBody?.output?.message?.content?.[0]?.text || responseBody?.completion || "";
}
function buildSummaryPrompt(documentsText, strategy) {
  return `You are an insurance claims analyst. Analyze the following claim documents and provide:

1. A comprehensive summary of the claim including patient information, diagnoses, procedures, service dates, provider information, and amounts.

2. Data anomaly detection - carefully check for ALL of the following inconsistencies:

   A. DATE ANOMALIES:
   - Service/encounter dates that fall BEFORE the patient's birth date (year of service < year of birth)
   - Payment dates that fall BEFORE the service date (year of payment < year of service)
   - Dates that are in the future relative to other dates in the claim

   B. AGE-PLAUSIBILITY ANOMALIES (IMPORTANT - calculate patient age at time of service):
   - Calculate the patient's age at each service/encounter date: age = service_year - birth_year
   - Flag if medical history is implausible for the patient's age (e.g., a child with decades of substance use history, a 5-year-old with 30 pack-years of smoking, a teenager with age-related conditions like dementia)
   - Flag if procedures are inappropriate for the patient's age (e.g., pediatric procedures on elderly patients, geriatric procedures on children)
   - Flag if prescribed medications are contraindicated for the patient's age group

   C. CROSS-DOCUMENT CONTRADICTIONS:
   - Different patient names, birth dates, or genders across documents for the same claim
   - Conflicting diagnoses or procedures across documents
   - Inconsistent provider information
   - Duplicate charges or conflicting amounts

   D. BILLING ANOMALIES:
   - Charges that seem unreasonable for the procedures listed
   - Duplicate billing for the same service
   - Services billed that don't match the diagnosis

   E. CLINICAL AND LOGICAL PLAUSIBILITY:
   - Any claim detail that contradicts established medical knowledge (e.g., treatments inappropriate for the stated diagnosis, impossible lab values, contradictory clinical findings)
   - Treatments, procedures, or referrals that don't match the documented diagnosis or symptoms
   - Lab results, imaging findings, or vital signs inconsistent with the stated condition or patient demographics
   - Medication prescriptions that conflict with the diagnosis, patient age, or other prescribed medications
   - Any data point that a trained insurance claims reviewer would flag for further investigation
   - Use your medical and insurance domain knowledge to identify anything that simply doesn't make sense

CRITICAL DATE COMPARISON RULES:
- To compare two dates, first extract the YEAR. A higher year number means a later date.
- A service date is AFTER a birth date if the service year > birth year. This is NOT an anomaly.
- Only flag "date before" anomalies if the year is strictly less.
- When reporting dates in dataValues, use YYYY-MM-DD format.

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
function buildPromptInfo(strategyLabel, retrievalQuery) {
  const promptTemplate = buildSummaryPrompt("[DOCUMENTS]", strategyLabel);
  return {
    promptTemplate,
    strategyLabel,
    ...retrievalQuery !== void 0 && { retrievalQuery }
  };
}
function parseSummaryResponse(responseText) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const rawAnomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies.map((a) => ({
        description: a.description || "",
        severity: ["critical", "warning", "info"].includes(a.severity) ? a.severity : "info",
        sourceDocument: a.sourceDocument || "Unknown",
        dataValues: a.dataValues || {}
      })) : [];
      return {
        summary: parsed.summary || responseText,
        anomalies: filterFalsePositiveDateAnomalies(rawAnomalies)
      };
    }
  } catch {
  }
  return {
    summary: responseText,
    anomalies: []
  };
}
function filterFalsePositiveDateAnomalies(anomalies) {
  return anomalies.filter((anomaly) => {
    const desc = anomaly.description.toLowerCase();
    const dv = anomaly.dataValues;
    if (desc.includes("future") && desc.includes("birth")) {
      const dateEntries = [];
      for (const [key, val] of Object.entries(dv)) {
        if (typeof val === "string") {
          const parsed = parseFlexibleDate(val);
          if (parsed) dateEntries.push({ key, date: parsed });
        }
      }
      if (dateEntries.length === 2) {
        const birthKeys = ["birthdate", "birth_date", "dob", "dateofbirth", "patientbirthdate"];
        const birthEntry = dateEntries.find((e) => birthKeys.includes(e.key.toLowerCase().replace(/[_\s]+/g, "")));
        const otherEntry = dateEntries.find((e) => !birthKeys.includes(e.key.toLowerCase().replace(/[_\s]+/g, "")));
        if (birthEntry && otherEntry && otherEntry.date > birthEntry.date) {
          return false;
        }
      }
    }
    if (desc.includes("before")) {
      const dateEntries = [];
      for (const [key, val] of Object.entries(dv)) {
        if (typeof val === "string") {
          const parsed = parseFlexibleDate(val);
          if (parsed) dateEntries.push({ key, date: parsed });
        }
      }
      if (dateEntries.length === 2) {
        const birthKeys = ["birthdate", "birth_date", "dob", "dateofbirth"];
        const isBirthComparison = dateEntries.some((e) => birthKeys.includes(e.key.toLowerCase()));
        if (isBirthComparison) {
          const birthEntry = dateEntries.find((e) => birthKeys.includes(e.key.toLowerCase()));
          const otherEntry = dateEntries.find((e) => !birthKeys.includes(e.key.toLowerCase()));
          if (birthEntry && otherEntry && otherEntry.date >= birthEntry.date) {
            return false;
          }
        } else {
          const descNorm = desc.replace(/[_\s]+/g, "");
          const [first, second] = dateEntries;
          const firstKeyNorm = first.key.toLowerCase().replace(/[_\s]+/g, "");
          const secondKeyNorm = second.key.toLowerCase().replace(/[_\s]+/g, "");
          const firstIdx = descNorm.indexOf(firstKeyNorm);
          const secondIdx = descNorm.indexOf(secondKeyNorm);
          if (firstIdx >= 0 && secondIdx >= 0 && firstIdx < secondIdx) {
            if (first.date >= second.date) return false;
          } else if (firstIdx >= 0 && secondIdx >= 0 && secondIdx < firstIdx) {
            if (second.date >= first.date) return false;
          } else {
            if (first.date >= second.date) return false;
          }
        }
      }
    }
    return true;
  });
}
function parseFlexibleDate(dateStr) {
  const trimmed = dateStr.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }
  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) {
    return new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
  }
  return null;
}
function aggregateFinancialData(documents) {
  const allPayments = [];
  for (const doc of documents) {
    const financials = doc.extractedFinancials;
    if (!financials || !Array.isArray(financials.payments)) continue;
    for (const p of financials.payments) {
      const amount = typeof p.amount === "number" ? p.amount : parseFloat(p.amount);
      if (amount > 0) {
        allPayments.push({ amount, sourceDocument: doc.fileName, rawText: p.rawText || "" });
      }
    }
  }
  if (allPayments.length === 0) {
    return { minPayment: 0, maxPayment: 0, totalValue: 0, payments: [] };
  }
  const amounts = allPayments.map((p) => p.amount);
  return {
    minPayment: Math.min(...amounts),
    maxPayment: Math.max(...amounts),
    totalValue: Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100,
    payments: allPayments
  };
}
function aggregateTimelineData(documents) {
  const allYears = [];
  for (const doc of documents) {
    const dates = doc.extractedDates;
    if (!dates || !Array.isArray(dates.dates)) continue;
    for (const d of dates.dates) {
      const dateStr = typeof d === "string" ? d : d.date;
      if (typeof dateStr === "string") {
        const match = dateStr.match(/^(\d{4})/);
        if (match) allYears.push(parseInt(match[1], 10));
      }
    }
  }
  if (allYears.length === 0) {
    return { startYear: null, endYear: null, durationYears: null };
  }
  const startYear = Math.min(...allYears);
  const endYear = Math.max(...allYears);
  return { startYear, endYear, durationYears: endYear - startYear };
}
function aggregateBdaFinancialData(documents) {
  const allPayments = [];
  for (const doc of documents) {
    const bda = doc.bdaExtraction;
    if (!bda || !bda.financials) continue;
    const { billedAmount, allowedAmount, paidAmount, patientResponsibility } = bda.financials;
    const fileName = doc.fileName;
    if (typeof billedAmount === "number" && billedAmount > 0) allPayments.push({ amount: billedAmount, sourceDocument: fileName, rawText: `billed: ${billedAmount}` });
    if (typeof allowedAmount === "number" && allowedAmount > 0) allPayments.push({ amount: allowedAmount, sourceDocument: fileName, rawText: `allowed: ${allowedAmount}` });
    if (typeof paidAmount === "number" && paidAmount > 0) allPayments.push({ amount: paidAmount, sourceDocument: fileName, rawText: `paid: ${paidAmount}` });
    if (typeof patientResponsibility === "number" && patientResponsibility > 0) allPayments.push({ amount: patientResponsibility, sourceDocument: fileName, rawText: `patient responsibility: ${patientResponsibility}` });
  }
  if (allPayments.length === 0) return null;
  const amounts = allPayments.map((p) => p.amount);
  return {
    minPayment: Math.min(...amounts),
    maxPayment: Math.max(...amounts),
    totalValue: Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100,
    payments: allPayments
  };
}
function aggregateBdaTimelineData(documents) {
  const allYears = [];
  const extractYear = (dateStr) => {
    const isoMatch = dateStr.match(/^(\d{4})/);
    if (isoMatch) return parseInt(isoMatch[1], 10);
    const usMatch = dateStr.match(/(\d{4})$/);
    if (usMatch) return parseInt(usMatch[1], 10);
    return null;
  };
  for (const doc of documents) {
    const bda = doc.bdaExtraction;
    if (!bda) continue;
    const dates = bda.dates;
    if (dates) {
      for (const dateStr of [dates.serviceDate, dates.paymentDate]) {
        if (typeof dateStr === "string") {
          const year = extractYear(dateStr);
          if (year && year > 1900 && year < 2100) allYears.push(year);
        }
      }
    }
    if (bda.patient?.dateOfBirth && typeof bda.patient.dateOfBirth === "string") {
      const year = extractYear(bda.patient.dateOfBirth);
      if (year && year > 1900 && year < 2100) allYears.push(year);
    }
  }
  if (allYears.length === 0) return null;
  const startYear = Math.min(...allYears);
  const endYear = Math.max(...allYears);
  return { startYear, endYear, durationYears: endYear - startYear };
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
async function executeFullContextStrategy(claimId, tenantId, modelId, customPrompt) {
  const fullContextAgentEndpoint = process.env.FULL_CONTEXT_AGENT_ENDPOINT;
  const financialTimelineAgentEndpoint = process.env.FINANCIAL_TIMELINE_AGENT_ENDPOINT;
  if (!fullContextAgentEndpoint) {
    console.warn("FULL_CONTEXT_AGENT_ENDPOINT not configured, using legacy direct Bedrock approach");
    const documents = await queryClaimDocuments(claimId, tenantId);
    if (documents.length === 0) {
      throw new Error(`No documents found for claim ${claimId}`);
    }
    const summarizable = documents.filter((d) => d.extractedText?.trim());
    if (summarizable.length === 0) {
      throw new Error("No summarizable content available.");
    }
    const documentsText = summarizable.map((doc) => `--- Document: ${doc.fileName} ---
${doc.extractedText || ""}`).join("\n\n");
    const prompt = customPrompt ? customPrompt.replace("{documentsText}", documentsText).replace("[DOCUMENTS]", documentsText) : buildSummaryPrompt(documentsText, "full-context");
    const responseText = await invokeBedrockNovaPro(prompt, modelId);
    const promptInfo = customPrompt ? { promptTemplate: customPrompt, strategyLabel: "full-context (custom prompt)" } : buildPromptInfo("full-context");
    const financialSummary = aggregateFinancialData(documents);
    const timeline = aggregateTimelineData(documents);
    const bdaFinancialSummary = aggregateBdaFinancialData(documents);
    const bdaTimeline = aggregateBdaTimelineData(documents);
    if (financialTimelineAgentEndpoint) {
      try {
        const lambdaClient = new import_client_lambda.LambdaClient({ region: BEDROCK_REGION });
        await lambdaClient.send(new import_client_lambda.InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "",
          InvocationType: "Event",
          // async — returns immediately
          Payload: JSON.stringify({
            httpMethod: "POST",
            path: `/claims/${claimId}/financial-analysis-trigger`,
            pathParameters: { claimId },
            body: JSON.stringify({ claimId, tenantId, modelId }),
            headers: {}
          })
        }));
        console.log("Financial Timeline Agent trigger invoked asynchronously for claim:", claimId);
      } catch (triggerErr) {
        console.warn("Failed to trigger Financial Timeline Agent (non-blocking):", triggerErr);
      }
    }
    return {
      ...parseSummaryResponse(responseText),
      documentCount: summarizable.length,
      promptInfo,
      financialSummary,
      timeline,
      agentFinancialSummary: null,
      agentTimeline: null,
      agentConfidence: null,
      agentReasoning: null,
      bdaFinancialSummary,
      bdaTimeline
    };
  }
  const fullContextPromise = invokeAgentCoreRuntime(fullContextAgentEndpoint, {
    claim_id: claimId,
    tenant_id: tenantId,
    model_id: modelId || void 0,
    custom_prompt: customPrompt || void 0
  });
  if (financialTimelineAgentEndpoint) {
    try {
      const lambdaClient = new import_client_lambda.LambdaClient({ region: BEDROCK_REGION });
      await lambdaClient.send(new import_client_lambda.InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "",
        InvocationType: "Event",
        Payload: JSON.stringify({
          httpMethod: "POST",
          path: `/claims/${claimId}/financial-analysis-trigger`,
          pathParameters: { claimId },
          body: JSON.stringify({ claimId, tenantId, modelId }),
          headers: {}
        })
      }));
      console.log("Financial Timeline Agent trigger invoked asynchronously for claim:", claimId);
    } catch (triggerErr) {
      console.warn("Failed to trigger Financial Timeline Agent (non-blocking):", triggerErr);
    }
  }
  const agentResult = await fullContextPromise;
  if (agentResult.error || agentResult.statusCode >= 400) {
    const errorMessage = agentResult.error || "Full Context agent invocation failed";
    console.error("Full Context agent error:", errorMessage);
    throw new Error(errorMessage);
  }
  return {
    summary: agentResult.summary || "",
    anomalies: agentResult.anomalies || [],
    documentCount: agentResult.documentCount || 0,
    promptInfo: agentResult.promptInfo || {
      promptTemplate: "Enhanced Full Context Agent",
      strategyLabel: "full-context (enhanced agent)"
    },
    financialSummary: agentResult.financialSummary,
    timeline: agentResult.timeline,
    agentFinancialSummary: null,
    agentTimeline: null,
    agentConfidence: null,
    agentReasoning: null,
    bdaFinancialSummary: null,
    bdaTimeline: null
  };
}
async function executeRagStrategy(claimId, chunkingMethod, useReranker = false, patientId, modelId) {
  const filterKey = patientId ? "patientId" : "claimId";
  const filterValue = patientId || claimId;
  const vectorSearchConfig = {
    numberOfResults: 20,
    filter: {
      equals: { key: filterKey, value: filterValue }
    }
  };
  console.log(`RAG KB filter: ${filterKey}=${filterValue}`);
  const retrievalQueryText = `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`;
  const retrieveInput = {
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: retrievalQueryText
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig
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
    console.warn(`No KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    const promptInfo2 = buildPromptInfo(`rag (${chunkingMethod} chunking)`, retrievalQueryText);
    return { summary: "", anomalies: [], documentCount: 0, promptInfo: promptInfo2 };
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
  const responseText = await invokeBedrockNovaPro(prompt, modelId);
  const parsed = parseSummaryResponse(responseText);
  const promptInfo = buildPromptInfo(`rag (${chunkingMethod} chunking)`, retrievalQueryText);
  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
    promptInfo
  };
}
async function executeGraphRagStrategy(claimId, useReranker = false, patientId, modelId) {
  const filterKey = patientId ? "patientId" : "claimId";
  const filterValue = patientId || claimId;
  console.log(`GraphRAG KB filter: ${filterKey}=${filterValue}`);
  const retrievalQueryText = `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`;
  const retrieveInput = {
    knowledgeBaseId: GRAPH_RAG_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: retrievalQueryText
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
    const promptInfo2 = buildPromptInfo("graph-rag (Neptune Analytics GraphRAG)", retrievalQueryText);
    return { summary: "", anomalies: [], documentCount: 0, promptInfo: promptInfo2 };
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
  const responseText = await invokeBedrockNovaPro(prompt, modelId);
  const parsed = parseSummaryResponse(responseText);
  const promptInfo = buildPromptInfo("graph-rag (Neptune Analytics GraphRAG)", retrievalQueryText);
  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
    promptInfo
  };
}
async function executeEnrichedStrategy(claimId, tenantId, patientId, modelId) {
  const enrichedAgentEndpoint = process.env.ENRICHED_AGENT_ENDPOINT;
  if (!enrichedAgentEndpoint) {
    throw new Error("ENRICHED_AGENT_ENDPOINT environment variable is not configured");
  }
  console.log("Invoking enriched agent via AgentCore Runtime for claimId:", claimId);
  const responsePayload = await invokeAgentCoreRuntime(enrichedAgentEndpoint, {
    claim_id: claimId,
    tenant_id: tenantId,
    patient_id: patientId || void 0,
    model_id: modelId || void 0
  });
  if (responsePayload.error) {
    throw new Error(`Enriched agent error: ${responsePayload.error}`);
  }
  const agentAnomalies = Array.isArray(responsePayload.anomalies) ? responsePayload.anomalies.map((a) => ({
    description: a.description || "",
    severity: ["critical", "warning", "info"].includes(a.severity) ? a.severity : "info",
    sourceDocument: a.sourceDocument || "Unknown",
    dataValues: a.dataValues || {}
  })) : [];
  return {
    summary: responsePayload.summary || "",
    anomalies: filterFalsePositiveDateAnomalies(agentAnomalies),
    documentCount: responsePayload.documentCount || 0,
    promptInfo: responsePayload.promptInfo || buildPromptInfo("Enriched (Full Context + RAG + Graph RAG)")
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
async function handleGetFinancialAnalysis(claimId) {
  console.log("Handling GET /financial-analysis for claimId:", claimId);
  try {
    const command = new import_lib_dynamodb2.QueryCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      KeyConditionExpression: "claimId = :claimId AND strategyKey = :sk",
      ExpressionAttributeValues: {
        ":claimId": claimId,
        ":sk": "financial-analysis#full-context"
      }
    });
    const response = await docClient2.send(command);
    const item = response.Items?.[0];
    if (!item) {
      return successResponse(200, {
        claimId,
        status: "pending",
        agentFinancialSummary: null,
        agentTimeline: null,
        agentConfidence: null,
        agentReasoning: null
      });
    }
    return successResponse(200, {
      claimId,
      status: "completed",
      agentFinancialSummary: item.agentFinancialSummary ?? null,
      agentTimeline: item.agentTimeline ?? null,
      agentConfidence: item.agentConfidence ?? null,
      agentReasoning: item.agentReasoning ?? null,
      evaluatedAt: item.evaluatedAt
    });
  } catch (error) {
    console.error("Error fetching financial analysis:", error);
    return errorResponse(500, "Failed to retrieve financial analysis");
  }
}
async function handleFinancialAnalysisTrigger(claimId, event) {
  console.log("Handling financial-analysis-trigger for claimId:", claimId);
  const financialTimelineAgentEndpoint = process.env.FINANCIAL_TIMELINE_AGENT_ENDPOINT;
  if (!financialTimelineAgentEndpoint) {
    return successResponse(200, { message: "No financial timeline agent configured" });
  }
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const tenantId = body.tenantId || "local-dev-tenant";
    const modelId = body.modelId;
    console.log("Invoking Financial Timeline Agent for claim:", claimId);
    const financialResult = await invokeAgentCoreRuntime(financialTimelineAgentEndpoint, {
      claim_id: claimId,
      tenant_id: tenantId,
      model_id: modelId || void 0
    });
    if (!financialResult.error && !(financialResult.statusCode >= 400)) {
      await docClient2.send(new import_lib_dynamodb2.PutCommand({
        TableName: EVALUATION_RESULTS_TABLE,
        Item: {
          claimId,
          strategyKey: "financial-analysis#full-context",
          agentFinancialSummary: financialResult.financialSummary ?? null,
          agentTimeline: financialResult.timeline ?? null,
          agentConfidence: financialResult.confidence ?? null,
          agentReasoning: financialResult.reasoning ?? null,
          evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      }));
      console.log("Financial Timeline Agent result stored for polling", { claimId });
    } else {
      console.warn("Financial Timeline Agent returned error:", financialResult.error);
    }
  } catch (err) {
    console.error("Financial Timeline Agent trigger failed:", err);
  }
  return successResponse(200, { message: "Financial analysis trigger completed" });
}
async function handlePostSummary(claimId, request, tenantId) {
  const startTime = Date.now();
  if (!request.forceRegenerate && !request.customPrompt) {
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
  let promptInfo;
  let sourceDocumentsText = "";
  let financialSummary;
  let timeline;
  let agentFinancialSummary;
  let agentTimeline;
  let agentConfidence;
  let agentReasoning;
  let bdaFinancialSummary;
  let bdaTimeline;
  try {
    const patientId = await resolvePatientId(claimId, tenantId);
    if (request.strategy === "rag") {
      const useReranker = request.useReranker ?? false;
      console.log("Executing RAG strategy with chunkingMethod:", request.chunkingMethod, "useReranker:", useReranker);
      const ragResult = await executeRagStrategy(
        claimId,
        request.chunkingMethod || "semantic",
        useReranker,
        patientId,
        request.modelId
      );
      if (ragResult.documentCount === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }
      summary = ragResult.summary;
      anomalies = ragResult.anomalies;
      documentCount = ragResult.documentCount;
      promptInfo = ragResult.promptInfo;
    } else if (request.strategy === "graph-rag") {
      const useReranker = request.useReranker ?? false;
      console.log("Executing graph-rag strategy for claimId:", claimId, "useReranker:", useReranker);
      try {
        const graphRagResult = await executeGraphRagStrategy(claimId, useReranker, patientId, request.modelId);
        if (graphRagResult.documentCount === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        summary = graphRagResult.summary;
        anomalies = graphRagResult.anomalies;
        documentCount = graphRagResult.documentCount;
        promptInfo = graphRagResult.promptInfo;
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
        sourceDocumentsText = summarizable.map((d) => `--- ${d.fileName} ---
${d.extractedText || ""}`).join("\n\n");
        const result = await executeFullContextStrategy(claimId, tenantId, request.modelId);
        summary = result.summary;
        anomalies = result.anomalies;
        documentCount = result.documentCount;
        promptInfo = result.promptInfo;
      }
    } else if (request.strategy === "enriched") {
      console.log("Executing enriched strategy for claimId:", claimId);
      const enrichedResult = await executeEnrichedStrategy(claimId, tenantId, patientId, request.modelId);
      summary = enrichedResult.summary;
      anomalies = enrichedResult.anomalies;
      documentCount = enrichedResult.documentCount;
      promptInfo = enrichedResult.promptInfo;
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs.filter((d) => d.extractedText?.trim()).map((d) => `--- ${d.fileName} ---
${d.extractedText || ""}`).join("\n\n");
      } catch (e) {
        console.warn("Failed to fetch source documents for enriched evaluation:", e);
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
      console.log("Executing full-context strategy");
      const result = await executeFullContextStrategy(claimId, tenantId, request.modelId, request.customPrompt);
      summary = result.summary;
      anomalies = result.anomalies;
      documentCount = result.documentCount;
      promptInfo = result.promptInfo;
      financialSummary = result.financialSummary;
      timeline = result.timeline;
      agentFinancialSummary = result.agentFinancialSummary;
      agentTimeline = result.agentTimeline;
      agentConfidence = result.agentConfidence;
      agentReasoning = result.agentReasoning;
      bdaFinancialSummary = result.bdaFinancialSummary;
      bdaTimeline = result.bdaTimeline;
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs.filter((d) => d.extractedText?.trim()).map((d) => `--- ${d.fileName} ---
${d.extractedText || ""}`).join("\n\n");
      } catch (e) {
        console.warn("Failed to fetch source documents for evaluation:", e);
      }
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
    useReranker: request.strategy === "graph-rag" || request.strategy === "rag" ? request.useReranker : void 0,
    promptInfo,
    financialSummary,
    timeline,
    agentFinancialSummary: agentFinancialSummary ?? void 0,
    agentTimeline: agentTimeline ?? void 0,
    agentConfidence: agentConfidence ?? void 0,
    agentReasoning: agentReasoning ?? void 0,
    bdaFinancialSummary: bdaFinancialSummary ?? void 0,
    bdaTimeline: bdaTimeline ?? void 0
  };
  if (request.includeEvaluation) {
    const strategyKey = `${request.strategy}#${request.chunkingMethod || "none"}`;
    const evaluation = await getEvaluationScores(claimId, strategyKey);
    if (evaluation) {
      response.evaluation = evaluation;
    }
  }
  const evalTriggerFunction = process.env.EVALUATION_TRIGGER_FUNCTION;
  if (evalTriggerFunction) {
    if (!sourceDocumentsText) {
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs.filter((d) => d.extractedText?.trim()).map((d) => `--- ${d.fileName} ---
${d.extractedText || ""}`).join("\n\n");
      } catch (e) {
        console.warn("Failed to fetch source documents for evaluation:", e);
      }
    }
    try {
      const lambdaClient = new import_client_lambda.LambdaClient({ region: BEDROCK_REGION });
      await lambdaClient.send(new import_client_lambda.InvokeCommand({
        FunctionName: evalTriggerFunction,
        InvocationType: "Event",
        Payload: JSON.stringify({
          claimId,
          strategy: request.strategy,
          chunkingMethod: request.chunkingMethod || "none",
          summary,
          sourceDocuments: sourceDocumentsText.substring(0, 5e4),
          anomalies
        })
      }));
      console.log("Evaluation trigger invoked for claim:", claimId);
    } catch (evalError) {
      console.error("Failed to trigger evaluation (non-blocking):", evalError);
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
    if (event.httpMethod === "GET" && (event.path?.endsWith("/financial-analysis") || event.resource?.endsWith("/financial-analysis"))) {
      return handleGetFinancialAnalysis(claimId);
    }
    if (event.path?.endsWith("/financial-analysis-trigger")) {
      return handleFinancialAnalysisTrigger(claimId, event);
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
