# Implementation Plan: Claim Summary Feature

## Overview

Implement AI-powered claim summarization with three strategies (Full Context, RAG, Graph RAG) using Amazon Bedrock AgentCore. The implementation proceeds in phases: infrastructure first (CDK), then backend services (Orchestrator Lambda, AgentCore agents), then frontend components (ClaimSummaryModal, evaluation display), and finally integration testing. Property-based tests validate correctness properties from the design.

## Tasks

- [x] 1. Set up CDK infrastructure for claim summary feature
  - [x] 1.1 Create Summary_Cache_Table DynamoDB table in `infrastructure/rag-application-stack.ts`
    - Define table with partition key `cacheKey` (string)
    - Enable TTL on `ttl` attribute
    - Add GSI for querying by claimId if needed
    - _Requirements: 7.6_

  - [x] 1.2 Create Summary_Content_Bucket S3 bucket in `infrastructure/rag-application-stack.ts`
    - Enable server-side encryption (AES-256 or KMS)
    - Configure lifecycle rules for cost optimization
    - _Requirements: 7.7_

  - [x] 1.3 Create Evaluation_Results_Table DynamoDB table in `infrastructure/rag-application-stack.ts`
    - Define table with partition key `claimId` (string) and sort key `strategyKey` (string)
    - _Requirements: 7.14_

  - [x] 1.4 Create Orchestrator Lambda function in `infrastructure/rag-application-stack.ts`
    - Use Node.js 20.x runtime
    - Set timeout to 120 seconds
    - Configure environment variables: DOCUMENTS_TABLE, SUMMARY_CACHE_TABLE, SUMMARY_CONTENT_BUCKET, EVALUATION_RESULTS_TABLE, BEDROCK_REGION, KNOWLEDGE_BASE_ID
    - Grant IAM permissions for DynamoDB (Documents_Table, Summary_Cache_Table, Evaluation_Results_Table)
    - Grant IAM permissions for S3 (Summary_Content_Bucket)
    - Grant IAM permissions to invoke AgentCore Runtime agents
    - _Requirements: 7.1, 7.2, 7.8, 7.9, 7.12, 7.13_

  - [x] 1.5 Create API Gateway endpoints in `infrastructure/rag-application-stack.ts`
    - Add POST method at `/claims/{claimId}/summary` integrated with Orchestrator Lambda
    - Add GET method at `/claims/{claimId}/evaluations` integrated with Orchestrator Lambda
    - Configure Cognito authorizer for JWT validation on both endpoints
    - _Requirements: 7.10, 7.11, 7.15_

  - [x]* 1.6 Write unit tests for CDK infrastructure
    - Test Summary_Cache_Table has correct key schema
    - Test Summary_Content_Bucket has encryption enabled
    - Test Orchestrator Lambda has correct environment variables and timeout
    - Test API Gateway methods are configured with Cognito authorizer
    - _Requirements: 7.1-7.15_

- [x] 2. Checkpoint - Verify CDK infrastructure synthesizes correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement cache service and types
  - [x] 3.1 Create TypeScript types in `src/types/claim-summary.ts`
    - Define `ClaimSummaryRequest` interface with strategy, chunkingMethod, forceRegenerate, includeEvaluation fields
    - Define `ClaimSummaryResponse` interface with summary, anomalies, strategy, chunkingMethod, documentCount, processingTime, generatedAt, cached, cachedAt, evaluation fields
    - Define `DataAnomaly` interface with description, severity, sourceDocument, dataValues fields
    - Define `EvaluationScores` interface with helpfulness, faithfulness, completeness, anomalyAccuracy, evaluatedAt fields
    - Define `CachedSummary` interface for cache metadata
    - _Requirements: 3.9, 4.3, 6.3, 8.8, 10.4_

  - [x] 3.2 Implement cache service in `src/services/summary-cache.ts`
    - Implement `buildCacheKey(claimId, strategy, chunkingMethod)` function
    - Implement `getCachedSummary(cacheKey)` to query Summary_Cache_Table and retrieve content from S3
    - Implement `cacheSummary(cacheKey, summary)` to store metadata in DynamoDB and content in S3
    - Implement `invalidateCache(claimId)` to remove all cached summaries for a claim
    - Handle S3 path construction: `summaries/{claimId}/{strategy}/{chunkingMethod}.json`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.8_

  - [x]* 3.3 Write property test for cache key construction (Property 14)
    - **Property 14: Cache Write Completeness**
    - Generate arbitrary claimId, strategy, chunkingMethod values
    - Assert cache key format is `{claimId}#{strategy}#{chunkingMethod}`
    - Assert S3 path format is `summaries/{claimId}/{strategy}/{chunkingMethod}.json`
    - **Validates: Requirements 8.1, 8.2, 8.8**

