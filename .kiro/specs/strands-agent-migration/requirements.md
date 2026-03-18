# Requirements Document

## Introduction

This specification covers the migration of three existing Python insurance claim summary agents (Full Context, RAG, and Graph RAG) from their current custom class-based implementation to the Strands Agents SDK. Each agent is deployed as a Docker container to AWS Bedrock AgentCore Runtime. The migration converts business logic (document retrieval, anomaly detection, knowledge graph construction) into Strands `@tool` decorated functions, replaces manual Bedrock invocation with Strands `Agent` orchestration, and updates the AgentCore Runtime entry point to use the `@app.entrypoint` decorator pattern. Existing response formats, anomaly detection behavior, and deployment model must be preserved.

## Glossary

- **Strands_SDK**: The Strands Agents SDK (`strands-agents`), a Python framework that provides `Agent`, `@tool`, and `BedrockModel` abstractions for building AI agents
- **AgentCore_Runtime**: Amazon Bedrock AgentCore Runtime, the Docker-based deployment target for agents using `BedrockAgentCoreApp`
- **Full_Context_Agent**: The agent that retrieves all documents for a claim from DynamoDB, concatenates extracted text, detects anomalies, and generates a summary via Bedrock Nova Pro
- **RAG_Agent**: The agent that queries AWS Bedrock Knowledge Base for relevant document chunks, detects anomalies in retrieved content, and generates a summary via Bedrock Nova Pro
- **Graph_RAG_Agent**: The agent that retrieves all documents from DynamoDB, builds an in-memory knowledge graph using networkx, detects anomalies via graph analysis, and generates a summary via Bedrock Nova Pro
- **Strands_Tool**: A Python function decorated with `@tool` from the Strands SDK that the Agent can invoke; uses docstrings and type hints for automatic specification generation
- **Strands_Agent**: An instance of `strands.Agent` configured with a model, tools list, and system prompt that orchestrates tool calls and generates responses
- **BedrockModel**: The Strands SDK model provider class (`strands.models.BedrockModel`) used to configure the Bedrock Nova Pro model
- **Anomaly**: A data inconsistency detected in claim documents, categorized by type (chronological impossibility, payment-before-service, conflicting patient names, conflicting DOBs) with severity level (critical or warning)
- **Knowledge_Graph**: An in-memory directed graph built with networkx containing entity nodes (patients, providers, diagnoses, procedures, dates, amounts) and relationship edges
- **Documents_Table**: The DynamoDB table (`rag-app-documents-dev`) storing document records with `documentId` as partition key and no sort key
- **Knowledge_Base**: The AWS Bedrock Knowledge Base (`rag-app-v2-kb-dev`) used by the RAG agent for document chunk retrieval

## Requirements

### Requirement 1: Full Context Agent Strands Tool Migration

**User Story:** As a developer, I want the Full Context Agent's business logic converted to Strands `@tool` functions, so that the agent orchestration is handled by the Strands SDK instead of custom class methods.

#### Acceptance Criteria

1. WHEN the Full_Context_Agent is initialized, THE Strands_Agent SHALL be configured with a BedrockModel using model ID `us.amazon.nova-pro-v1:0` and region from the `BEDROCK_REGION` environment variable
2. THE Full_Context_Agent SHALL expose a `retrieve_claim_documents` Strands_Tool that scans the Documents_Table with a filter on `claimMetadata.claimId` and returns documents with extracted text
3. THE Full_Context_Agent SHALL expose a `detect_anomalies` Strands_Tool that accepts a list of document records and returns a list of Anomaly dicts with fields `description`, `severity`, `sourceDocument`, and `dataValues`
4. THE Full_Context_Agent SHALL expose a `combine_document_text` Strands_Tool that concatenates extracted text from all documents with document separators in the format `--- Document: {fileName} ---`
5. IF the Documents_Table scan returns zero documents for a claim ID, THEN THE `retrieve_claim_documents` Strands_Tool SHALL raise an error indicating no documents were found
6. IF no documents contain extracted text, THEN THE `retrieve_claim_documents` Strands_Tool SHALL raise an error indicating no summarizable content is available
7. WHEN the Full_Context_Agent processes a claim, THE Strands_Agent SHALL return a response containing `summary`, `anomalies`, `documentCount`, and `strategy` set to `full-context`

### Requirement 2: RAG Agent Strands Tool Migration

**User Story:** As a developer, I want the RAG Agent's business logic converted to Strands `@tool` functions, so that Knowledge Base retrieval and anomaly detection are orchestrated by the Strands SDK.

#### Acceptance Criteria

