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

// src/lambda/chunking-methods-list.ts
var chunking_methods_list_exports = {};
__export(chunking_methods_list_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(chunking_methods_list_exports);

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

// src/lambda/chunking-methods-list.ts
var chunkingService = new ChunkingConfigurationService();
var handler = async (event) => {
  try {
    console.log("List Chunking Methods Lambda invoked", {
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
    const availableMethods = await chunkingService.getAvailableChunkingMethods();
    const response = {
      methods: availableMethods,
      count: availableMethods.length,
      retrievedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    console.log("Successfully retrieved available chunking methods", {
      methodCount: availableMethods.length,
      methods: availableMethods.map((m) => m.id)
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
    console.error("Error in list chunking methods:", error);
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