- [x] 4. Implement Orchestrator Lambda
  - [x] 4.1 Create Orchestrator Lambda handler in `src/lambda/claim-summary-orchestrator.ts`
    - Parse and validate request body (strategy required, chunkingMethod for RAG)
    - Extract claimId from path parameters
    - Return 400 for missing/invalid strategy or chunkingMethod
    - _Requirements: 3.1, 3.2, 3.3, 9.1_

  - [x] 4.2 Implement cache check logic in Orchestrator Lambda
    - Check Summary_Cache_Table for existing entry when forceRegenerate is false
    - Return cached response with `cached: true`, original `generatedAt`, and `cachedAt` timestamp
    - Bypass cache when forceRegenerate is true
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 4.3 Implement agent routing logic in Orchestrator Lambda
    - Route to Full_Context_Agent when strategy is "full-context"
    - Route to RAG_Agent when strategy is "rag" (pass chunkingMethod)
    - Route to Graph_RAG_Agent when strategy is "graph-rag"
    - Handle agent invocation via AgentCore Runtime SDK
    - _Requirements: 3.4, 3.5, 3.8_

  - [x] 4.4 Implement response handling in Orchestrator Lambda
    - Store successful summary in cache (metadata in DynamoDB, content in S3)
    - Return 404 when no documents found for claim
    - Return 400 when no documents have extracted text
    - Return 502 when Bedrock/AgentCore invocation fails
    - Include evaluation scores in response when includeEvaluation is true
    - _Requirements: 3.9, 3.10, 3.11, 3.12, 8.1, 8.2, 10.4_

  - [x] 4.5 Implement GET /evaluations endpoint handler in Orchestrator Lambda
    - Query Evaluation_Results_Table by claimId
    - Return all evaluation scores for strategies run on the claim
    - _Requirements: 10.7_

  - [x]* 4.6 Write property test for strategy validation (Property 3)
    - **Property 3: Strategy Validation**
    - Generate arbitrary strings, assert only "full-context", "rag", "graph-rag" are accepted
    - Assert all other values return 400 status code
    - **Validates: Requirements 3.2**

  - [x]* 4.7 Write property test for chunking method validation (Property 4)
    - **Property 4: Chunking Method Validation for RAG Strategy**
    - Generate arbitrary strings for chunkingMethod when strategy is "rag"
    - Assert only "full-document" and "semantic" are accepted
    - **Validates: Requirements 3.3**

  - [x]* 4.8 Write property test for response structure (Property 7)
    - **Property 7: Summary Response Structure Completeness**
    - Generate valid requests, assert response contains all required fields
    - Assert summary is non-empty string, documentCount >= 1, processingTime >= 0, generatedAt is valid ISO 8601
    - **Validates: Requirements 3.9**

- [x] 5. Checkpoint - Verify Orchestrator Lambda handles requests correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Full Context Agent (Python)
  - [x] 6.1 Create Full Context Agent project structure in `agents/full_context_agent/`
    - Create `agent.py` with FullContextSummaryAgent class extending AgentCore Agent
    - Create `requirements.txt` with bedrock-agentcore, boto3, opentelemetry dependencies
    - Create `Dockerfile` for AgentCore Runtime deployment
    - _Requirements: 3.4, 7.3, 7.4_

  - [x] 6.2 Implement document retrieval in Full Context Agent
    - Query Documents_Table by claimId
    - Concatenate all extractedText from documents
    - Return 404 equivalent if no documents found
    - Return 400 equivalent if no documents have extractedText
    - _Requirements: 3.4, 3.10, 3.11_

  - [x] 6.3 Implement anomaly detection in Full Context Agent
    - Analyze documents for chronological impossibilities (service date before birth date)
    - Detect payment dates before service dates
    - Detect diagnosis codes inconsistent with demographics
    - Detect duplicate or conflicting information
    - Return anomalies array with description, severity, sourceDocument, dataValues
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.4 Implement summary generation in Full Context Agent
    - Invoke Bedrock Nova Pro with combined document text and anomaly context
    - Include anomaly detection instructions in prompt
    - Return structured response with summary, anomalies, documentCount, strategy
    - _Requirements: 3.4, 4.1_

  - [x] 6.5 Implement OpenTelemetry tracing in Full Context Agent
    - Emit trace with input claimId, output summary, source documents, detected anomalies
    - Set span attributes for document_count and anomaly_count
    - _Requirements: 10.1_

  - [x]* 6.6 Write property test for document retrieval (Property 5)
    - **Property 5: Full Context Strategy Document Retrieval**
    - Generate N documents with extractedText, assert combined text contains all N documents' text
    - **Validates: Requirements 3.4**

  - [x]* 6.7 Write property test for anomaly detection (Property 8)
    - **Property 8: Anomaly Detection for Chronological Impossibilities**
    - Generate documents with service date before birth date
    - Assert anomaly with severity "critical" is returned
    - **Validates: Requirements 4.2**

