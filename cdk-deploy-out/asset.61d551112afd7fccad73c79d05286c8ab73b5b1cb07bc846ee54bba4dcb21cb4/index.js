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

// src/lambda/patient-detail.ts
var patient_detail_exports = {};
__export(patient_detail_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(patient_detail_exports);
var import_client_s3 = require("@aws-sdk/client-s3");
var s3Client = new import_client_s3.S3Client({ region: process.env.REGION || "us-east-1" });
var SOURCE_BUCKET = process.env.SOURCE_BUCKET || "medical-claims-synthetic-data-dev";
var handler = async (event) => {
  console.log("Patient Detail Request:", JSON.stringify(event, null, 2));
  try {
    const patientId = event.pathParameters?.patientId;
    if (!patientId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Missing patientId",
          message: "Patient ID is required in the path"
        })
      };
    }
    const mapping = await loadPatientMapping();
    const patientInfo = mapping[patientId];
    if (!patientInfo) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Patient not found",
          message: `Patient ${patientId} not found in mapping`
        })
      };
    }
    const claims = await listPatientClaims(patientId);
    const patientDetail = {
      patientId,
      patientName: patientInfo.patient_name,
      tciaCollectionId: patientInfo.tcia_collection_id,
      claims
    };
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(patientDetail)
    };
  } catch (error) {
    console.error("Error retrieving patient details:", error);
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
async function loadPatientMapping() {
  try {
    const command = new import_client_s3.GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: "mapping.json"
    });
    const response = await s3Client.send(command);
    const mappingData = await response.Body?.transformToString();
    if (!mappingData) {
      throw new Error("Empty mapping file");
    }
    const mappingFile = JSON.parse(mappingData);
    const mapping = {};
    for (const entry of mappingFile.patient_mappings) {
      mapping[entry.tcia_id] = {
        synthea_patient_id: entry.synthea_id,
        tcia_collection_id: entry.tcia_id,
        patient_name: entry.patient_name || "Unknown Patient"
      };
    }
    return mapping;
  } catch (error) {
    console.error("Error loading patient mapping:", error);
    throw new Error("Failed to load patient mapping");
  }
}
async function listPatientClaims(patientId) {
  try {
    const claimsPrefix = `patients/${patientId}/claims/`;
    const command = new import_client_s3.ListObjectsV2Command({
      Bucket: SOURCE_BUCKET,
      Prefix: claimsPrefix,
      Delimiter: "/"
    });
    const response = await s3Client.send(command);
    if (!response.Contents || response.Contents.length === 0) {
      return [];
    }
    const claimMap = /* @__PURE__ */ new Map();
    for (const obj of response.Contents) {
      if (!obj.Key) continue;
      const fileName = obj.Key.split("/").pop();
      if (!fileName) continue;
      let claimId = null;
      let docType = null;
      if (fileName.startsWith("cms1500_claim_")) {
        claimId = fileName.replace("cms1500_claim_", "").replace(/\.(pdf|txt)$/, "");
        docType = "CMS1500";
      } else if (fileName.startsWith("eob_")) {
        claimId = fileName.replace("eob_", "").replace(/\.(pdf|txt)$/, "");
        docType = "EOB";
      } else if (fileName.startsWith("radiology_report_")) {
        claimId = fileName.replace("radiology_report_", "").replace(/\.(pdf|txt)$/, "");
        docType = "Radiology Report";
      }
      if (claimId && docType) {
        if (!claimMap.has(claimId)) {
          claimMap.set(claimId, /* @__PURE__ */ new Set());
        }
        claimMap.get(claimId).add(docType);
      }
    }
    const claims = [];
    for (const [claimId, docTypes] of claimMap.entries()) {
      claims.push({
        claimId,
        documentCount: docTypes.size,
        documentTypes: Array.from(docTypes)
      });
    }
    return claims;
  } catch (error) {
    console.error("Error listing patient claims:", error);
    throw new Error("Failed to list patient claims");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
