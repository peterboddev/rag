# Requirements Document

## Introduction

The Claim Summary feature adds AI-powered claim summarization to the Insurance Claim Portal with multiple summarization strategies for comparison and automated quality evaluation. Currently, the ClaimDetailPage displays patient claims with a "View Documents & Summary" button that only opens a document list modal. This feature separates the button into a dedicated "View Documents" button and a new "Summarize Claim" button. The "Summarize Claim" button opens a modal where users can select from three summarization strategies: Full Context (all documents), RAG-based (with chunking method selection), and Graph RAG. 

The feature uses the Strands Agents SDK (`strands-agents`) to implement each strategy as a separate agent deployed to Amazon Bedrock AgentCore Runtime. Strands provides a declarative agent framework with built-in Bedrock model integration, tool calling via `@tool`-decorated functions, and OpenTelemetry tracing — enabling independent optimization per strategy and built-in quality evaluation via AgentCore Evaluations. Users can compare summarization quality across different approaches using evaluation scores for helpfulness, faithfulness, and completeness.

## Glossary

- **ClaimDetailPage**: The React component that displays patient information and their associated insurance claims.
- **Orchestrator_Lambda**: A lightweight AWS Lambda function that receives API requests, checks cache, and routes to the appropriate AgentCore agent.
- **Full_Context_Agent**: A Strands SDK agent (`strands.Agent`) deployed to AgentCore Runtime that summarizes claims by passing all document text directly to the LLM via `@tool`-decorated retrieval functions.
- **RAG_Agent**: A Strands SDK agent deployed to AgentCore Runtime that summarizes claims using Knowledge Base retrieval with configurable chunking methods.
- **Graph_RAG_Agent**: A Strands SDK agent deployed to AgentCore Runtime that summarizes claims by building an in-memory knowledge graph of entities and relationships using `@tool`-decorated graph construction functions.
- **Claim_Summary_Modal**: A new React modal component that displays strategy selection, chunking method options, the AI-generated claim summary, evaluation scores, loading state, and error state.
- **Claim_Summary_API**: The API Gateway endpoint (POST /claims/{claimId}/summary) that invokes the Orchestrator_Lambda.
- **Documents_Table**: The DynamoDB table (`rag-app-documents-dev`) that stores document records including extracted text.
- **Bedrock_Nova_Pro**: The AWS Bedrock foundation model (`amazon.nova-pro-v1:0`) used for text generation and summarization.
- **Claim_Status_API**: The existing API endpoint (GET /claims/{claimId}/status) that returns claim processing status and associated documents.
- **Full_Context_Strategy**: Summarization strategy that passes all document text directly to the LLM as context.
- **RAG_Strategy**: Summarization strategy that uses vector similarity search to retrieve relevant document chunks before summarization.
- **Graph_RAG_Strategy**: Summarization strategy that uses a knowledge graph to identify entity relationships and retrieve contextually connected information.
- **Full_Document_Chunking**: Chunking method that treats each document as a single chunk.
- **Semantic_Chunking**: Chunking method that splits documents into semantically coherent segments based on content boundaries.
- **Knowledge_Base**: The AWS Bedrock Knowledge Base used for RAG-based document retrieval.
- **Summary_Cache_Table**: A DynamoDB table that stores summary metadata (strategy, chunkingMethod, documentCount, processingTime, timestamps, S3 key, evaluation scores) for fast cache lookups.
- **Summary_Content_Bucket**: An S3 bucket that stores the full summary text content at the path `summaries/{claimId}/{strategy}/{chunkingMethod}.json`.
- **Data_Anomaly_Detection**: The AI-driven analysis that identifies inconsistencies, impossible dates, contradictory information, and other data quality issues across claim documents.
- **AgentCore_Runtime**: Amazon Bedrock AgentCore Runtime service that hosts the three Strands-based summarization agents.
- **Strands_Agents_SDK**: The Python SDK (`strands-agents`) used to build agents with declarative tool calling, native Bedrock integration, and built-in OpenTelemetry tracing. Agents use `@tool`-decorated functions for domain logic and `BedrockModel` for LLM access.
- **AgentCore_Evaluations**: Amazon Bedrock AgentCore Evaluations service that scores summary quality using built-in and custom evaluators.
- **Evaluation_Results_Table**: A DynamoDB table that stores evaluation scores per claim per strategy for comparison.
- **Faithfulness_Evaluator**: A custom AgentCore evaluator that scores how accurately a summary reflects source documents without hallucinations.
- **Completeness_Evaluator**: A custom AgentCore evaluator that measures coverage of key claim elements (patient, diagnosis, procedures, amounts).

