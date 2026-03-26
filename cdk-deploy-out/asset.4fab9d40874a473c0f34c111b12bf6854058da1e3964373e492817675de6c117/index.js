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

// src/lambda/patient-list.ts
var patient_list_exports = {};
__export(patient_list_exports, {
  handler: () => handler,
  resetCache: () => resetCache
});
module.exports = __toCommonJS(patient_list_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var s3Client = new import_client_s3.S3Client({ region: process.env.REGION || "us-east-1" });
var SOURCE_BUCKET = process.env.SOURCE_BUCKET || "medical-claims-synthetic-data-dev";
var CACHE_TTL_MS = 10 * 60 * 1e3;
var patientListCache = null;
var resetCache = () => {
  patientListCache = null;
};
var handler = async (event) => {
  try {
    console.log("Patient List Lambda invoked", {
      httpMethod: event.httpMethod,
      path: event.path,
      queryParams: event.queryStringParameters
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
    const limit = parseInt(event.queryStringParameters?.limit || "50", 10);
    const nextToken = event.queryStringParameters?.nextToken;
    if (!nextToken && patientListCache && Date.now() - patientListCache.timestamp < CACHE_TTL_MS) {
      console.log("Returning cached patient list", {
        cacheAge: Date.now() - patientListCache.timestamp,
        patientCount: patientListCache.patients.length
      });
      const response2 = {
        patients: patientListCache.patients.slice(0, limit),
        nextToken: patientListCache.patients.length > limit ? "cached-page-2" : void 0,
        totalCount: patientListCache.patients.length
      };
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "HIT"
        },
        body: JSON.stringify(response2)
      };
    }
    const patientDirectories = await listPatientDirectories(limit, nextToken);
    let patientMapping;
    if (patientListCache && Date.now() - patientListCache.timestamp < CACHE_TTL_MS) {
      patientMapping = patientListCache.mapping;
      console.log("Using cached patient mapping");
    } else {
      patientMapping = await loadPatientMapping();
    }
    const mappedPatientIds = patientDirectories.patients.filter((id) => patientMapping.has(id));
    console.log("Filtered patient list", {
      total: patientDirectories.patients.length,
      mapped: mappedPatientIds.length,
      unmapped: patientDirectories.patients.filter((id) => !patientMapping.has(id))
    });
    const patients = await enrichPatientData(mappedPatientIds, patientMapping);
    if (!nextToken) {
      patientListCache = {
        patients,
        timestamp: Date.now(),
        mapping: patientMapping
      };
      console.log("Patient list cached", { patientCount: patients.length });
    }
    const response = {
      patients,
      nextToken: patientDirectories.nextToken,
      totalCount: patients.length
    };
    console.log("Patient list generated successfully", {
      patientCount: patients.length,
      hasNextToken: !!patientDirectories.nextToken
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
    console.error("Error in patient list:", error);
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
async function listPatientDirectories(limit, continuationToken) {
  try {
    const command = new import_client_s3.ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: "patients/",
      Delimiter: "/",
      MaxKeys: limit,
      ContinuationToken: continuationToken
    });
    const response = await s3Client.send(command);
    const patients = (response.CommonPrefixes || []).map((prefix) => {
      const match = prefix.Prefix?.match(/patients\/(TCIA-[^/]+)\//);
      return match ? match[1] : null;
    }).filter((id) => id !== null);
    console.log("Listed patient directories from S3", {
      patientCount: patients.length,
      hasMore: response.IsTruncated
    });
    return {
      patients,
      nextToken: response.NextContinuationToken
    };
  } catch (error) {
    console.error("Error listing patient directories:", error);
    throw new Error(`Failed to list patient directories: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
async function loadPatientMapping() {
  try {
    const command = new import_client_s3.GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: "mapping.json"
    });
    const response = await s3Client.send(command);
    const mappingData = await response.Body?.transformToString();
    if (!mappingData) {
      throw new Error("Empty mapping.json file");
    }
    const mappingFile = JSON.parse(mappingData);
    const mappingMap = /* @__PURE__ */ new Map();
    if (mappingFile.patient_mappings && Array.isArray(mappingFile.patient_mappings)) {
      mappingFile.patient_mappings.forEach((entry) => {
        mappingMap.set(entry.tcia_id, {
          syntheaId: entry.synthea_id,
          tciaId: entry.tcia_id,
          patientName: entry.patient_name || "Unknown Patient",
          tciaCollectionId: entry.tcia_id
        });
      });
    }
    console.log("Loaded patient mapping", {
      mappingCount: mappingMap.size
    });
    return mappingMap;
  } catch (error) {
    console.error("Error loading patient mapping:", error);
    return /* @__PURE__ */ new Map();
  }
}
async function enrichPatientData(patientIds, mappingData) {
  const enrichedPatients = [];
  for (const patientId of patientIds) {
    try {
      const mapping = mappingData.get(patientId);
      const claimCount = await countPatientClaims(patientId);
      enrichedPatients.push({
        patientId,
        patientName: mapping?.patientName || "Unknown Patient",
        tciaCollectionId: mapping?.tciaCollectionId || "N/A",
        claimCount
      });
    } catch (error) {
      console.error(`Error enriching patient ${patientId}:`, error);
      enrichedPatients.push({
        patientId,
        patientName: "Unknown Patient",
        tciaCollectionId: "N/A",
        claimCount: 0
      });
    }
  }
  return enrichedPatients;
}
async function countPatientClaims(patientId) {
  try {
    const command = new import_client_s3.ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: `patients/${patientId}/claims/`,
      MaxKeys: 1e3
      // Reasonable limit for counting
    });
    const response = await s3Client.send(command);
    const claimFiles = (response.Contents || []).filter((obj) => obj.Key?.endsWith(".pdf")).filter((obj) => {
      const key = obj.Key || "";
      return key.includes("cms1500_") || key.includes("eob_");
    });
    const claimIds = /* @__PURE__ */ new Set();
    claimFiles.forEach((file) => {
      const match = file.Key?.match(/claim_(\d+)/);
      if (match) {
        claimIds.add(match[1]);
      }
    });
    return claimIds.size;
  } catch (error) {
    console.error(`Error counting claims for patient ${patientId}:`, error);
    return 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler,
  resetCache
});
