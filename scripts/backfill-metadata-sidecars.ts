/**
 * Backfill metadata sidecar files for documents missing them.
 *
 * The claim-loader Lambda writes .metadata.json sidecars next to each document
 * in S3 so that Bedrock Knowledge Base can filter by patientId/claimId metadata.
 * Documents uploaded before the sidecar logic was added (e.g. under local-dev-tenant)
 * are missing these files, causing RAG/GraphRAG KB queries to return 0 results.
 *
 * This script:
 * 1. Scans DynamoDB for all documents belonging to a given tenant
 * 2. For each document, checks if a .metadata.json sidecar already exists in S3
 * 3. If missing, creates the sidecar using claimMetadata from the DynamoDB record
 *
 * Usage:
 *   npx ts-node scripts/backfill-metadata-sidecars.ts
 *
 * Environment variables (optional overrides):
 *   DOCUMENTS_TABLE_NAME  - DynamoDB table (auto-detected from CDK output)
 *   DOCUMENTS_BUCKET      - S3 bucket (auto-detected from CDK output)
 *   TENANT_ID             - Tenant to backfill (default: local-dev-tenant)
 *   DRY_RUN               - Set to "true" to preview without writing (default: false)
 *   REGION                - AWS region (default: us-east-1)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.REGION || 'us-east-1';
const TENANT_ID = process.env.TENANT_ID || 'local-dev-tenant';
const DRY_RUN = process.env.DRY_RUN === 'true';

// These are the actual deployed resource names from the CDK stack
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME || 'rag-app-documents-dev';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'rag-app-development-documentsbucket9ec9deb9-hn1z8ikqrnwt';

const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);
const s3Client = new S3Client({ region: REGION });

interface DocumentRecord {
  documentId: string;
  tenantId: string;
  s3Key: string;
  fileName: string;
  claimMetadata?: {
    claimId?: string;
    patientId?: string;
    patientName?: string;
    documentType?: string;
  };
}

async function sidecarExists(bucket: string, sidecarKey: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: sidecarKey }));
    return true;
  } catch (err: any) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

async function writeSidecar(bucket: string, sidecarKey: string, metadata: Record<string, string>): Promise<void> {
  const body = JSON.stringify({ metadataAttributes: metadata });
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: sidecarKey,
    Body: body,
    ContentType: 'application/json',
  }));
}

async function scanDocuments(): Promise<DocumentRecord[]> {
  const docs: DocumentRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const result = await dynamoClient.send(new ScanCommand({
      TableName: DOCUMENTS_TABLE,
      FilterExpression: 'tenantId = :tid',
      ExpressionAttributeValues: { ':tid': TENANT_ID },
      ExclusiveStartKey: lastKey,
    }));

    if (result.Items) {
      docs.push(...(result.Items as DocumentRecord[]));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return docs;
}

async function main() {
  console.log(`Backfill metadata sidecars`);
  console.log(`  Table:  ${DOCUMENTS_TABLE}`);
  console.log(`  Bucket: ${DOCUMENTS_BUCKET}`);
  console.log(`  Tenant: ${TENANT_ID}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log('');

  const docs = await scanDocuments();
  console.log(`Found ${docs.length} documents for tenant "${TENANT_ID}"\n`);

  let created = 0;
  let skipped = 0;
  let noMetadata = 0;
  let errors = 0;

  for (const doc of docs) {
    const { documentId, s3Key, claimMetadata, fileName } = doc;

    if (!s3Key) {
      console.log(`  SKIP ${documentId} - no s3Key`);
      skipped++;
      continue;
    }

    if (!claimMetadata?.claimId || !claimMetadata?.patientId) {
      console.log(`  SKIP ${documentId} (${fileName}) - missing claimMetadata.claimId or patientId`);
      noMetadata++;
      continue;
    }

    const sidecarKey = `${s3Key}.metadata.json`;

    try {
      const exists = await sidecarExists(DOCUMENTS_BUCKET, sidecarKey);
      if (exists) {
        skipped++;
        continue;
      }

      const attrs: Record<string, string> = {
        claimId: claimMetadata.claimId,
        patientId: claimMetadata.patientId,
      };
      if (claimMetadata.patientName) attrs.patientName = claimMetadata.patientName;
      if (claimMetadata.documentType) attrs.documentType = claimMetadata.documentType;

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create: ${sidecarKey}`);
        console.log(`            Attrs: ${JSON.stringify(attrs)}`);
      } else {
        await writeSidecar(DOCUMENTS_BUCKET, sidecarKey, attrs);
        console.log(`  CREATED ${sidecarKey}`);
      }
      created++;
    } catch (err) {
      console.error(`  ERROR ${documentId} (${fileName}): ${err}`);
      errors++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (already exists): ${skipped}`);
  console.log(`  Skipped (no metadata): ${noMetadata}`);
  console.log(`  Errors: ${errors}`);

  if (DRY_RUN) {
    console.log(`\nThis was a dry run. Set DRY_RUN=false to actually write sidecars.`);
  } else if (created > 0) {
    console.log(`\nNext step: Re-trigger KB ingestion for both RAG and GraphRAG knowledge bases`);
    console.log(`  RAG KB:      aws bedrock-agent start-ingestion-job --knowledge-base-id IJ9SLGVYQ1 --data-source-id ND5VILOG2Q`);
    console.log(`  GraphRAG KB: aws bedrock-agent start-ingestion-job --knowledge-base-id B72QTGJBCX --data-source-id PEZG3NEKRP`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