## Requirements

### Requirement 1: Separate Document Viewing and Summarization Buttons

**User Story:** As a claims reviewer, I want separate buttons for viewing documents and generating a summary, so that I can choose the action I need without confusion.

#### Acceptance Criteria

1. WHEN a claim has a status of "completed", THE ClaimDetailPage SHALL display a "View Documents" button for that claim.
2. WHEN a claim has a status of "completed", THE ClaimDetailPage SHALL display a "Summarize Claim" button adjacent to the "View Documents" button for that claim.
3. WHEN the "View Documents" button is clicked, THE ClaimDetailPage SHALL open the DocumentListModal showing the claim's documents.
4. WHEN a claim does not have a status of "completed", THE ClaimDetailPage SHALL not display the "Summarize Claim" button for that claim.

### Requirement 2: Summarization Strategy Selection

**User Story:** As a claims reviewer, I want to choose between different summarization strategies, so that I can compare summary quality and find the approach that works best for my use case.

#### Acceptance Criteria

1. WHEN the Claim_Summary_Modal opens, THE modal SHALL display three summarization strategy options: "Full Context", "RAG", and "Graph RAG".
2. WHEN the "Full Context" strategy is selected, THE Claim_Summary_Modal SHALL indicate that all document text will be passed directly to the LLM.
3. WHEN the "RAG" strategy is selected, THE Claim_Summary_Modal SHALL display a chunking method selector with two options: "Full Document Chunking" and "Semantic Chunking".
4. WHEN the "Graph RAG" strategy is selected, THE Claim_Summary_Modal SHALL indicate that a knowledge graph will be used for entity-relationship-aware retrieval.
5. THE Claim_Summary_Modal SHALL default to the "Full Context" strategy on initial open.

### Requirement 3: Claim Summary API Endpoint

**User Story:** As a backend service, I want a dedicated API endpoint for claim summarization that routes to specialized AgentCore agents per strategy, so that the frontend can request AI-generated summaries using different approaches and compare their quality.

#### Acceptance Criteria

1. THE Claim_Summary_API SHALL accept POST requests at the path `/claims/{claimId}/summary`.
2. THE Claim_Summary_API SHALL accept a `strategy` field in the request body with values `full-context`, `rag`, or `graph-rag`.
3. WHEN the `strategy` is `rag`, THE Claim_Summary_API SHALL accept a `chunkingMethod` field with values `full-document` or `semantic`.
4. WHEN the `strategy` is `full-context`, THE Orchestrator_Lambda SHALL invoke the Full_Context_Agent which retrieves all document records from the Documents_Table and passes the combined extracted text directly to Bedrock_Nova_Pro.
5. WHEN the `strategy` is `rag`, THE Orchestrator_Lambda SHALL invoke the RAG_Agent which uses the Knowledge_Base to retrieve relevant document chunks based on a claim-context query, then passes the retrieved chunks to Bedrock_Nova_Pro.
6. WHEN the `strategy` is `rag` with `chunkingMethod` of `full-document`, THE RAG_Agent SHALL retrieve chunks where each document is treated as a single chunk.
7. WHEN the `strategy` is `rag` with `chunkingMethod` of `semantic`, THE RAG_Agent SHALL retrieve chunks that were split based on semantic content boundaries.
8. WHEN the `strategy` is `graph-rag`, THE Orchestrator_Lambda SHALL invoke the Graph_RAG_Agent which builds a knowledge graph of entities and relationships from the claim documents, then uses graph traversal to retrieve contextually connected information for summarization.
9. WHEN the summary is generated, THE Orchestrator_Lambda SHALL return a JSON response containing the summary text, the strategy used, the chunking method (if applicable), the count of documents included, the processing time in milliseconds, a generated-at ISO 8601 timestamp, and evaluation scores (if available).
10. IF the claim has no associated documents, THEN THE Orchestrator_Lambda SHALL return a 404 status code with an error message indicating no documents were found.
11. IF none of the associated documents have completed processing with extracted text, THEN THE Orchestrator_Lambda SHALL return a 400 status code with an error message indicating no summarizable content is available.
12. IF Bedrock_Nova_Pro returns an error, THEN THE Orchestrator_Lambda SHALL return a 502 status code with an error message indicating the summary generation failed.

