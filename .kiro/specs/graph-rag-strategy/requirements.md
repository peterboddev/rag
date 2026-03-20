# Requirements Document

## Introduction

The `executeGraphRagStrategy()` function in the TypeScript claim summary orchestrator Lambda (`src/lambda/claim-summary-orchestrator.ts`) is currently identical to `executeFullContextStrategy()` — both concatenate all document text and send it to Bedrock Nova Pro. This feature replaces that placeholder with a real graph-based RAG implementation using AWS managed services: a new Bedrock Knowledge Base backed by Amazon Neptune Analytics (GraphRAG). Neptune Analytics automatically extracts entities, builds a knowledge graph of relationships, and combines vector similarity search with graph traversal — delivering more comprehensive, cross-document reasoning without custom graph code. The orchestrator Lambda will query this GraphRAG Knowledge Base via the Bedrock Agent Runtime `Retrieve` API and use the enriched, relationship-aware results to build a better LLM prompt.

## Glossary

- **Orchestrator**: The TypeScript Lambda function at `src/lambda/claim-summary-orchestrator.ts` that routes claim summary requests to the appropriate strategy implementation.
- **GraphRAG_KB**: A new Bedrock Knowledge Base configured with Amazon Neptune Analytics as its vector store, enabling automatic entity extraction, graph construction, and hybrid vector+graph retrieval.
- **Neptune_Analytics_Graph**: An Amazon Neptune Analytics graph instance that stores both vector embeddings and the entity-relationship graph extracted from documents.
- **Existing_KB**: The current Bedrock Knowledge Base (`IJ9SLGVYQ1`) backed by OpenSearch Serverless, used by the `rag` strategy.
- **Graph_Retrieval_Result**: A result from querying the GraphRAG_KB via the `Retrieve` API, containing text content enriched with entity and relationship context from graph traversal.
- **Document_Record**: A DynamoDB item from the documents table containing `documentId`, `fileName`, and `extractedText` fields.
- **Data_Source**: An S3-based data source connected to the GraphRAG_KB, pointing to the same document bucket used by the existing pipeline.

## Requirements

### Requirement 1: Neptune Analytics Graph Provisioning

**User Story:** As a developer, I want a Neptune Analytics graph provisioned via CDK, so that the GraphRAG Knowledge Base has a graph store for entity extraction and relationship-aware retrieval.

#### Acceptance Criteria

1. THE CDK stack SHALL create an Amazon Neptune Analytics graph resource with a vector search dimension matching the chosen embeddings model.
2. THE Neptune Analytics graph SHALL be named following the project convention: `{applicationName}-graph-{environment}` (e.g., `rag-app-graph-dev`).
3. THE CDK stack SHALL export the Neptune Analytics graph ARN as a stack output for reference by other resources.
4. THE Neptune Analytics graph SHALL use the minimum provisioned memory (32 GB) suitable for the dev environment dataset size.

### Requirement 2: GraphRAG Knowledge Base Provisioning

**User Story:** As a developer, I want a Bedrock Knowledge Base backed by Neptune Analytics provisioned via CDK, so that documents are automatically processed into a knowledge graph with entity extraction and relationship mapping.

#### Acceptance Criteria

1. THE CDK stack SHALL create a new Bedrock Knowledge Base with storage type `NEPTUNE_ANALYTICS`, referencing the Neptune_Analytics_Graph ARN.
2. THE GraphRAG_KB SHALL use an embeddings model compatible with Neptune Analytics (e.g., `cohere.embed-english-v3` or `amazon.titan-embed-text-v2:0`).
3. THE CDK stack SHALL create an S3 data source for the GraphRAG_KB pointing to the same documents bucket used by the existing pipeline.
4. THE data source SHALL be configured with context enrichment using `CHUNK_ENTITY_EXTRACTION` method and a foundation model for automatic graph building (e.g., Claude 3 Haiku or Amazon Nova).
5. THE CDK stack SHALL create an IAM service role for the GraphRAG_KB with permissions to access S3, Neptune Analytics, and Bedrock foundation models.
6. THE GraphRAG_KB ID SHALL be passed to the orchestrator Lambda as an environment variable (`GRAPH_RAG_KNOWLEDGE_BASE_ID`).

### Requirement 3: Orchestrator Integration with GraphRAG Knowledge Base

**User Story:** As a claims analyst, I want the `executeGraphRagStrategy()` function to query the managed GraphRAG Knowledge Base instead of concatenating raw text, so that the graph-rag strategy produces genuinely differentiated summaries informed by entity relationships and cross-document reasoning.

#### Acceptance Criteria