- [x] 7. Implement RAG Agent (Python)
  - [x] 7.1 Create RAG Agent project structure in `agents/rag_agent/`
    - Create `agent.py` with RAGSummaryAgent class extending AgentCore Agent
    - Create `requirements.txt` with bedrock-agentcore, boto3, opentelemetry dependencies
    - Create `Dockerfile` for AgentCore Runtime deployment
    - _Requirements: 3.5, 7.3, 7.5_

  - [x] 7.2 Implement Knowledge Base retrieval in RAG Agent
    - Query Knowledge Base with claim-context query
    - Support full-document chunking method
    - Support semantic chunking method
    - Return relevant document chunks
    - _Requirements: 3.5, 3.6, 3.7_

  - [x] 7.3 Implement anomaly detection in RAG Agent
    - Analyze retrieved chunks for data anomalies
    - Return anomalies array with same structure as Full Context Agent
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 7.4 Implement summary generation in RAG Agent
    - Invoke Bedrock Nova Pro with retrieved chunks and anomaly context
    - Return structured response with summary, anomalies, documentCount, strategy, chunkingMethod
    - _Requirements: 3.5, 3.6, 3.7_

  - [x] 7.5 Implement OpenTelemetry tracing in RAG Agent
    - Emit trace with input claimId, chunkingMethod, output summary, retrieved chunks, detected anomalies
    - _Requirements: 10.1_

- [x] 8. Implement Graph RAG Agent (Python)
  - [x] 8.1 Create Graph RAG Agent project structure in `agents/graph_rag_agent/`
    - Create `agent.py` with GraphRAGSummaryAgent class extending AgentCore Agent
    - Create `requirements.txt` with bedrock-agentcore, boto3, networkx, opentelemetry dependencies
    - Create `Dockerfile` for AgentCore Runtime deployment
    - _Requirements: 3.8, 7.3, 7.4_

  - [x] 8.2 Implement knowledge graph construction in Graph RAG Agent
    - Build in-memory graph using networkx
    - Extract entities: patients, providers, diagnoses, procedures, dates, amounts
    - Create relationships between entities
    - _Requirements: 3.8_

  - [x] 8.3 Implement graph-based anomaly detection in Graph RAG Agent
    - Detect anomalies via graph analysis (conflicting relationships, impossible connections)
    - Return anomalies array with same structure as other agents
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.4 Implement summary generation in Graph RAG Agent
    - Traverse graph for connected context
    - Invoke Bedrock Nova Pro with graph context and anomaly information
    - Return structured response with summary, anomalies, documentCount, strategy, entityCount
    - _Requirements: 3.8_

  - [x] 8.5 Implement OpenTelemetry tracing in Graph RAG Agent
    - Emit trace with input claimId, output summary, graph entities, detected anomalies
    - _Requirements: 10.1_

  - [x]* 8.6 Write property test for entity extraction (Property 6)
    - **Property 6: Graph RAG Entity Extraction**
    - Generate documents with known entities, assert graph contains nodes for those entities
    - **Validates: Requirements 3.8**