### Requirement 4: Data Anomaly Detection

**User Story:** As a claims reviewer, I want the AI summary to identify and highlight data inconsistencies and obvious mistakes in the claim documents, so that I can quickly spot errors that need correction before processing the claim.

#### Acceptance Criteria

1. WHEN generating a summary, THE AgentCore agent SHALL instruct Bedrock_Nova_Pro to analyze documents for data anomalies including chronological impossibilities, contradictory information, and unrealistic data patterns.
2. THE AgentCore agent SHALL detect anomalies such as: dates that precede a patient's birth date, payment dates before service dates, diagnosis codes inconsistent with patient demographics, and duplicate or conflicting information across documents.
3. WHEN anomalies are detected, THE AgentCore agent SHALL return an `anomalies` array in the response containing each anomaly with a description, severity level (critical, warning, info), the source document name, and the specific data values involved.
4. THE Claim_Summary_API response SHALL place the anomalies section before the summary text in the JSON structure to emphasize their importance.
5. WHEN displaying the summary, THE Claim_Summary_Modal SHALL render detected anomalies in a prominent alert section at the top of the summary, before the main summary text.
6. THE Claim_Summary_Modal SHALL color-code anomalies by severity: red for critical, yellow for warning, and blue for informational.
7. IF no anomalies are detected, THEN THE Claim_Summary_Modal SHALL display a green "No data anomalies detected" indicator.

### Requirement 5: Claim Summary Modal Display

**User Story:** As a claims reviewer, I want to see the AI-generated claim summary in a clear modal with strategy details, so that I can quickly understand the claim contents and which approach was used.

#### Acceptance Criteria

1. WHEN the "Summarize Claim" button is clicked, THE Claim_Summary_Modal SHALL open and display the strategy selection interface.
2. WHEN a strategy is selected and the user clicks "Generate Summary", THE Claim_Summary_Modal SHALL display a loading indicator while the summary is being generated.
3. WHEN the Claim_Summary_API returns a successful response, THE Claim_Summary_Modal SHALL display the summary text, the strategy used, the chunking method (if RAG), the number of documents summarized, and the processing time.
4. IF the Claim_Summary_API returns an error, THEN THE Claim_Summary_Modal SHALL display the error message to the user.
5. WHEN the user presses the Escape key or clicks the close button, THE Claim_Summary_Modal SHALL close.
6. WHEN the user clicks outside the Claim_Summary_Modal content area, THE Claim_Summary_Modal SHALL close.
7. THE Claim_Summary_Modal SHALL use `role="dialog"` and `aria-modal="true"` attributes for accessibility.
8. WHEN a summary has been generated, THE Claim_Summary_Modal SHALL allow the user to select a different strategy and regenerate without closing the modal.

### Requirement 6: Claim Summary API Client Integration

**User Story:** As a frontend developer, I want a typed API function for requesting claim summaries with strategy selection, so that the frontend can call the backend in a consistent and type-safe manner.

#### Acceptance Criteria

1. THE claimApi module SHALL export a `getClaimSummary` function that accepts a `claimId` string, a `strategy` string, and an optional `chunkingMethod` string.
2. WHEN `getClaimSummary` is called, THE claimApi module SHALL send an authenticated POST request to the Claim_Summary_API endpoint with the strategy and chunking method in the request body.
3. WHEN the API returns a successful response, THE `getClaimSummary` function SHALL return a typed `ClaimSummaryResponse` object containing `summary`, `anomalies`, `strategy`, `chunkingMethod`, `documentCount`, `processingTime`, and `generatedAt` fields.
4. IF the API request fails, THEN THE `getClaimSummary` function SHALL throw an error with the error message from the API response.

