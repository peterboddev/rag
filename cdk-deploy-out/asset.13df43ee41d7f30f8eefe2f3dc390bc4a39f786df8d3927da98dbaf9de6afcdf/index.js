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

// src/lambda/document-summary.ts
var document_summary_exports = {};
__export(document_summary_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(document_summary_exports);
var import_client_dynamodb2 = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb2 = require("@aws-sdk/lib-dynamodb");
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");

// src/services/chunking-configuration.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");

// src/types/index.ts
var SUPPORTED_CHUNKING_METHODS = [
  {
    id: "default",
    name: "Default Chunking",
    description: "AWS Bedrock default chunking strategy with automatic optimization",
    parameters: { strategy: "default" }
  },
  {
    id: "fixed_size_512",
    name: "Fixed Size (512 tokens)",
    description: "Fixed-size chunks with 512 token limit and 50 token overlap",
    parameters: {
      strategy: "fixed_size",
      chunkSize: 512,
      chunkOverlap: 50,
      maxTokens: 512
    }
  },
  {
    id: "fixed_size_1024",
    name: "Fixed Size (1024 tokens)",
    description: "Fixed-size chunks with 1024 token limit and 100 token overlap",
    parameters: {
      strategy: "fixed_size",
      chunkSize: 1024,
      chunkOverlap: 100,
      maxTokens: 1024
    }
  },
  {
    id: "semantic",
    name: "Semantic Chunking",
    description: "Chunks based on semantic boundaries and document structure",
    parameters: {
      strategy: "semantic",
      maxTokens: 800
    }
  },
  {
    id: "hierarchical",
    name: "Hierarchical Chunking",
    description: "Multi-level chunking for complex documents with nested structure",
    parameters: {
      strategy: "hierarchical",
      chunkSize: 1024,
      chunkOverlap: 200,
      maxTokens: 1024
    }
  }
];

// src/services/chunking-errors.ts
var ChunkingValidationError = class extends Error {
  constructor(message, details = {}) {
    super(message);
    this.code = "CHUNKING_VALIDATION_ERROR";
    this.name = "ChunkingValidationError";
    this.details = details;
  }
};
var DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5e3
};
function calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs) {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}
async function retryWithBackoff(operation, options = {}) {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === opts.maxRetries) break;
      if (error instanceof ChunkingValidationError) throw error;
      const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