- [x] 9. Checkpoint - Verify all agents work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement custom AgentCore evaluators
  - [x] 10.1 Create Faithfulness evaluator in `evaluators/faithfulness_evaluator.py`
    - Implement LLM-as-a-Judge prompt for faithfulness scoring
    - Score summaries on 0-1 scale based on accuracy to source documents
    - Return score and reasoning in JSON format
    - _Requirements: 10.9_

  - [x] 10.2 Create Completeness evaluator in `evaluators/completeness_evaluator.py`
    - Implement LLM-as-a-Judge prompt for completeness scoring
    - Check coverage of key claim elements: patient, diagnosis, procedures, dates, provider, amounts
    - Score summaries on 0-1 scale
    - Return score, reasoning, and missing_elements in JSON format
    - _Requirements: 10.10_

  - [x] 10.3 Configure AgentCore Evaluations for online evaluation
    - Set up evaluation configuration to process agent traces
    - Configure built-in Helpfulness evaluator
    - Configure custom Faithfulness and Completeness evaluators
    - Store scores in Evaluation_Results_Table
    - _Requirements: 10.2, 10.3_

  - [x]* 10.4 Write property test for evaluation score structure (Property 18)
    - **Property 18: Evaluation Score Structure**
    - Generate evaluation responses, assert helpfulness, faithfulness, completeness are 0-1 numbers
    - Assert evaluatedAt is valid ISO 8601 timestamp
    - **Validates: Requirements 10.1, 10.3**

- [x] 11. Checkpoint - Verify evaluators score summaries correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update ClaimDetailPage with separate buttons
  - [x] 12.1 Update `frontend/src/components/ClaimDetailPage.tsx` button rendering
    - Replace single "View Documents & Summary" button with two separate buttons
    - Add "View Documents" button that opens DocumentListModal
    - Add "Summarize Claim" button adjacent to "View Documents" button
    - Show "Summarize Claim" button only for claims with status "completed"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 12.2 Add state management for ClaimSummaryModal in ClaimDetailPage
    - Add state: `summaryModalClaimId: string | null`
    - Implement `handleSummarizeClaim(claimId)` to open ClaimSummaryModal
    - _Requirements: 1.3, 5.1_

  - [x]* 12.3 Write property test for button rendering (Property 1)
    - **Property 1: Completed Claim Button Rendering**
    - Generate claims with status "completed", assert both buttons render
    - **Validates: Requirements 1.1, 1.2**

  - [x]* 12.4 Write property test for non-completed claims (Property 2)
    - **Property 2: Non-Completed Claim Hides Summarize Button**
    - Generate claims with non-completed status, assert "Summarize Claim" button does not render
    - **Validates: Requirements 1.4**

- [x] 13. Implement ClaimSummaryModal component
  - [x] 13.1 Create `frontend/src/components/ClaimSummaryModal.tsx` base structure
    - Accept props: isOpen, onClose, claimId
    - Render modal overlay with focus trap
    - Implement Escape key handler to close modal
    - Implement backdrop click to close modal
    - Add `role="dialog"` and `aria-modal="true"` for accessibility
    - _Requirements: 5.1, 5.5, 5.6, 5.7_

  - [x] 13.2 Implement strategy selection UI in ClaimSummaryModal
    - Display three strategy options: "Full Context", "RAG", "Graph RAG"
    - Default to "Full Context" strategy on initial open
    - Show chunking method selector when "RAG" is selected
    - Display strategy descriptions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 13.3 Implement summary generation flow in ClaimSummaryModal
    - Add "Generate Summary" button
    - Display loading indicator during API call
    - Call `getClaimSummary` API with selected strategy and chunking method
    - Display error message on API failure
    - _Requirements: 5.2, 5.4_

  - [x] 13.4 Implement summary display in ClaimSummaryModal
    - Display summary text, strategy, chunking method (if RAG), document count, processing time
    - Display anomalies in prominent alert section at top
    - Color-code anomalies by severity: red (critical), yellow (warning), blue (info)
    - Display green "No data anomalies detected" indicator when no anomalies
    - _Requirements: 5.3, 4.5, 4.6, 4.7_

  - [x] 13.5 Implement cache display and regeneration in ClaimSummaryModal
    - Display cached timestamp when viewing cached summary
    - Add "Regenerate" button for cached summaries
    - Allow strategy change and regeneration without closing modal
    - _Requirements: 8.9, 8.10, 5.8_

  - [x]* 13.6 Write property test for anomaly color coding (Property 10)
    - **Property 10: Anomaly Severity Color Coding**
    - Generate anomalies with different severities, assert correct colors applied
    - **Validates: Requirements 4.6**

  - [x]* 13.7 Write property test for modal response display (Property 11)
    - **Property 11: Modal Response Display Completeness**
    - Generate ClaimSummaryResponse, assert all required fields displayed
    - **Validates: Requirements 5.3**