### Requirement 7: CDK Infrastructure for AgentCore and Orchestrator

**User Story:** As a DevOps engineer, I want the Orchestrator Lambda, AgentCore agents, Summary Cache Table, Summary Content Bucket, Evaluation Results Table, and API Gateway integration defined in CDK, so that the infrastructure is deployed consistently through the pipeline.

#### Acceptance Criteria

1. THE rag-application-stack SHALL define an Orchestrator Lambda function using the Node.js 20.x runtime.
2. THE rag-application-stack SHALL grant the Orchestrator Lambda IAM permissions to invoke AgentCore Runtime agents.
3. THE rag-application-stack SHALL grant the AgentCore agents IAM permissions to invoke Bedrock_Nova_Pro (`amazon.nova-pro-v1:0`).
4. THE rag-application-stack SHALL grant the AgentCore agents IAM permissions to read from the Documents_Table.
5. THE rag-application-stack SHALL grant the RAG_Agent IAM permissions to query the Knowledge_Base for RAG-based retrieval.
6. THE rag-application-stack SHALL create a DynamoDB table for the Summary_Cache_Table with partition key `cacheKey` (string) composed of claimId#strategy#chunkingMethod.
7. THE rag-application-stack SHALL create an S3 bucket for the Summary_Content_Bucket with server-side encryption enabled.
8. THE rag-application-stack SHALL grant the Orchestrator Lambda IAM permissions to read and write to the Summary_Cache_Table.
9. THE rag-application-stack SHALL grant the Orchestrator Lambda IAM permissions to read and write to the Summary_Content_Bucket.
10. THE rag-application-stack SHALL create a POST method on the API Gateway at the resource path `/claims/{claimId}/summary` integrated with the Orchestrator Lambda.
11. THE rag-application-stack SHALL configure the API Gateway method with Cognito authorizer for JWT validation.
12. THE rag-application-stack SHALL set the `DOCUMENTS_TABLE`, `SUMMARY_CACHE_TABLE`, `SUMMARY_CONTENT_BUCKET`, `EVALUATION_RESULTS_TABLE`, `BEDROCK_REGION`, and `KNOWLEDGE_BASE_ID` environment variables on the Orchestrator Lambda.
13. THE rag-application-stack SHALL set the Orchestrator Lambda timeout to 120 seconds to accommodate AgentCore agent invocation and evaluation processing.
14. THE rag-application-stack SHALL create a DynamoDB table for the Evaluation_Results_Table with partition key `claimId` (string) and sort key `strategyKey` (string).
15. THE rag-application-stack SHALL create a GET method on the API Gateway at the resource path `/claims/{claimId}/evaluations` integrated with the Orchestrator Lambda.

### Requirement 8: Summary Caching

**User Story:** As a claims reviewer, I want previously generated summaries to be cached, so that I can quickly access them without waiting for reprocessing.

#### Acceptance Criteria

1. WHEN a summary is successfully generated, THE Orchestrator_Lambda SHALL store the summary metadata in the Summary_Cache_Table with a composite key of claimId, strategy, and chunkingMethod.
2. WHEN a summary is successfully generated, THE Orchestrator_Lambda SHALL store the full summary text content in the Summary_Content_Bucket at the path `summaries/{claimId}/{strategy}/{chunkingMethod}.json`.
3. WHEN a summary request is received, THE Orchestrator_Lambda SHALL first check the Summary_Cache_Table for an existing cached entry matching the claimId, strategy, and chunkingMethod.
4. IF a cached entry exists, THEN THE Orchestrator_Lambda SHALL retrieve the summary content from the Summary_Content_Bucket using the stored S3 key and return it with a `cached: true` flag.
5. IF a cached entry exists, THEN THE Orchestrator_Lambda SHALL include the original `generatedAt` timestamp and a `cachedAt` timestamp in the response.
6. THE Claim_Summary_API SHALL accept an optional `forceRegenerate` boolean field in the request body to bypass the cache and generate a fresh summary.
7. WHEN `forceRegenerate` is true, THE Orchestrator_Lambda SHALL generate a new summary via the appropriate AgentCore agent, update the Summary_Cache_Table metadata, and overwrite the content in the Summary_Content_Bucket.
8. THE Summary_Cache_Table SHALL store the strategy, chunkingMethod, documentCount, processingTime, generatedAt timestamp, S3 key, and a list of document IDs that were included.
9. THE Claim_Summary_Modal SHALL display a "Regenerate" button when viewing a cached summary to allow users to force a fresh summary.
10. THE Claim_Summary_Modal SHALL indicate when a displayed summary is from cache by showing the cached timestamp.