function structuredLog(level, message, context) {
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    message,
    ...context
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// src/services/chunking-configuration.ts
var ChunkingConfigurationService = class {
  constructor() {
    this.dynamoClient = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: process.env.REGION }));
    this.customersTable = process.env.CUSTOMERS_TABLE_NAME;
  }
  /**
   * Get the current chunking configuration for a customer.
   * Retries DynamoDB reads with exponential backoff (Req 7.2).
   */
  async getCustomerChunkingConfig(customerUUID, tenantId) {
    const logCtx = { customerUUID, tenantId, operation: "getCustomerChunkingConfig" };
    try {
      structuredLog("info", "Getting chunking config for customer", logCtx);
      const result = await retryWithBackoff(
        () => this.dynamoClient.send(new import_lib_dynamodb.GetCommand({
          TableName: this.customersTable,
          Key: { uuid: customerUUID }
        })),
        { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5e3 }
      );
      if (!result.Item) {
        throw new Error(`Customer not found: ${customerUUID}`);
      }
      const customer = result.Item;
      if (customer.tenantId !== tenantId) {
        throw new Error(`Access denied: Customer belongs to different tenant`);
      }
      const chunkingMethod = customer.chunkingMethod || this.getDefaultChunkingMethod();
      structuredLog("info", "Retrieved chunking config", { ...logCtx, method: chunkingMethod.id });
      return chunkingMethod;
    } catch (error) {
      structuredLog("error", "Error getting customer chunking config", {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  /**
   * Update the chunking configuration for a customer.
   * Includes rollback on failure (Req 7.4) and validation (Req 7.3).
   */
  async updateCustomerChunkingConfig(customerUUID, tenantId, method) {
    const logCtx = { customerUUID, tenantId, operation: "updateCustomerChunkingConfig", newMethod: method.id };
    if (!this.validateChunkingMethod(method)) {
      throw new ChunkingValidationError(`Invalid chunking method: ${method.id}`, {
        methodId: method.id,
        strategy: method.parameters?.strategy
      });
    }
    let previousConfig;
    try {
      previousConfig = await this.getCustomerChunkingConfig(customerUUID, tenantId);
    } catch (error) {
      structuredLog("warn", "Could not retrieve previous config for rollback", {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    const configChanged = previousConfig.id !== method.id;
    try {
      structuredLog("info", "Updating chunking config", logCtx);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updateExpression = [
        "SET chunkingMethod = :method",
        "chunkingConfigVersion = if_not_exists(chunkingConfigVersion, :zero) + :one",
        "lastChunkingUpdate = :now",
        "updatedAt = :now"
      ];
      const expressionAttributeValues = {
        ":method": method,
        ":zero": 0,
        ":one": 1,
        ":now": now
      };
      if (configChanged) {
        updateExpression.push("chunkingCleanupStatus = :cleanupStatus");
        expressionAttributeValues[":cleanupStatus"] = "none";
        structuredLog("info", "Chunking method changed, cleanup will be required", {
          ...logCtx,
          oldMethod: previousConfig.id
        });
      }
      await retryWithBackoff(
        () => this.dynamoClient.send(new import_lib_dynamodb.UpdateCommand({
          TableName: this.customersTable,
          Key: { uuid: customerUUID },
          UpdateExpression: updateExpression.join(", "),
          ExpressionAttributeValues: {
            ...expressionAttributeValues,
            ":tenantId": tenantId
          },
          ExpressionAttributeNames: {
            "#uuid": "uuid",
            "#tenantId": "tenantId"
          },
          ConditionExpression: "attribute_exists(#uuid) AND #tenantId = :tenantId"
        })),
        { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5e3 }
      );
      structuredLog("info", "Successfully updated chunking config", { ...logCtx, configChanged });
    } catch (error) {
      structuredLog("error", "Failed to update chunking config, attempting rollback", {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      if (previousConfig) {
        try {
          await this.dynamoClient.send(new import_lib_dynamodb.UpdateCommand({
            TableName: this.customersTable,
            Key: { uuid: customerUUID },
            UpdateExpression: "SET chunkingMethod = :method, updatedAt = :now",
            ExpressionAttributeValues: {
              ":method": previousConfig,
              ":now": (/* @__PURE__ */ new Date()).toISOString(),
              ":tenantId": tenantId
            },
            ExpressionAttributeNames: {
              "#uuid": "uuid",
              "#tenantId": "tenantId"
            },
            ConditionExpression: "attribute_exists(#uuid) AND #tenantId = :tenantId"
          }));
          structuredLog("info", "Rollback successful, restored previous config", {
            ...logCtx,
            restoredMethod: previousConfig.id
          });
        } catch (rollbackError) {
          structuredLog("error", "Rollback failed \u2014 manual intervention may be required", {
            ...logCtx,
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }
      throw error;
    }
  }
  /**
   * Get all available chunking methods
   */
  async getAvailableChunkingMethods() {
    return [...SUPPORTED_CHUNKING_METHODS];
  }
  /**
   * Validate a chunking method against supported options
   */
  validateChunkingMethod(method) {
    try {
      const supportedMethod = SUPPORTED_CHUNKING_METHODS.find((m) => m.id === method.id);
      if (!supportedMethod) {
        console.warn("Unsupported chunking method ID", { methodId: method.id });
        return false;
      }
      if (!method.name || !method.description || !method.parameters) {
        console.warn("Invalid chunking method structure", { method });
        return false;
      }
      const { parameters } = method;
      switch (parameters.strategy) {
        case "fixed_size":
          if (!parameters.chunkSize || parameters.chunkSize <= 0) {
            console.warn("Invalid chunk size for fixed_size strategy", { parameters });
            return false;
          }
          if (parameters.chunkOverlap && parameters.chunkOverlap >= parameters.chunkSize) {
            console.warn("Chunk overlap must be less than chunk size", { parameters });
            return false;
          }
          break;
        case "semantic":
        case "hierarchical":
          if (parameters.maxTokens && parameters.maxTokens <= 0) {
            console.warn("Invalid max tokens for semantic/hierarchical strategy", { parameters });
            return false;
          }
          break;
        case "default":
          break;
        default:
          console.warn("Unknown chunking strategy", { strategy: parameters.strategy });
          return false;
      }
      return true;
    } catch (error) {
      console.error("Error validating chunking method:", error);
      return false;
    }
  }
  /**
   * Get the default chunking method
   */
  getDefaultChunkingMethod() {
    return SUPPORTED_CHUNKING_METHODS.find((m) => m.id === "default");
  }
  /**
   * Check if a customer needs embedding cleanup
   */
  async needsEmbeddingCleanup(customerUUID, tenantId) {
    try {
      const result = await this.dynamoClient.send(new import_lib_dynamodb.GetCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        }
      }));
      if (!result.Item) {
        return false;
      }
      const customer = result.Item;
      if (customer.tenantId !== tenantId) {
        return false;
      }
      return customer.chunkingCleanupStatus === "none" && customer.chunkingMethod !== void 0 && customer.lastChunkingUpdate !== void 0;
    } catch (error) {
      console.error("Error checking cleanup status:", error);
      return false;
    }
  }
  /**
   * Update cleanup status for a customer
   */
  async updateCleanupStatus(customerUUID, tenantId, status) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const updateExpression = "SET chunkingCleanupStatus = :status, updatedAt = :now";
      const expressionAttributeValues = {
        ":status": status,
        ":now": now,
        ":tenantId": tenantId
      };
      if (status === "completed") {
        updateExpression.replace("SET", "SET lastCleanupAt = :now,");
      }
      await this.dynamoClient.send(new import_lib_dynamodb.UpdateCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: {
          "#uuid": "uuid",
          "#tenantId": "tenantId"
        },
        ConditionExpression: "attribute_exists(#uuid) AND #tenantId = :tenantId"
        // Ensure customer exists and belongs to tenant
      }));
      console.log("Updated cleanup status", { customerUUID, status });
    } catch (error) {
      console.error("Error updating cleanup status:", error);
      throw error;
    }
  }
};

// src/services/token-estimation.ts
var TokenEstimationService = class {
  constructor() {
    this.DEFAULT_CHAR_TO_TOKEN_RATIO = 4;
    this.PROMPT_OVERHEAD_TOKENS = 150;
    // Conservative estimate for system prompts
    this.MIN_CONTENT_TOKENS = 50;
  }
  // Minimum tokens to reserve for content
  /**
   * Estimate token count for text content using conservative ratio
   */
  estimateTokens(text) {
    if (!text || text.trim().length === 0) {
      return 0;
    }
    const estimatedTokens = Math.ceil(text.length / this.DEFAULT_CHAR_TO_TOKEN_RATIO);
    console.log("Token estimation", {
      textLength: text.length,
      estimatedTokens,
      ratio: this.DEFAULT_CHAR_TO_TOKEN_RATIO
    });
    return estimatedTokens;
  }
  /**
   * Calculate available tokens for content after accounting for prompt overhead
   */
  calculateAvailableTokens(maxTokens, promptOverhead) {
    const overhead = promptOverhead || this.PROMPT_OVERHEAD_TOKENS;
    const availableTokens = Math.max(this.MIN_CONTENT_TOKENS, maxTokens - overhead);
    console.log("Available tokens calculation", {
      maxTokens,
      promptOverhead: overhead,
      availableTokens,
      utilizationPercentage: availableTokens / maxTokens * 100
    });
    return availableTokens;
  }
  /**
   * Distribute tokens across multiple documents based on length and optional weights
   */
  distributeTokens(documents, totalTokens, weights) {
    if (documents.length === 0) {
      return /* @__PURE__ */ new Map();
    }
    const distribution = /* @__PURE__ */ new Map();
    const documentLengths = /* @__PURE__ */ new Map();
    let totalLength = 0;
    for (const doc of documents) {
      const textLength = doc.extractedText?.length || 0;
      documentLengths.set(doc.documentId, textLength);
      totalLength += textLength;
    }
    if (totalLength === 0) {
      const tokensPerDoc = Math.floor(totalTokens / documents.length);
      for (const doc of documents) {
        distribution.set(doc.documentId, tokensPerDoc);
      }
      return distribution;
    }
    let remainingTokens = totalTokens;
    const processedDocs = /* @__PURE__ */ new Set();
    for (const doc of documents) {
      if (processedDocs.size === documents.length - 1) {
        distribution.set(doc.documentId, remainingTokens);
        break;
      }
      const baseWeight = documentLengths.get(doc.documentId) / totalLength;
      const customWeight = weights?.get(doc.documentId) || 1;
      const finalWeight = baseWeight * customWeight;
      const allocatedTokens = Math.max(
        this.MIN_CONTENT_TOKENS,
        Math.floor(totalTokens * finalWeight)
      );
      distribution.set(doc.documentId, allocatedTokens);
      remainingTokens -= allocatedTokens;
      processedDocs.add(doc.documentId);
    }
    console.log("Token distribution completed", {
      totalTokens,
      documentCount: documents.length,
      distribution: Array.from(distribution.entries()),
      hasCustomWeights: weights !== void 0
    });
    return distribution;
  }
  /**
   * Get token usage information for monitoring and reporting
   */
  getTokenUsageInfo(maxTokensAllowed, tokensUsed, promptOverhead) {
    const contentTokens = tokensUsed - promptOverhead;
    const utilizationPercentage = tokensUsed / maxTokensAllowed * 100;
    return {
      maxTokensAllowed,
      tokensUsed,
      promptOverhead,
      contentTokens,
      utilizationPercentage: Math.round(utilizationPercentage * 100) / 100
    };
  }
  /**
   * Check if content fits within token limit
   */
  fitsWithinLimit(text, tokenLimit) {
    const estimatedTokens = this.estimateTokens(text);
    return estimatedTokens <= tokenLimit;
  }
  /**
   * Get conservative token estimate (err on the side of caution)
   */
  getConservativeEstimate(text) {
    const conservativeRatio = 3.5;
    return Math.ceil(text.length / conservativeRatio);
  }
};

// src/services/text-truncation.ts
var TextTruncationService = class {
  constructor() {
    this.tokenEstimator = new TokenEstimationService();
  }
  /**
   * Truncate text to fit within token limit using specified strategy
   */
  truncateToTokenLimit(text, tokenLimit, strategy = "beginning_and_end" /* BEGINNING_AND_END */) {
    if (!text || text.trim().length === 0) {
      return {
        content: "",
        originalLength: 0,
        truncatedLength: 0,
        truncationPoints: [],
        preservedSentences: 0
      };
    }
    const originalLength = text.length;
    const estimatedTokens = this.tokenEstimator.estimateTokens(text);
    if (estimatedTokens <= tokenLimit) {
      return {
        content: text,
        originalLength,
        truncatedLength: originalLength,
        truncationPoints: [],
        preservedSentences: this.countSentences(text)
      };
    }
    console.log("Truncating text", {
      originalLength,
      estimatedTokens,
      tokenLimit,
      strategy
    });
    let truncatedContent;
    let truncationPoints = [];
    switch (strategy) {
      case "beginning_only" /* BEGINNING_ONLY */:
        ({ content: truncatedContent, truncationPoints } = this.truncateFromBeginning(text, tokenLimit));
        break;
      case "beginning_and_end" /* BEGINNING_AND_END */:
        ({ content: truncatedContent, truncationPoints } = this.truncateBeginningAndEnd(text, tokenLimit));
        break;
      case "smart_excerpt" /* SMART_EXCERPT */:
        ({ content: truncatedContent, truncationPoints } = this.extractSmartExcerpt(text, tokenLimit));
        break;
      case "proportional" /* PROPORTIONAL */:
        ({ content: truncatedContent, truncationPoints } = this.truncateProportionally(text, tokenLimit));
        break;
      default:
        ({ content: truncatedContent, truncationPoints } = this.truncateBeginningAndEnd(text, tokenLimit));
    }
    return {
      content: truncatedContent,
      originalLength,
      truncatedLength: truncatedContent.length,
      truncationPoints,
      preservedSentences: this.countSentences(truncatedContent)
    };
  }
  /**
   * Truncate multiple documents according to token distribution
   */
  truncateMultipleDocuments(documents, tokenDistribution) {
    const results = /* @__PURE__ */ new Map();
    for (const doc of documents) {
      const allocatedTokens = tokenDistribution.get(doc.documentId) || 0;
      const text = doc.extractedText || "";
      if (allocatedTokens > 0 && text.length > 0) {
        const truncated = this.truncateToTokenLimit(
          text,
          allocatedTokens,
          "beginning_and_end" /* BEGINNING_AND_END */
        );
        results.set(doc.documentId, truncated);
      } else {
        results.set(doc.documentId, {
          content: "",
          originalLength: text.length,
          truncatedLength: 0,
          truncationPoints: [],
          preservedSentences: 0
        });
      }
    }
    console.log("Multi-document truncation completed", {
      documentCount: documents.length,
      totalAllocatedTokens: Array.from(tokenDistribution.values()).reduce((sum, tokens) => sum + tokens, 0),
      documentsWithContent: Array.from(results.values()).filter((r) => r.content.length > 0).length
    });
    return results;
  }
  /**
   * Truncate from beginning only, preserving sentence boundaries
   */
  truncateFromBeginning(text, tokenLimit) {
    const sentences = this.splitIntoSentences(text);
    let content = "";
    let currentTokens = 0;
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (currentTokens + sentenceTokens <= tokenLimit) {
        content += sentence;
        currentTokens += sentenceTokens;
      } else {
        if (i < sentences.length - 1) {
          content += "\n\n[Content truncated - additional text omitted]";
        }
        break;
      }
    }
    const truncationPoints = content.includes("[Content truncated") ? [{ position: content.indexOf("[Content truncated"), type: "end_truncation" }] : [];
    return { content, truncationPoints };
  }
  /**
   * Truncate from beginning and end, preserving most important content
   */
  truncateBeginningAndEnd(text, tokenLimit) {
    const sentences = this.splitIntoSentences(text);
    if (sentences.length <= 2) {
      return this.truncateFromBeginning(text, tokenLimit);
    }
    const beginningTokens = Math.floor(tokenLimit * 0.6);
    const endTokens = Math.floor(tokenLimit * 0.3);
    const indicatorTokens = tokenLimit - beginningTokens - endTokens;
    let beginningContent = "";
    let beginningCurrentTokens = 0;
    let beginningEndIndex = 0;
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (beginningCurrentTokens + sentenceTokens <= beginningTokens) {
        beginningContent += sentence;
        beginningCurrentTokens += sentenceTokens;
        beginningEndIndex = i;
      } else {
        break;
      }
    }
    let endingContent = "";
    let endingCurrentTokens = 0;
    let endingStartIndex = sentences.length;
    for (let i = sentences.length - 1; i > beginningEndIndex; i--) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (endingCurrentTokens + sentenceTokens <= endTokens) {
        endingContent = sentence + endingContent;
        endingCurrentTokens += sentenceTokens;
        endingStartIndex = i;
      } else {
        break;
      }
    }
    const truncationIndicator = "\n\n[Content truncated - middle section omitted]\n\n";
    const content = beginningContent + truncationIndicator + endingContent;
    const truncationPoints = [{
      position: beginningContent.length,
      type: "middle_truncation"
    }];
    return { content, truncationPoints };
  }
  /**
   * Extract smart excerpt focusing on most relevant content
   */
  extractSmartExcerpt(text, tokenLimit) {
    return this.truncateBeginningAndEnd(text, tokenLimit);
  }
  /**
   * Truncate proportionally across the document
   */
  truncateProportionally(text, tokenLimit) {
    const sentences = this.splitIntoSentences(text);
    const totalSentences = sentences.length;
    if (totalSentences <= 3) {
      return this.truncateFromBeginning(text, tokenLimit);
    }
    const avgTokensPerSentence = this.tokenEstimator.estimateTokens(text) / totalSentences;
    const maxSentences = Math.floor(tokenLimit / avgTokensPerSentence);
    if (maxSentences >= totalSentences) {
      return { content: text, truncationPoints: [] };
    }
    const step = totalSentences / maxSentences;
    let content = "";
    const truncationPoints = [];
    for (let i = 0; i < maxSentences; i++) {
      const sentenceIndex = Math.floor(i * step);
      if (sentenceIndex < sentences.length) {
        if (i > 0 && sentenceIndex > Math.floor((i - 1) * step) + 1) {
          content += "\n[...]\n";
          truncationPoints.push({
            position: content.length - 6,
            type: "section_skip"
          });
        }
        content += sentences[sentenceIndex];
      }
    }
    return { content, truncationPoints };
  }
  /**
   * Split text into sentences while preserving boundaries
   */
  splitIntoSentences(text) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().length > 0).map((sentence) => sentence.trim() + (sentence.endsWith(".") || sentence.endsWith("!") || sentence.endsWith("?") ? "" : ".") + " ");
    return sentences;
  }
  /**
   * Count sentences in text
   */
  countSentences(text) {
    return this.splitIntoSentences(text).length;
  }
  /**
   * Add truncation indicators to inform AI model
   */
  addTruncationIndicators(content, truncationInfo) {
    if (truncationInfo.documentsTruncated === 0) {
      return content;
    }
    const indicator = `

[IMPORTANT: This content has been truncated. Original content was ${truncationInfo.totalOriginalTokens} tokens, processed to ${truncationInfo.totalProcessedTokens} tokens. ${truncationInfo.documentsTruncated} of ${truncationInfo.documentsProcessed} documents were truncated to fit within token limits.]

`;
    return indicator + content;
  }
};