1. WHEN the RAG_Agent is initialized, THE Strands_Agent SHALL be configured with a BedrockModel using model ID `us.amazon.nova-pro-v1:0` and region from the `BEDROCK_REGION` environment variable
2. THE RAG_Agent SHALL expose a `retrieve_chunks` Strands_Tool that queries the Knowledge_Base using the Bedrock Agent Runtime `retrieve` API with the claim ID
3. THE `retrieve_chunks` Strands_Tool SHALL support `full-document` chunking (5 results) and `semantic` chunking (10 results) methods
4. THE RAG_Agent SHALL expose a `detect_anomalies` Strands_Tool that accepts a list of chunk dicts and returns a list of Anomaly dicts with fields `description`, `severity`, `sourceDocument`, and `dataValues`
5. IF the Knowledge_Base retrieval returns zero results for a claim ID, THEN THE `retrieve_chunks` Strands_Tool SHALL raise an error indicating no documents were found
6. WHEN the RAG_Agent processes a claim, THE Strands_Agent SHALL return a response containing `summary`, `anomalies`, `documentCount`, `strategy` set to `rag`, and `chunkingMethod`

### Requirement 3: Graph RAG Agent Strands Tool Migration

**User Story:** As a developer, I want the Graph RAG Agent's business logic converted to Strands `@tool` functions, so that knowledge graph construction and graph-based anomaly detection are orchestrated by the Strands SDK.

#### Acceptance Criteria

1. WHEN the Graph_RAG_Agent is initialized, THE Strands_Agent SHALL be configured with a BedrockModel using model ID `us.amazon.nova-pro-v1:0` and region from the `BEDROCK_REGION` environment variable
2. THE Graph_RAG_Agent SHALL expose a `retrieve_claim_documents` Strands_Tool that scans the Documents_Table with a filter on `claimMetadata.claimId` and returns documents with extracted text
3. THE Graph_RAG_Agent SHALL expose a `build_knowledge_graph` Strands_Tool that constructs a networkx DiGraph with entity nodes (patients, providers, diagnoses, procedures, dates, amounts) and relationship edges from document text
4. THE Graph_RAG_Agent SHALL expose a `detect_graph_anomalies` Strands_Tool that analyzes the Knowledge_Graph for conflicting DOBs, chronological impossibilities, payment-before-service dates, and conflicting patient names
5. THE Graph_RAG_Agent SHALL expose an `extract_entities` Strands_Tool that returns a list of entity dicts with `id`, `type`, `label`, and `properties` from the Knowledge_Graph
6. WHEN the Graph_RAG_Agent processes a claim, THE Strands_Agent SHALL return a response containing `summary`, `anomalies`, `documentCount`, `strategy` set to `graph-rag`, and `entityCount`

### Requirement 4: Anomaly Detection Behavioral Preservation

**User Story:** As a claims analyst, I want the migrated agents to detect the same data anomalies with the same severity levels, so that no anomaly detection capability is lost during migration.

#### Acceptance Criteria

1. WHEN a document contains a service date that precedes the patient birth date, THE `detect_anomalies` Strands_Tool SHALL return an Anomaly with severity `critical` and a description containing both dates
2. WHEN a document contains a payment date that precedes the service date, THE `detect_anomalies` Strands_Tool SHALL return an Anomaly with severity `critical` and a description containing both dates
3. WHEN multiple documents contain different patient names, THE `detect_anomalies` Strands_Tool SHALL return an Anomaly with severity `warning` listing the conflicting names
4. WHEN the Graph_RAG_Agent detects a patient with multiple different dates of birth in the Knowledge_Graph, THE `detect_graph_anomalies` Strands_Tool SHALL return an Anomaly with severity `critical` listing the conflicting DOBs
5. THE Anomaly detection Strands_Tools SHALL parse dates in ISO format (`YYYY-MM-DD`) and US format (`MM/DD/YYYY`) from text labels including `birth date`, `dob`, `date of birth`, `service date`, `date of service`, `dos`, `payment date`, `paid date`, and `date paid`
6. WHEN no anomalies are present in the documents, THE `detect_anomalies` Strands_Tool SHALL return an empty list

### Requirement 5: AgentCore Runtime Deployment Compatibility

**User Story:** As a DevOps engineer, I want the migrated agents to deploy to AgentCore Runtime using the same Docker container model, so that the existing deployment pipeline continues to work.

#### Acceptance Criteria

1. THE Full_Context_Agent SHALL use `BedrockAgentCoreApp` with an `@app.entrypoint` decorated function as the invocation entry point
2. THE RAG_Agent SHALL use `BedrockAgentCoreApp` with an `@app.entrypoint` decorated function as the invocation entry point
3. THE Graph_RAG_Agent SHALL use `BedrockAgentCoreApp` with an `@app.entrypoint` decorated function as the invocation entry point
4. WHEN the `@app.entrypoint` function receives a payload, THE entry point SHALL extract the `claim_id` parameter and pass it to the Strands_Agent
5. THE Dockerfile for each agent SHALL install `strands-agents` and `strands-agents-builder` packages in addition to existing dependencies
6. THE Dockerfile for each agent SHALL remove `opentelemetry-api`, `opentelemetry-sdk`, and `opentelemetry-exporter-otlp` from requirements since Strands SDK handles tracing
7. THE entry point module for each agent SHALL call `app.run()` when executed as `__main__`