### Requirement 9: Unit Tests for Orchestrator and Agents

**User Story:** As a developer, I want unit tests for the Orchestrator Lambda and AgentCore agents covering all three strategies, caching, and evaluations, so that I can verify the summarization logic works correctly in isolation.

#### Acceptance Criteria

1. THE unit tests SHALL verify that the Orchestrator Lambda returns a 400 status code when the request body is missing a claimId or strategy.
2. THE unit tests SHALL verify that the Orchestrator Lambda returns a 404 status code when no documents are found for the given claim.
3. THE unit tests SHALL verify that the full-context strategy returns a 200 status code with a summary when valid documents with extracted text are available.
4. THE unit tests SHALL verify that the RAG strategy invokes the Knowledge_Base with the correct chunking method parameter.
5. THE unit tests SHALL verify that the graph-rag strategy builds entity relationships and returns a summary.
6. THE unit tests SHALL verify that the Orchestrator Lambda returns a 502 status code when Bedrock_Nova_Pro invocation fails.
7. THE unit tests SHALL verify that the response includes an `anomalies` array when data inconsistencies are detected in the documents.
8. THE unit tests SHALL verify that a cached summary is returned when available and `forceRegenerate` is false.
9. THE unit tests SHALL verify that a new summary is generated when `forceRegenerate` is true even if a cached summary exists.
10. THE unit tests SHALL be located in the `unit_tests/` directory.

### Requirement 10: Summary Quality Evaluation

**User Story:** As a claims reviewer, I want to see quality scores for each summary so that I can compare the effectiveness of different summarization strategies and choose the best approach for my use case.

#### Acceptance Criteria

1. WHEN a summary is generated, THE AgentCore agent SHALL emit an OpenTelemetry trace containing the input claim ID, output summary, source documents, and detected anomalies.
2. THE AgentCore_Evaluations service SHALL process agent traces using the built-in Helpfulness evaluator and custom Faithfulness_Evaluator and Completeness_Evaluator.
3. WHEN evaluation scores are computed, THE Orchestrator Lambda SHALL store the scores in the Evaluation_Results_Table with the claimId and strategyKey.
4. THE Claim_Summary_API response SHALL include an `evaluation` object containing `helpfulness`, `faithfulness`, `completeness`, and `evaluatedAt` fields when `includeEvaluation` is true in the request.
5. WHEN displaying the summary, THE Claim_Summary_Modal SHALL render evaluation scores as visual indicators (percentage badges or star ratings) below the strategy information.
6. THE Claim_Summary_Modal SHALL color-code evaluation scores: green for scores >= 0.8, yellow for scores >= 0.5, and red for scores < 0.5.
7. THE Claim_Summary_API SHALL provide a GET endpoint at `/claims/{claimId}/evaluations` that returns evaluation scores for all strategies that have been run on a claim.
8. THE Claim_Summary_Modal SHALL include a "Compare Strategies" button that displays a side-by-side comparison of summaries and evaluation scores from different strategies.
9. THE Faithfulness_Evaluator SHALL score summaries on a 0-1 scale based on how accurately the summary reflects source documents without hallucinations.
10. THE Completeness_Evaluator SHALL score summaries on a 0-1 scale based on coverage of key claim elements: patient information, diagnosis codes, procedures, service dates, provider information, and amounts.