// src/services/content-prioritization.ts
var ContentPrioritizationService = class {
  constructor() {
    this.tokenEstimator = new TokenEstimationService();
  }
  /**
   * Prioritize documents based on various criteria
   */
  prioritizeDocuments(documents, criteria) {
    const priorities = [];
    for (const doc of documents) {
      const priority = this.calculateDocumentPriority(doc, criteria);
      priorities.push(priority);
    }
    priorities.sort((a, b) => {
      if (Math.abs(a.priority - b.priority) < 1e-3) {
        return a.documentId.localeCompare(b.documentId);
      }
      return b.priority - a.priority;
    });
    console.log("Document prioritization completed", {
      documentCount: documents.length,
      criteria,
      topDocument: priorities[0]?.documentId,
      topPriority: priorities[0]?.priority
    });
    return priorities;
  }
  /**
   * Extract key content from a document within token limits
   */
  extractKeyContent(document, tokenLimit) {
    const text = document.extractedText || "";
    if (!text || text.trim().length === 0) {
      return {
        documentId: document.documentId,
        fileName: document.fileName,
        keyContent: "",
        metadata: this.extractDocumentMetadata(document),
        contentSummary: "No text content available",
        tokenUsage: 0
      };
    }
    const estimatedTokens = this.tokenEstimator.estimateTokens(text);
    if (estimatedTokens <= tokenLimit) {
      return {
        documentId: document.documentId,
        fileName: document.fileName,
        keyContent: text,
        metadata: this.extractDocumentMetadata(document),
        contentSummary: this.generateContentSummary(text),
        tokenUsage: estimatedTokens
      };
    }
    if (tokenLimit < 200) {
      return this.extractMetadataOnly(document, tokenLimit);
    }
    const keyContent = this.extractKeyExcerpts(text, tokenLimit);
    return {
      documentId: document.documentId,
      fileName: document.fileName,
      keyContent,
      metadata: this.extractDocumentMetadata(document),
      contentSummary: this.generateContentSummary(keyContent),
      tokenUsage: this.tokenEstimator.estimateTokens(keyContent)
    };
  }
  /**
   * Calculate priority score for a document
   */
  calculateDocumentPriority(document, criteria) {
    let score = 0;
    const reasoning = [];
    const recencyScore = this.calculateRecencyScore(document.createdAt);
    score += recencyScore * criteria.recencyWeight;
    if (recencyScore > 0.7) {
      reasoning.push("recent document");
    }
    const sizeScore = this.calculateSizeScore(document.extractedText?.length || 0);
    score += sizeScore * criteria.sizeWeight;
    if (sizeScore > 0.8) {
      reasoning.push("optimal content length");
    }
    const contentTypeScore = this.calculateContentTypeScore(document.contentType);
    score += contentTypeScore * criteria.contentTypeWeight;
    if (contentTypeScore > 0.8) {
      reasoning.push("high-value content type");
    }
    const qualityScore = this.calculateProcessingQualityScore(document);
    score += qualityScore * criteria.processingQualityWeight;
    if (qualityScore > 0.8) {
      reasoning.push("high processing quality");
    }
    const baseTokens = 200;
    const priorityMultiplier = Math.max(0.5, Math.min(2, score));
    const recommendedTokens = Math.floor(baseTokens * priorityMultiplier);
    return {
      documentId: document.documentId,
      priority: Math.round(score * 1e3) / 1e3,
      // Use 3 decimal places for better precision
      reasoning: reasoning.join(", ") || "standard priority",
      recommendedTokens
    };
  }
  /**
   * Calculate recency score (0-1) based on document creation date
   */
  calculateRecencyScore(createdAt) {
    const now = /* @__PURE__ */ new Date();
    const created = new Date(createdAt);
    const daysDiff = (now.getTime() - created.getTime()) / (1e3 * 60 * 60 * 24);
    if (daysDiff <= 1) return 1;
    if (daysDiff <= 7) return 0.9;
    if (daysDiff <= 30) return 0.7;
    if (daysDiff <= 90) return 0.5;
    if (daysDiff <= 365) return 0.3;
    return 0.1;
  }
  /**
   * Calculate size score (0-1) based on content length
   */
  calculateSizeScore(textLength) {
    if (textLength === 0) return 0;
    if (textLength >= 1e3 && textLength <= 5e3) return 1;
    if (textLength >= 500 && textLength <= 1e4) return 0.8;
    if (textLength >= 100 && textLength <= 2e4) return 0.6;
    if (textLength < 100) return 0.2;
    return 0.4;
  }
  /**
   * Calculate content type score (0-1) based on file type
   */
  calculateContentTypeScore(contentType) {
    switch (contentType) {
      case "application/pdf":
        return 0.9;
      // PDFs often contain structured, important content
      case "application/msword":
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return 0.8;
      // Word documents are typically well-structured
      case "text/plain":
        return 0.7;
      // Plain text is reliable but may lack structure
      case "image/jpeg":
      case "image/png":
      case "image/tiff":
        return 0.6;
      // Images depend on OCR quality
      default:
        return 0.5;
    }
  }
  /**
   * Calculate processing quality score (0-1) based on processing metadata
   */
  calculateProcessingQualityScore(document) {
    if (document.processingStatus !== "completed") {
      return 0;
    }
    let score = 0.5;
    const confidence = document.processingMetadata?.confidence || 0;
    score += confidence / 100 * 0.3;
    if (document.extractedText && document.extractedText.length > 0) {
      score += 0.2;
    }
    if (!document.errorMessage && !document.processingMetadata?.errorDetails) {
      score += 0.1;
    }
    const processingTime = document.processingMetadata?.processingDurationMs || 0;
    if (processingTime > 0 && processingTime < 3e4) {
      score += 0.1;
    }
    return Math.min(1, score);
  }
  /**
   * Extract document metadata for restrictive token limits
   */
  extractMetadataOnly(document, tokenLimit) {
    const metadata = this.extractDocumentMetadata(document);
    const metadataText = `Document: ${document.fileName}
Type: ${document.contentType}
Created: ${document.createdAt}
Status: ${document.processingStatus}`;
    let content = metadataText;
    const metadataTokens = this.tokenEstimator.estimateTokens(metadataText);
    const remainingTokens = tokenLimit - metadataTokens;
    if (remainingTokens > 20 && document.extractedText) {
      const preview = document.extractedText.substring(0, remainingTokens * 3);
      content += `
Preview: ${preview}...`;
    }
    return {
      documentId: document.documentId,
      fileName: document.fileName,
      keyContent: content,
      metadata,
      contentSummary: "Metadata only due to token constraints",
      tokenUsage: this.tokenEstimator.estimateTokens(content)
    };
  }
  /**
   * Extract key excerpts from text within token limits
   */
  extractKeyExcerpts(text, tokenLimit) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    if (sentences.length <= 2) {
      const maxChars = tokenLimit * 4;
      if (text.length <= maxChars) {
        return text;
      }
      return text.substring(0, maxChars) + "...";
    }
    const truncationMarker = "\n[...content truncated...]\n";
    const truncationTokens = this.tokenEstimator.estimateTokens(truncationMarker);
    const availableTokens = tokenLimit - truncationTokens;
    const beginningTokens = Math.floor(availableTokens * 0.7);
    const endTokens = availableTokens - beginningTokens;
    let beginning = "";
    let beginningCurrentTokens = 0;
    for (const sentence of sentences) {
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (beginningCurrentTokens + sentenceTokens <= beginningTokens) {
        beginning += sentence + " ";
        beginningCurrentTokens += sentenceTokens;
      } else {
        break;
      }
    }
    let ending = "";
    let endingCurrentTokens = 0;
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentence = sentences[i];
      const sentenceTokens = this.tokenEstimator.estimateTokens(sentence);
      if (endingCurrentTokens + sentenceTokens <= endTokens) {
        ending = sentence + " " + ending;
        endingCurrentTokens += sentenceTokens;
      } else {
        break;
      }
    }
    if (beginning.trim() && ending.trim()) {
      return beginning.trim() + truncationMarker + ending.trim();
    }
    return beginning.trim() || ending.trim();
  }
  /**
   * Extract document metadata
   */
  extractDocumentMetadata(document) {
    return {
      fileName: document.fileName,
      contentType: document.contentType,
      createdAt: document.createdAt,
      processingStatus: document.processingStatus,
      textLength: document.textLength || 0,
      pageCount: document.processingMetadata?.pageCount || 1,
      confidence: document.processingMetadata?.confidence || 0,
      hasErrors: !!(document.errorMessage || document.processingMetadata?.errorDetails)
    };
  }
  /**
   * Generate a brief content summary
   */
  generateContentSummary(text) {
    if (!text || text.length === 0) {
      return "No content";
    }
    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    return `${words} words, ${sentences} sentences`;
  }
};