### Requirement 6: Environment Variable Preservation

**User Story:** As a DevOps engineer, I want the migrated agents to use the same environment variables, so that no deployment configuration changes are needed.

#### Acceptance Criteria

1. THE Full_Context_Agent SHALL read `DOCUMENTS_TABLE` (default: `rag-app-documents-dev`), `BEDROCK_REGION` (default: `us-east-1`), and `BEDROCK_MODEL_ID` (default: `amazon.nova-pro-v1:0`) from environment variables
2. THE RAG_Agent SHALL read `KNOWLEDGE_BASE_ID` (default: `rag-app-v2-kb-dev`), `BEDROCK_REGION` (default: `us-east-1`), and `BEDROCK_MODEL_ID` (default: `amazon.nova-pro-v1:0`) from environment variables
3. THE Graph_RAG_Agent SHALL read `DOCUMENTS_TABLE` (default: `rag-app-documents-dev`), `BEDROCK_REGION` (default: `us-east-1`), and `BEDROCK_MODEL_ID` (default: `amazon.nova-pro-v1:0`) from environment variables

### Requirement 7: Response Format Preservation

**User Story:** As a developer integrating with the agents, I want the migrated agents to return the same response structure, so that downstream consumers do not need changes.

#### Acceptance Criteria

1. THE Full_Context_Agent `@app.entrypoint` function SHALL return a dict with keys `summary` (str), `anomalies` (list of Anomaly dicts), `documentCount` (int), and `strategy` (str, value `full-context`)
2. THE RAG_Agent `@app.entrypoint` function SHALL return a dict with keys `summary` (str), `anomalies` (list of Anomaly dicts), `documentCount` (int), `strategy` (str, value `rag`), and `chunkingMethod` (str)
3. THE Graph_RAG_Agent `@app.entrypoint` function SHALL return a dict with keys `summary` (str), `anomalies` (list of Anomaly dicts), `documentCount` (int), `strategy` (str, value `graph-rag`), and `entityCount` (int)
4. THE Anomaly dict SHALL contain keys `description` (str), `severity` (str, one of `critical` or `warning`), `sourceDocument` (str), and `dataValues` (dict with at least one entry)

### Requirement 8: Strands Tool Specification Quality

**User Story:** As a developer, I want each Strands tool to have clear docstrings and type hints, so that the Strands SDK can generate accurate tool specifications for the agent.

#### Acceptance Criteria

1. THE each Strands_Tool function SHALL have a docstring describing the tool purpose, parameters, and return value
2. THE each Strands_Tool function SHALL use Python type hints for all parameters and the return type
3. THE each Strands_Tool function SHALL use the `@tool` decorator from `strands`

### Requirement 9: System Prompt Configuration

**User Story:** As a developer, I want each Strands Agent to have a system prompt that guides the agent to use the correct tools and produce the expected output format, so that the agent behaves consistently.

#### Acceptance Criteria

1. THE Full_Context_Agent Strands_Agent SHALL have a system prompt instructing the agent to retrieve all documents, combine text, detect anomalies, and return a structured JSON response with `summary`, `anomalies`, `documentCount`, and `strategy`
2. THE RAG_Agent Strands_Agent SHALL have a system prompt instructing the agent to retrieve chunks from the Knowledge Base, detect anomalies, and return a structured JSON response with `summary`, `anomalies`, `documentCount`, `strategy`, and `chunkingMethod`
3. THE Graph_RAG_Agent Strands_Agent SHALL have a system prompt instructing the agent to retrieve documents, build a knowledge graph, extract entities, detect anomalies, and return a structured JSON response with `summary`, `anomalies`, `documentCount`, `strategy`, and `entityCount`

### Requirement 10: Unit Test Migration

**User Story:** As a developer, I want the existing property-based tests updated to validate the migrated Strands tool functions, so that behavioral correctness is verified after migration.

#### Acceptance Criteria

1. THE unit tests SHALL import agent modules using `importlib.util.spec_from_file_location` to avoid path conflicts
2. THE unit tests SHALL use `hypothesis` for property-based testing with a minimum of 100 iterations per property test
3. THE unit tests SHALL be located in the `unit_tests/` directory
4. THE unit tests for the Full_Context_Agent SHALL verify that `combine_document_text` includes all document texts and preserves document order
5. THE unit tests for the Full_Context_Agent SHALL verify that `detect_anomalies` returns critical anomalies when service dates precede birth dates and when payment dates precede service dates
6. THE unit tests for the Graph_RAG_Agent SHALL verify that `build_knowledge_graph` extracts patient, provider, diagnosis, procedure, date, and amount entities from document text
7. THE unit tests SHALL verify that anomaly dicts contain the required fields: `description`, `severity`, `sourceDocument`, and `dataValues`