- [x] 14. Implement EvaluationScoreDisplay component
  - [x] 14.1 Create `frontend/src/components/EvaluationScoreDisplay.tsx`
    - Accept props: scores (EvaluationScores), strategy
    - Display helpfulness, faithfulness, completeness as visual indicators
    - Color-code scores: green >= 0.8, yellow >= 0.5, red < 0.5
    - Display evaluatedAt timestamp
    - _Requirements: 10.5, 10.6_

  - [x] 14.2 Integrate EvaluationScoreDisplay into ClaimSummaryModal
    - Display evaluation scores below strategy information
    - Show scores when includeEvaluation response contains evaluation data
    - _Requirements: 10.5_

- [x] 15. Implement StrategyComparisonPanel component
  - [x] 15.1 Create `frontend/src/components/StrategyComparisonPanel.tsx`
    - Accept props: claimId, summaries (Map of strategy to ClaimSummaryResponse)
    - Display side-by-side comparison of summaries from different strategies
    - Show evaluation scores for each strategy
    - Highlight which strategy scored best on each metric
    - _Requirements: 10.8_

  - [x] 15.2 Add "Compare Strategies" button to ClaimSummaryModal
    - Fetch evaluations for all strategies via GET /evaluations endpoint
    - Open StrategyComparisonPanel with comparison data
    - _Requirements: 10.8_

- [x] 16. Implement API client functions
  - [x] 16.1 Add `getClaimSummary` function to `frontend/src/services/claimApi.ts`
    - Accept claimId, strategy, optional chunkingMethod, optional forceRegenerate, optional includeEvaluation
    - Send authenticated POST request to `/claims/{claimId}/summary`
    - Return typed ClaimSummaryResponse
    - Throw error with API error message on failure
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 16.2 Add `getClaimEvaluations` function to `frontend/src/services/claimApi.ts`
    - Accept claimId
    - Send authenticated GET request to `/claims/{claimId}/evaluations`
    - Return typed evaluation results for all strategies
    - _Requirements: 10.7_

  - [x]* 16.3 Write property test for API client request construction (Property 12)
    - **Property 12: API Client Request Construction**
    - Generate arbitrary claimId, strategy, chunkingMethod
    - Assert POST request sent to correct endpoint with correct body
    - **Validates: Requirements 6.2**

  - [x]* 16.4 Write property test for API client response parsing (Property 13)
    - **Property 13: API Client Response Parsing**
    - Generate valid API responses, assert all fields typed correctly
    - **Validates: Requirements 6.3**

- [x] 17. Checkpoint - Verify frontend components work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Write comprehensive unit tests
  - [x] 18.1 Create `unit_tests/claim-summary.test.ts` for Orchestrator Lambda
    - Test missing claimId returns 400
    - Test missing strategy returns 400
    - Test invalid strategy returns 400
    - Test invalid chunkingMethod for RAG returns 400
    - Test no documents returns 404
    - Test no processed documents returns 400
    - Test Bedrock failure returns 502
    - Test cached summary returned with correct flags
    - Test forceRegenerate bypasses cache
    - Test anomalies array returned when detected
    - _Requirements: 9.1-9.10_

  - [x] 18.2 Create `unit_tests/claim-summary-modal.test.tsx` for frontend components
    - Test modal displays three strategy options
    - Test RAG selection shows chunking method selector
    - Test anomalies render with correct colors
    - Test strategy selection updates state
    - Test Generate button triggers API call
    - Test close button/Escape/backdrop click closes modal
    - Test modal has role="dialog" and aria-modal="true"
    - _Requirements: 2.1, 2.3, 4.6, 5.5, 5.6, 5.7_

  - [x]* 18.3 Write property test for cache behavior (Properties 15, 16, 17)
    - **Property 15: Cache Check Before Generation**
    - **Property 16: Cache Hit Response**
    - **Property 17: Force Regeneration Behavior**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7**

  - [x]* 18.4 Write property test for anomaly structure (Property 9)
    - **Property 9: Anomaly Response Structure**
    - Generate anomalies, assert all required fields present
    - **Validates: Requirements 4.3**

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations per property
- Unit tests go in `unit_tests/` directory per project guidelines
- Orchestrator Lambda uses TypeScript (Node.js 20.x runtime)
- AgentCore agents use Python and are deployed to AgentCore Runtime
- Custom evaluators use Python and LLM-as-a-Judge pattern
- In-memory graph uses networkx (Python) for Graph RAG MVP
- Hybrid caching: DynamoDB for metadata, S3 for content storage
- All API endpoints require Cognito JWT authentication