// src/services/token-aware-summarization.ts
var TokenAwareSummarizationService = class {
  // 5 minutes
  constructor() {
    this.CACHE_TTL_MS = 5 * 60 * 1e3;
    this.chunkingService = new ChunkingConfigurationService();
    this.tokenEstimator = new TokenEstimationService();
    this.textTruncator = new TextTruncationService();
    this.contentPrioritizer = new ContentPrioritizationService();
    this.configCache = /* @__PURE__ */ new Map();
  }
  /**
   * Generate token-aware summary for documents
   */
  async generateSummary(documents, customerUUID, tenantId, options) {
    const startTime = Date.now();
    const processingMetadata = {
      chunkingConfigRetrievalTime: 0,
      tokenEstimationTime: 0,
      textProcessingTime: 0,
      summaryGenerationTime: 0,
      totalProcessingTime: 0,
      fallbacksUsed: [],
      cacheHits: 0
    };
    try {
      console.log("Starting token-aware summarization", {
        customerUUID,
        tenantId,
        documentCount: documents.length,
        options
      });
      const configStartTime = Date.now();
      const chunkingConfig = await this.getChunkingConfiguration(customerUUID, tenantId, processingMetadata);
      processingMetadata.chunkingConfigRetrievalTime = Date.now() - configStartTime;
      const maxTokens = options?.maxTokensOverride || chunkingConfig.parameters.maxTokens || 1e3;
      const availableTokens = this.tokenEstimator.calculateAvailableTokens(maxTokens);
      console.log("Token limits determined", {
        maxTokens,
        availableTokens,
        chunkingMethod: chunkingConfig.id
      });
      const processedDocuments = documents.filter(
        (doc) => doc.processingStatus === "completed" && doc.extractedText && doc.extractedText.trim().length > 0
      );
      if (processedDocuments.length === 0) {
        return this.createEmptyResult(documents, maxTokens, processingMetadata, startTime);
      }
      const textProcessingStartTime = Date.now();
      const prioritizationCriteria = {
        recencyWeight: options?.prioritizeRecent ? 0.4 : 0.2,
        sizeWeight: 0.3,
        contentTypeWeight: 0.3,
        processingQualityWeight: 0.2
      };
      const documentPriorities = this.contentPrioritizer.prioritizeDocuments(
        processedDocuments,
        prioritizationCriteria
      );
      const tokenEstimationStartTime = Date.now();
      const tokenDistribution = this.distributeTokensByPriority(
        processedDocuments,
        documentPriorities,
        availableTokens
      );
      processingMetadata.tokenEstimationTime = Date.now() - tokenEstimationStartTime;
      const truncatedTexts = this.textTruncator.truncateMultipleDocuments(
        processedDocuments,
        tokenDistribution
      );
      processingMetadata.textProcessingTime = Date.now() - textProcessingStartTime;
      const truncationInfo = this.buildTruncationInfo(
        processedDocuments,
        truncatedTexts,
        "beginning_and_end" /* BEGINNING_AND_END */
      );
      const totalProcessedTokens = Array.from(truncatedTexts.values()).reduce((sum, text) => sum + this.tokenEstimator.estimateTokens(text.content), 0);
      const tokenUsage = this.tokenEstimator.getTokenUsageInfo(
        maxTokens,
        totalProcessedTokens + 150,
        // Add prompt overhead
        150
      );
      const combinedContent = this.combineDocumentContent(processedDocuments, truncatedTexts);
      const contentWithIndicators = this.textTruncator.addTruncationIndicators(combinedContent, truncationInfo);
      processingMetadata.totalProcessingTime = Date.now() - startTime;
      return {
        processedContent: contentWithIndicators,
        tokenUsage,
        truncationInfo,
        chunkingMethod: chunkingConfig,
        processingMetadata,
        documentCount: documents.length,
        processedDocumentCount: processedDocuments.length
      };
    } catch (error) {
      console.error("Error in token-aware summarization:", error);
      processingMetadata.fallbacksUsed.push("default_summarization");
      processingMetadata.totalProcessingTime = Date.now() - startTime;
      return this.createFallbackResult(documents, error, processingMetadata, startTime);
    }
  }
  /**
   * Generate token-aware summary for selected documents with optional weighting
   */
  async generateSelectiveSummary(documents, customerUUID, tenantId, documentWeights) {
    const options = {
      prioritizeRecent: false,
      // Use explicit weighting instead
      includeMetadata: true
    };
    const result = await this.generateSummary(documents, customerUUID, tenantId, options);
    if (documentWeights && documentWeights.size > 0) {
      result.processingMetadata.fallbacksUsed.push("custom_weighting_applied");
      console.log("Applied custom document weighting", {
        weightCount: documentWeights.size,
        weights: Array.from(documentWeights.entries())
      });
    }
    return result;
  }
  /**
   * Get chunking configuration with caching
   */
  async getChunkingConfiguration(customerUUID, tenantId, processingMetadata) {
    const cacheKey = `${customerUUID}:${tenantId}`;
    const cached = this.configCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      processingMetadata.cacheHits++;
      console.log("Using cached chunking configuration", { customerUUID });
      return cached.config;
    }
    try {
      const config = await this.chunkingService.getCustomerChunkingConfig(customerUUID, tenantId);
      this.configCache.set(cacheKey, {
        config,
        timestamp: Date.now()
      });
      return config;
    } catch (error) {
      console.warn("Failed to retrieve chunking configuration, using default", { error });
      processingMetadata.fallbacksUsed.push("default_chunking_config");
      return {
        id: "default",
        name: "Default Chunking",
        description: "Default chunking with 1000 token limit",
        parameters: { strategy: "default", maxTokens: 1e3 }
      };
    }
  }
  /**
   * Distribute tokens based on document priorities
   */
  distributeTokensByPriority(documents, priorities, totalTokens) {
    const weights = /* @__PURE__ */ new Map();
    for (const priority of priorities) {
      weights.set(priority.documentId, priority.priority);
    }
    return this.tokenEstimator.distributeTokens(documents, totalTokens, weights);
  }
  /**
   * Build truncation information for reporting
   */
  buildTruncationInfo(documents, truncatedTexts, strategy) {
    const truncationDetails = [];
    let totalOriginalTokens = 0;
    let totalProcessedTokens = 0;
    let documentsTruncated = 0;
    for (const doc of documents) {
      const truncated = truncatedTexts.get(doc.documentId);
      if (truncated) {
        const originalTokens = this.tokenEstimator.estimateTokens(doc.extractedText || "");
        const processedTokens = this.tokenEstimator.estimateTokens(truncated.content);
        totalOriginalTokens += originalTokens;
        totalProcessedTokens += processedTokens;
        if (originalTokens > processedTokens) {
          documentsTruncated++;
        }
        truncationDetails.push({
          documentId: doc.documentId,
          fileName: doc.fileName,
          originalTokens,
          processedTokens,
          truncationPercentage: originalTokens > 0 ? (originalTokens - processedTokens) / originalTokens * 100 : 0,
          contentPreserved: truncated.truncationPoints.length > 0 ? ["beginning", "end"] : ["full"]
        });
      }
    }
    return {
      documentsProcessed: documents.length,
      documentsTruncated,
      totalOriginalTokens,
      totalProcessedTokens,
      truncationStrategy: strategy,
      truncationDetails
    };
  }
  /**
   * Combine document content for summarization
   */
  combineDocumentContent(documents, truncatedTexts) {
    const contentParts = [];
    for (const doc of documents) {
      const truncated = truncatedTexts.get(doc.documentId);
      if (truncated && truncated.content.trim().length > 0) {
        contentParts.push(`Document: ${doc.fileName}
Content: ${truncated.content}`);
      }
    }
    return contentParts.join("\n\n---\n\n");
  }
  /**
   * Create empty result when no documents are available
   */
  createEmptyResult(documents, maxTokens, processingMetadata, startTime) {
    processingMetadata.totalProcessingTime = Date.now() - startTime;
    return {
      processedContent: "No processed documents available for summarization.",
      tokenUsage: this.tokenEstimator.getTokenUsageInfo(maxTokens, 0, 0),
      truncationInfo: {
        documentsProcessed: documents.length,
        documentsTruncated: 0,
        totalOriginalTokens: 0,
        totalProcessedTokens: 0,
        truncationStrategy: "beginning_and_end" /* BEGINNING_AND_END */,
        truncationDetails: []
      },
      chunkingMethod: {
        id: "default",
        name: "Default",
        description: "Default configuration",
        parameters: { strategy: "default", maxTokens }
      },
      processingMetadata,
      documentCount: documents.length,
      processedDocumentCount: 0
    };
  }
  /**
   * Create fallback result when errors occur
   */
  createFallbackResult(documents, error, processingMetadata, startTime) {
    processingMetadata.totalProcessingTime = Date.now() - startTime;
    const fallbackContent = documents.filter((doc) => doc.extractedText).map((doc) => `Document: ${doc.fileName}
Content: ${doc.extractedText?.substring(0, 2e3) || "No content"}`).join("\n\n---\n\n");
    return {
      processedContent: fallbackContent,
      tokenUsage: this.tokenEstimator.getTokenUsageInfo(1e3, 0, 0),
      truncationInfo: {
        documentsProcessed: documents.length,
        documentsTruncated: 0,
        totalOriginalTokens: 0,
        totalProcessedTokens: 0,
        truncationStrategy: "beginning_and_end" /* BEGINNING_AND_END */,
        truncationDetails: []
      },
      chunkingMethod: {
        id: "fallback",
        name: "Fallback",
        description: "Fallback configuration due to error",
        parameters: { strategy: "default", maxTokens: 1e3 }
      },
      processingMetadata,
      documentCount: documents.length,
      processedDocumentCount: documents.filter((doc) => doc.extractedText).length
    };
  }
};

