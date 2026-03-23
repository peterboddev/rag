/**
 * Bug Condition Exploration Property Test — KB Metadata Filter Returns Zero Results
 *
 * This test demonstrates the bug where metadata-filtered KB retrieval returns 0 results
 * because the data sources (RAG KB `IJ9SLGVYQ1` / data source `ND5VILOG2Q` and
 * GraphRAG KB `B72QTGJBCX` / data source `PEZG3NEKRP`) were NEVER configured with
 * `parsingConfiguration` to recognize `.metadata.json` sidecar files.
 *
 * The claim-loader Lambda writes correct sidecars alongside each document in S3,
 * but the KB data sources ignore them during ingestion. As a result, metadata attributes
 * like `patientId` and `claimId` are never indexed, and any metadata-filtered retrieval
 * query returns zero results.
 *
 * **EXPECTED TO FAIL on unfixed code** — failure confirms the bug exists.
 * The unfiltered test (d) should PASS, confirming documents exist but metadata isn't indexed.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import * as fc from 'fast-check';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

// Live KB IDs
const RAG_KB_ID = 'IJ9SLGVYQ1';
const GRAPH_RAG_KB_ID = 'B72QTGJBCX';
const REGION = 'us-east-1';

// Known patient/claim IDs from DynamoDB (rag-app-documents-dev table)
const KNOWN_IDS = [
  { claimId: 'EOB000041', patientId: 'TCIA-012', patientName: 'Cristobal567 Alfredo17 Montero62' },
  { claimId: 'EOB000031', patientId: 'TCIA-006', patientName: 'Cletus494 Donte636 Hahn503' },
  { claimId: 'EOB000061', patientId: 'TCIA-030', patientName: "Edwardo860 Rickie717 O'Kon634" },
  { claimId: 'EOB000096', patientId: 'TCIA-003', patientName: 'Jacquline932 Carlena776 Gislason620' },
];

const client = new BedrockAgentRuntimeClient({ region: REGION });

/**
 * Helper: call Retrieve API with an optional metadata filter
 */
async function retrieveFromKB(
  knowledgeBaseId: string,
  filterKey?: string,
  filterValue?: string
): Promise<{ resultCount: number; results: any[] }> {
  const vectorSearchConfig: any = { numberOfResults: 10 };

  if (filterKey && filterValue) {
    vectorSearchConfig.filter = {
      equals: { key: filterKey, value: filterValue },
    };
  }

  const command = new RetrieveCommand({
    knowledgeBaseId,
    retrievalQuery: {
      text: 'Summarize insurance claim including patient information, diagnoses, procedures, and amounts.',
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig,
    },
  });

  const response = await client.send(command);
  const results = response.retrievalResults || [];
  return { resultCount: results.length, results };
}

/**
 * fast-check arbitrary: picks a random known ID record
 */
const knownIdArb = fc.constantFrom(...KNOWN_IDS);

// Increase Jest timeout for live API calls
jest.setTimeout(60000);

/**
 * Test (a): RAG KB with patientId metadata filter — EXPECTED TO FAIL
 *
 * For any known patientId, querying RAG KB IJ9SLGVYQ1 with a metadata filter
 * { equals: { key: 'patientId', value: '<known>' } } should return >0 results.
 *
 * On unfixed code, this returns 0 results because metadata is not indexed.
 *
 * **Validates: Requirements 1.1**
 */
describe('Property 1: Bug Condition — Metadata-Filtered KB Retrieval Returns Zero Results', () => {
  it('(a) RAG KB with patientId filter should return >0 results', async () => {
    await fc.assert(
      fc.asyncProperty(knownIdArb, async ({ patientId }) => {
        const { resultCount } = await retrieveFromKB(RAG_KB_ID, 'patientId', patientId);
        expect(resultCount).toBeGreaterThan(0);
      }),
      { numRuns: 5, verbose: fc.VerbosityLevel.VeryVerbose }
    );
  });

  /**
   * Test (b): RAG KB with claimId metadata filter — EXPECTED TO FAIL
   *
   * For any known claimId, querying RAG KB IJ9SLGVYQ1 with a metadata filter
   * { equals: { key: 'claimId', value: '<known>' } } should return >0 results.
   *
   * On unfixed code, this returns 0 results because metadata is not indexed.
   *
   * **Validates: Requirements 1.1**
   */
  it('(b) RAG KB with claimId filter should return >0 results', async () => {
    await fc.assert(
      fc.asyncProperty(knownIdArb, async ({ claimId }) => {
        const { resultCount } = await retrieveFromKB(RAG_KB_ID, 'claimId', claimId);
        expect(resultCount).toBeGreaterThan(0);
      }),
      { numRuns: 5, verbose: fc.VerbosityLevel.VeryVerbose }
    );
  });

  /**
   * Test (c): GraphRAG KB with patientId metadata filter — EXPECTED TO FAIL
   *
   * For any known patientId, querying GraphRAG KB B72QTGJBCX with a metadata filter
   * { equals: { key: 'patientId', value: '<known>' } } should return >0 results.
   *
   * On unfixed code, this returns 0 results because metadata is not indexed.
   *
   * **Validates: Requirements 1.2**
   */
  it('(c) GraphRAG KB with patientId filter should return >0 results', async () => {
    await fc.assert(
      fc.asyncProperty(knownIdArb, async ({ patientId }) => {
        const { resultCount } = await retrieveFromKB(GRAPH_RAG_KB_ID, 'patientId', patientId);
        expect(resultCount).toBeGreaterThan(0);
      }),
      { numRuns: 5, verbose: fc.VerbosityLevel.VeryVerbose }
    );
  });

  /**
   * Test (d): RAG KB WITHOUT metadata filter — SHOULD PASS
   *
   * Querying RAG KB IJ9SLGVYQ1 without any metadata filter should return >0 results.
   * This confirms documents ARE ingested and retrievable — the issue is purely that
   * metadata attributes are not indexed, so filtered queries fail.
   *
   * **Validates: Requirements 1.3 (confirms docs exist, metadata not indexed)**
   */
  it('(d) RAG KB without metadata filter should return >0 results (confirms docs exist)', async () => {
    const { resultCount } = await retrieveFromKB(RAG_KB_ID);
    expect(resultCount).toBeGreaterThan(0);
  });
});