1. WHEN the Orchestrator receives a request with strategy "graph-rag", THE Orchestrator SHALL query the GraphRAG_KB using the Bedrock Agent Runtime `Retrieve` API with a retrieval query describing the claim summary task.
2. THE Orchestrator SHALL request up to 20 retrieval results from the GraphRAG_KB to gather sufficient cross-document context.
3. WHEN retrieval results are returned, THE Orchestrator SHALL build a prompt that includes the graph-enriched retrieval chunks and invoke Bedrock Nova Pro for summary generation.
4. THE Orchestrator SHALL parse the LLM response into summary text and anomalies, consistent with the existing response format.
5. THE Orchestrator SHALL return a ClaimSummaryResponse with strategy set to "graph-rag", the document count derived from unique source documents in retrieval results, processing time, and generation timestamp.
6. WHEN the GraphRAG_KB returns zero retrieval results, THE Orchestrator SHALL return a 404 error indicating no documents found for the claim.
7. IF the GraphRAG_KB query fails, THEN THE Orchestrator SHALL fall back to the full-context strategy behavior and log the error.

### Requirement 4: IAM Permissions for GraphRAG Access

**User Story:** As a developer, I want the orchestrator Lambda to have the necessary IAM permissions to query the GraphRAG Knowledge Base and access Neptune Analytics, so that the graph-rag strategy works without permission errors.

#### Acceptance Criteria

1. THE CDK stack SHALL grant the orchestrator Lambda's execution role `bedrock:Retrieve` and `bedrock:RetrieveAndGenerate` permissions scoped to the GraphRAG_KB.
2. THE CDK stack SHALL grant the orchestrator Lambda's execution role `neptune-graph:ReadDataViaQuery` and `neptune-graph:GetQueryResults` permissions on the Neptune_Analytics_Graph.
3. THE existing permissions for the orchestrator Lambda (Bedrock InvokeModel, existing KB Retrieve, DynamoDB, S3) SHALL remain unchanged.

### Requirement 5: Data Source Sync for GraphRAG

**User Story:** As a developer, I want the GraphRAG Knowledge Base data source to be syncable so that newly uploaded claim documents are ingested into the knowledge graph.

#### Acceptance Criteria

1. THE data source configuration SHALL point to the same S3 bucket prefix where processed claim documents are stored.
2. AFTER CDK deployment, the data source SHALL be ready for manual or automated sync via the Bedrock console or `start-ingestion-job` API.
3. THE requirements document SHALL note that initial data sync must be triggered after first deployment (sync is not automatic on creation).

### Requirement 6: Graph-RAG Strategy Differentiation

**User Story:** As a claims analyst, I want the graph-rag strategy to produce noticeably different results from the plain rag strategy, so that the strategy comparison view demonstrates the value of graph-based retrieval.

#### Acceptance Criteria

1. THE graph-rag strategy prompt SHALL identify itself as using "graph-rag (Neptune Analytics GraphRAG)" to distinguish from the plain rag strategy in the LLM prompt.
2. THE graph-rag strategy SHALL use the GraphRAG_KB (Neptune Analytics) while the plain rag strategy continues to use the Existing_KB (OpenSearch Serverless), ensuring different retrieval backends.
3. THE Orchestrator SHALL include the retrieval source metadata (S3 URIs) from GraphRAG_KB results in the prompt context, consistent with how the rag strategy handles chunk sources.

### Requirement 7: Optional Reranker for Graph-RAG

**User Story:** As a claims analyst, I want to optionally enable a reranker model when using the graph-rag strategy, so that I can compare retrieval quality with and without reranking and see the difference in the strategy comparison view.

#### Acceptance Criteria

1. THE ClaimSummaryRequest type SHALL accept an optional `useReranker` boolean field.
2. WHEN `useReranker` is true and strategy is "graph-rag", THE Orchestrator SHALL include a `rerankingConfiguration` in the `RetrieveCommand` specifying a Bedrock reranker model (e.g., `cohere.rerank-v3-5:0`).
3. WHEN `useReranker` is false or omitted, THE Orchestrator SHALL NOT include a `rerankingConfiguration`, preserving default retrieval behavior.
4. THE CDK stack SHALL grant the orchestrator Lambda's execution role `bedrock:InvokeModel` permission on the reranker model ARN.
5. THE frontend strategy comparison view SHALL include a "Use Reranker" checkbox for the Graph RAG column, allowing the user to toggle reranking on or off before generating.
6. THE `useReranker` setting SHALL be passed through the API request body and reflected in the response metadata so the user can see which configuration produced the result.
7. THE cache key for graph-rag summaries SHALL include the reranker setting to avoid serving reranked results for non-reranked requests and vice versa.