// src/services/document-summary-filter.ts
var MIN_TEXT_LENGTH = 10;
var MIN_CONFIDENCE_SCORE = 50;
function validateTextQuality(doc) {
  if (!doc.extractedText || doc.extractedText.trim().length === 0) {
    return { valid: false, reason: "No extracted text available" };
  }
  if (doc.extractedText.trim().length < MIN_TEXT_LENGTH) {
    return { valid: false, reason: `Extracted text too short (${doc.extractedText.trim().length} chars, minimum ${MIN_TEXT_LENGTH})` };
  }
  const confidence = doc.processingMetadata?.confidence;
  if (confidence !== void 0 && confidence !== null && confidence < MIN_CONFIDENCE_SCORE) {
    return { valid: false, reason: `Text confidence too low (${confidence}%, minimum ${MIN_CONFIDENCE_SCORE}%)` };
  }
  return { valid: true };
}
function filterDocumentsForSummary(documents) {
  const includedDocuments = [];
  const excludedDocuments = [];
  for (const doc of documents) {
    if (doc.processingStatus !== "completed") {
      const statusReasons = {
        queued: "Document is queued for processing",
        processing: "Document is still being processed",
        failed: "Document processing failed"
      };
      excludedDocuments.push({
        documentId: doc.documentId,
        fileName: doc.fileName,
        reason: statusReasons[doc.processingStatus] || `Unexpected status: ${doc.processingStatus}`,
        processingStatus: doc.processingStatus
      });
      continue;
    }
    const quality = validateTextQuality(doc);
    if (!quality.valid) {
      excludedDocuments.push({
        documentId: doc.documentId,
        fileName: doc.fileName,
        reason: quality.reason,
        processingStatus: doc.processingStatus
      });
      continue;
    }
    includedDocuments.push(doc);
  }
  return { includedDocuments, excludedDocuments };
}
function isCacheStale(documents, cacheTimestamp) {
  return documents.some((doc) => {
    const docUpdatedAt = new Date(doc.updatedAt).getTime();
    return docUpdatedAt > cacheTimestamp;
  });
}

// src/lambda/document-summary.ts
var dynamoClient = import_lib_dynamodb2.DynamoDBDocumentClient.from(new import_client_dynamodb2.DynamoDBClient({ region: process.env.REGION }));
var bedrockClient = new import_client_bedrock_runtime.BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.REGION });
var tokenAwareSummarizer = new TokenAwareSummarizationService();
var CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME;
var DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME;
var SUMMARY_CACHE_TABLE = process.env.SUMMARY_CACHE_TABLE_NAME || "rag-app-v2-summary-cache-dev";
var SUMMARY_CACHE_TTL_MS = 5 * 60 * 1e3;
var SUMMARY_CACHE_TTL_SECONDS = 300;
var summaryCache = /* @__PURE__ */ new Map();
var handler = async (event) => {
  try {
    console.log("Document Summary Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path
    });
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
    const { customerEmail } = request;
    if (!customerEmail) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Missing customerEmail" })
      };
    }
    const customer = await findCustomerByEmail(tenantId, customerEmail);
    if (!customer) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Customer not found" })
      };
    }
    const documents = await getCustomerDocuments(customer.uuid);
    if (documents.length === 0) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          customerUUID: customer.uuid,
          customerEmail: customer.email,
          documentCount: 0,
          summary: "No documents found for this customer.",
          documents: []
        })
      };
    }
    const { includedDocuments: processedDocuments, excludedDocuments } = filterDocumentsForSummary(documents);
    if (processedDocuments.length === 0) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          customerUUID: customer.uuid,
          customerEmail: customer.email,
          documentCount: documents.length,
          summary: "Documents are still being processed or no text content available.",
          documents: documents.map(mapToSummaryItem),
          excludedDocuments
        })
      };
    }
    const cacheKey = `${customer.uuid}-${processedDocuments.length}`;
    const cachedSummary = summaryCache.get(cacheKey);
    if (cachedSummary && Date.now() - cachedSummary.timestamp < SUMMARY_CACHE_TTL_MS) {
      if (!isCacheStale(documents, cachedSummary.timestamp)) {
        console.log("Returning cached summary from memory", {
          customerUUID: customer.uuid,
          cacheAge: Date.now() - cachedSummary.timestamp
        });
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-Cache": "HIT-MEMORY"
          },
          body: JSON.stringify({ ...cachedSummary.response, excludedDocuments })
        };
      } else {
        console.log("Memory cache invalidated \u2014 document updated after cache creation", {
          customerUUID: customer.uuid
        });
        summaryCache.delete(cacheKey);
      }
    }
    const dbCachedSummary = await getCachedSummaryFromDB(cacheKey, tenantId);
    if (dbCachedSummary) {
      const dbCacheTimestamp = new Date(dbCachedSummary.createdAt).getTime();
      if (!isCacheStale(documents, dbCacheTimestamp)) {
        console.log("Returning cached summary from DynamoDB", {
          customerUUID: customer.uuid,
          cacheAge: Date.now() - dbCacheTimestamp
        });
        const response2 = JSON.parse(dbCachedSummary.response);
        summaryCache.set(cacheKey, {
          summary: dbCachedSummary.summary,
          timestamp: dbCacheTimestamp,
          response: response2
        });
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-Cache": "HIT-DB"
          },
          body: JSON.stringify({ ...response2, excludedDocuments })
        };
      } else {
        console.log("DynamoDB cache invalidated \u2014 document updated after cache creation", {
          customerUUID: customer.uuid
        });
      }
    }
    let summary;
    let tokenAwareResult;
    let usedFallback = false;
    try {
      tokenAwareResult = await tokenAwareSummarizer.generateSummary(
        processedDocuments,
        customer.uuid,
        tenantId
      );
      summary = await generateDocumentSummary(
        tokenAwareResult.processedContent,
        customer.email,
        tokenAwareResult.tokenUsage,
        tokenAwareResult.truncationInfo
      );
    } catch (error) {
      console.error("Error generating AI summary, using fallback:", error);
      usedFallback = true;
      if (cachedSummary) {
        console.log("Using expired cached summary as fallback", {
          customerUUID: customer.uuid,
          cacheAge: Date.now() - cachedSummary.timestamp
        });
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "X-Cache": "STALE",
            "X-Fallback": "cached-summary"
          },
          body: JSON.stringify({
            ...cachedSummary.response,
            fallbackUsed: true,
            fallbackReason: "AI summary generation failed, using cached summary"
          })
        };
      }
      summary = generateBasicMetadataSummary(processedDocuments, customer.email);
      tokenAwareResult = {
        processedContent: "",
        tokenUsage: { tokensUsed: 0, maxTokensAllowed: 0, utilizationPercentage: 0 },
        truncationInfo: { documentsTruncated: 0, documentsProcessed: processedDocuments.length, totalOriginalTokens: 0, totalProcessedTokens: 0 },
        chunkingMethod: "none",
        processingMetadata: { totalProcessingTime: 0 }
      };
    }
    const response = {
      customerUUID: customer.uuid,
      customerEmail: customer.email,
      documentCount: documents.length,
      summary,
      documents: documents.map(mapToSummaryItem),
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: tokenAwareResult.truncationInfo,
      chunkingMethod: tokenAwareResult.chunkingMethod,
      processingMetadata: tokenAwareResult.processingMetadata,
      ...usedFallback && {
        fallbackUsed: true,
        fallbackReason: "AI summary generation failed, using basic metadata summary"
      },
      ...excludedDocuments.length > 0 && { excludedDocuments }
    };
    if (!usedFallback) {
      summaryCache.set(cacheKey, {
        summary,
        timestamp: Date.now(),
        response
      });
      await cacheSummaryInDB(cacheKey, tenantId, summary, response);
      console.log("Summary cached in memory and DynamoDB", { customerUUID: customer.uuid, cacheKey });
    }
    console.log("Token-aware document summary generated successfully", {
      customerUUID: customer.uuid,
      documentCount: documents.length,
      processedCount: processedDocuments.length,
      excludedCount: excludedDocuments.length,
      usedFallback,
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: {
        documentsTruncated: tokenAwareResult.truncationInfo.documentsTruncated,
        totalOriginalTokens: tokenAwareResult.truncationInfo.totalOriginalTokens,
        totalProcessedTokens: tokenAwareResult.truncationInfo.totalProcessedTokens
      },
      processingTime: tokenAwareResult.processingMetadata.totalProcessingTime
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
    console.error("Error in document summary:", error);
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
async function findCustomerByEmail(tenantId, email) {
  try {
    const result = await dynamoClient.send(new import_lib_dynamodb2.QueryCommand({
      TableName: CUSTOMERS_TABLE,
      IndexName: "email-index",
      KeyConditionExpression: "email = :email",
      FilterExpression: "tenantId = :tenantId",
      ExpressionAttributeValues: {
        ":email": email,
        ":tenantId": tenantId
      }
    }));
    return result.Items?.[0] || null;
  } catch (error) {
    console.error("Error finding customer by email:", error);
    throw error;
  }
}
async function getCustomerDocuments(customerUUID) {
  try {
    const result = await dynamoClient.send(new import_lib_dynamodb2.QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: "customer-documents-index",
      KeyConditionExpression: "customerUuid = :customerUuid",
      ExpressionAttributeValues: {
        ":customerUuid": customerUUID
      },
      ScanIndexForward: false
      // Sort by createdAt descending (newest first)
    }));
    return result.Items || [];
  } catch (error) {
    console.error("Error getting customer documents:", error);
    throw error;
  }
}
async function generateDocumentSummary(processedContent, customerEmail, tokenUsage, truncationInfo) {
  try {
    let prompt = `Please provide a comprehensive summary of all documents for customer ${customerEmail}.`;
    if (truncationInfo.documentsTruncated > 0) {
      prompt += `

IMPORTANT: The content has been intelligently truncated to fit within token limits. ${truncationInfo.documentsTruncated} of ${truncationInfo.documentsProcessed} documents were truncated. Original content was ${truncationInfo.totalOriginalTokens} tokens, processed to ${truncationInfo.totalProcessedTokens} tokens.`;
    }
    prompt += `

Documents to summarize:
${processedContent}`;
    prompt += `

Please provide:
1. A brief overview of the document types and content
2. Key themes or topics across all documents
3. Important information or insights
4. Any notable patterns or relationships between documents`;
    let summaryLength = "400-600 words";
    let maxNewTokens = 1e3;
    if (tokenUsage.maxTokensAllowed <= 512) {
      summaryLength = "200-300 words";
      maxNewTokens = 500;
    } else if (tokenUsage.maxTokensAllowed <= 800) {
      summaryLength = "300-400 words";
      maxNewTokens = 700;
    } else if (tokenUsage.maxTokensAllowed >= 1024) {
      summaryLength = "500-700 words";
      maxNewTokens = 1200;
    }
    prompt += `

Please provide a comprehensive summary of approximately ${summaryLength}. Be thorough and detailed while staying within this length.`;
    console.log("Calling Bedrock Nova Pro for token-aware summary generation", {
      promptLength: prompt.length,
      inputTokensUsed: tokenUsage.tokensUsed,
      maxTokensAllowed: tokenUsage.maxTokensAllowed,
      outputTokensAllowed: maxNewTokens,
      tokenUtilization: tokenUsage.utilizationPercentage,
      documentsTruncated: truncationInfo.documentsTruncated
    });
    const response = await bedrockClient.send(new import_client_bedrock_runtime.InvokeModelCommand({
      modelId: "amazon.nova-pro-v1:0",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ text: prompt }]
          }
        ],
        inferenceConfig: {
          max_new_tokens: maxNewTokens,
          temperature: 0.3
        }
      })
    }));
    const responseBody = JSON.parse(response.body?.transformToString() || "{}");
    const summary = responseBody.output?.message?.content?.[0]?.text || "Unable to generate summary";
    console.log("Token-aware summary generated successfully", {
      summaryLength: summary.length,
      outputTokensAllowed: maxNewTokens,
      inputTokenUtilization: tokenUsage.utilizationPercentage,
      chunkingLimit: tokenUsage.maxTokensAllowed
    });
    return summary;
  } catch (error) {
    console.error("Error generating token-aware summary with Bedrock:", error);
    return `Error generating summary: ${error instanceof Error ? error.message : "Unknown error"}. Input token usage: ${tokenUsage.utilizationPercentage}% of ${tokenUsage.maxTokensAllowed} tokens.`;
  }
}
function mapToSummaryItem(doc) {
  let textPreview = "";
  if (doc.extractedText && doc.extractedText.trim().length > 0) {
    textPreview = doc.extractedText.length > 100 ? doc.extractedText.substring(0, 100) + "..." : doc.extractedText;
  }
  let errorDetails = "";
  if (doc.processingStatus === "failed") {
    if (doc.processingMetadata?.errorDetails?.errorMessage) {
      errorDetails = doc.processingMetadata.errorDetails.errorMessage;
    } else if (doc.errorMessage) {
      errorDetails = doc.errorMessage;
    }
  }
  return {
    documentId: doc.documentId,
    fileName: doc.fileName,
    contentType: doc.contentType,
    createdAt: doc.createdAt,
    processingStatus: doc.processingStatus,
    extractedText: doc.extractedText?.substring(0, 200) + (doc.extractedText && doc.extractedText.length > 200 ? "..." : ""),
    textLength: doc.textLength,
    confidence: doc.processingMetadata?.confidence,
    pageCount: doc.processingMetadata?.pageCount || 1,
    textPreview,
    errorMessage: doc.errorMessage,
    errorDetails: errorDetails || void 0,
    retryCount: doc.retryCount || 0,
    maxRetries: doc.maxRetries || 3,
    processingDurationMs: doc.processingMetadata?.processingDurationMs
  };
}
function generateBasicMetadataSummary(documents, customerEmail) {
  const totalDocs = documents.length;
  const totalPages = documents.reduce((sum, doc) => sum + (doc.processingMetadata?.pageCount || 1), 0);
  const totalTextLength = documents.reduce((sum, doc) => sum + (doc.textLength || 0), 0);
  const docsByType = {};
  documents.forEach((doc) => {
    const type = doc.contentType || "unknown";
    docsByType[type] = (docsByType[type] || 0) + 1;
  });
  const dates = documents.map((doc) => new Date(doc.createdAt).getTime()).sort();
  const oldestDate = new Date(dates[0]).toLocaleDateString();
  const newestDate = new Date(dates[dates.length - 1]).toLocaleDateString();
  const claimDocs = documents.filter((doc) => doc.claimMetadata);
  const hasClaimData = claimDocs.length > 0;
  let summary = `Document Summary for ${customerEmail}

`;
  summary += `Total Documents: ${totalDocs}
`;
  summary += `Total Pages: ${totalPages}
`;
  summary += `Total Text Content: ${(totalTextLength / 1e3).toFixed(1)}K characters
`;
  summary += `Date Range: ${oldestDate} to ${newestDate}

`;
  summary += `Document Types:
`;
  Object.entries(docsByType).forEach(([type, count]) => {
    summary += `- ${type}: ${count} document${count > 1 ? "s" : ""}
`;
  });
  if (hasClaimData) {
    summary += `
Claim Information:
`;
    const patients = new Set(claimDocs.map((doc) => doc.claimMetadata?.patientId).filter(Boolean));
    const claims = new Set(claimDocs.map((doc) => doc.claimMetadata?.claimId).filter(Boolean));
    summary += `- Patients: ${patients.size}
`;
    summary += `- Claims: ${claims.size}
`;
    const claimDocTypes = {};
    claimDocs.forEach((doc) => {
      const type = doc.claimMetadata?.documentType || "Unknown";
      claimDocTypes[type] = (claimDocTypes[type] || 0) + 1;
    });
    summary += `
Claim Document Types:
`;
    Object.entries(claimDocTypes).forEach(([type, count]) => {
      summary += `- ${type}: ${count}
`;
    });
    const diagnosisCodes = claimDocs.map((doc) => doc.claimMetadata?.primaryDiagnosis).filter(Boolean);
    if (diagnosisCodes.length > 0) {
      const uniqueDiagnoses = [...new Set(diagnosisCodes)];
      summary += `
Diagnosis Codes: ${uniqueDiagnoses.join(", ")}
`;
    }
    const claimedAmounts = claimDocs.map((doc) => doc.claimMetadata?.claimedAmount).filter(Boolean);
    if (claimedAmounts.length > 0) {
      const totalClaimed = claimedAmounts.reduce((sum, amt) => sum + amt, 0);
      summary += `Total Claimed Amount: $${totalClaimed.toFixed(2)}
`;
    }
    const approvedAmounts = claimDocs.map((doc) => doc.claimMetadata?.approvedAmount).filter(Boolean);
    if (approvedAmounts.length > 0) {
      const totalApproved = approvedAmounts.reduce((sum, amt) => sum + amt, 0);
      summary += `Total Approved Amount: $${totalApproved.toFixed(2)}
`;
    }
  }
  summary += `
Note: This is a basic metadata summary. AI-powered analysis is temporarily unavailable.`;
  return summary;
}
async function getCachedSummaryFromDB(cacheKey, tenantId) {
  try {
    const result = await dynamoClient.send(new import_lib_dynamodb2.QueryCommand({
      TableName: SUMMARY_CACHE_TABLE,
      KeyConditionExpression: "cacheKey = :cacheKey",
      FilterExpression: "tenantId = :tenantId AND expiresAt > :now",
      ExpressionAttributeValues: {
        ":cacheKey": cacheKey,
        ":tenantId": tenantId,
        ":now": Math.floor(Date.now() / 1e3)
      },
      Limit: 1
    }));
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    return null;
  } catch (error) {
    console.error("Error getting cached summary from DynamoDB:", error);
    return null;
  }
}
async function cacheSummaryInDB(cacheKey, tenantId, summary, response) {
  try {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const expiresAt = Math.floor(Date.now() / 1e3) + SUMMARY_CACHE_TTL_SECONDS;
    const cacheItem = {
      cacheKey,
      tenantId,
      summary,
      response: JSON.stringify(response),
      createdAt: now,
      expiresAt
    };
    await dynamoClient.send(new import_lib_dynamodb2.PutCommand({
      TableName: SUMMARY_CACHE_TABLE,
      Item: cacheItem
    }));
    console.log("Summary cached in DynamoDB", { cacheKey, expiresAt });
  } catch (error) {
    console.error("Error caching summary in DynamoDB:", error);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
