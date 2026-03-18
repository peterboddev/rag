# Implementation Plan: Strands Agent Migration

## Overview

Migrate three Python insurance claim summary agents (Full Context, RAG, Graph RAG) from custom class-based architecture to Strands Agents SDK. Each agent's business logic is converted to `@tool` decorated functions with `_impl` helper functions for testability, orchestrated by `strands.Agent` with `BedrockModel`, and deployed via `BedrockAgentCoreApp` entry point. Dependencies are updated to replace OpenTelemetry with Strands SDK packages.

## Tasks

- [x] 1. Update dependencies and Dockerfiles for all three agents
  - [x] 1.1 Update `agents/full_context_agent/requirements.txt` to add `strands-agents>=0.1.0`, `strands-agents-builder>=0.1.0`, `bedrock-agentcore>=0.1.0` and remove `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp`
    - _Requirements: 5.5, 5.6_
  - [x] 1.2 Update `agents/rag_agent/requirements.txt` with the same dependency changes
    - _Requirements: 5.5, 5.6_
  - [x] 1.3 Update `agents/graph_rag_agent/requirements.txt` with the same dependency changes (preserve `networkx>=3.2.0`)
    - _Requirements: 5.5, 5.6_
  - [x] 1.4 Update `agents/full_context_agent/Dockerfile` to change CMD to `["python", "agent.py"]` for `BedrockAgentCoreApp` entry point
    - _Requirements: 5.1, 5.7_
  - [x] 1.5 Update `agents/rag_agent/Dockerfile` with the same CMD change
    - _Requirements: 5.2, 5.7_
  - [x] 1.6 Update `agents/graph_rag_agent/Dockerfile` with the same CMD change
    - _Requirements: 5.3, 5.7_

- [x] 2. Migrate Full Context Agent to Strands SDK
  - [x] 2.1 Rewrite `agents/full_context_agent/agent.py` to replace the `FullContextSummaryAgent` class with module-level Strands architecture
    - Remove OpenTelemetry imports and tracer setup
    - Add imports for `strands` (`Agent`, `tool`), `strands.models` (`BedrockModel`), and `bedrock_agentcore.runtime` (`BedrockAgentCoreApp`)
    - Initialize module-level DynamoDB resource and Bedrock clients
    - Implement `_retrieve_claim_documents_impl(claim_id: str) -> list[dict]` helper with existing DynamoDB scan logic (filter on `claimMetadata.claimId`, pagination, empty-doc and no-text error handling)
    - Implement `@tool` decorated `retrieve_claim_documents(claim_id: str) -> str` that calls the impl and returns JSON
    - Implement `_combine_document_text_impl(documents: list[dict]) -> str` helper with `--- Document: {fileName} ---` separator format
    - Implement `@tool` decorated `combine_document_text(documents: str) -> str` that parses JSON input and calls the impl
    - Implement `_detect_anomalies_impl(documents: list[dict]) -> list[dict]` helper preserving all existing anomaly detection logic (`_find_dates`, `_parse_date`, chronological checks, payment-before-service checks, cross-document patient name conflicts)
    - Implement `@tool` decorated `detect_anomalies(documents: str) -> str` that parses JSON input and calls the impl
    - Configure `BedrockModel` with `model_id=f"us.{BEDROCK_MODEL_ID}"`, `region_name=BEDROCK_REGION`, `temperature=0.3`, `max_tokens=2000`
    - Configure `Agent` with model, tools list `[retrieve_claim_documents, combine_document_text, detect_anomalies]`, and system prompt per design
    - Implement `parse_agent_response(result, strategy="full-context", default_count=0)` helper
    - Implement `BedrockAgentCoreApp` with `@app.entrypoint` decorated `invoke(payload)` that extracts `claim_id` and calls the agent
    - Add `if __name__ == "__main__": app.run()` block
    - All `@tool` functions must have docstrings and type hints
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 5.4, 5.7, 6.1, 7.1, 7.4, 8.1, 8.2, 8.3, 9.1_

  - [x]* 2.2 Write property test for combined text (Property 1)
    - **Property 1: Combined text includes all documents and preserves order**
    - Update `unit_tests/test_full_context_agent.py` to test the new `_combine_document_text_impl` function
    - Use `importlib.util.spec_from_file_location` for import
    - Use `@given` with lists of documents having non-empty `extractedText` and unique `fileName` values
    - Assert output contains every document's `extractedText` verbatim, contains `--- Document: {fileName} ---` for each, and separators appear in input order
    - `@settings(max_examples=100)`
    - **Validates: Requirements 1.4, 10.4**

  - [x]* 2.3 Write property test for anomaly dict structure (Property 2)
    - **Property 2: Anomaly dict structure invariant**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with documents that trigger at least one anomaly (service date before birth date)
    - Assert every anomaly dict has keys `description` (non-empty str), `severity` (one of `"critical"` or `"warning"`), `sourceDocument` (str), and `dataValues` (dict with at least one entry)
    - `@settings(max_examples=100)`
    - **Validates: Requirements 1.3, 2.4, 7.4, 10.7**

  - [x]* 2.4 Write property test for chronological impossibility detection (Property 3)
    - **Property 3: Chronological impossibility detection (service before birth)**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with birth date B and service date S where S < B in ISO format
    - Assert `_detect_anomalies_impl` returns at least one anomaly with `severity == "critical"` and `description` containing both date strings
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.1, 10.5**

  - [x]* 2.5 Write property test for payment-before-service detection (Property 4)
    - **Property 4: Payment-before-service detection**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with service date S and payment date P where P < S in ISO format
    - Assert `_detect_anomalies_impl` returns at least one anomaly with `severity == "critical"` and `description` containing both date strings
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.2, 10.5**

  - [x]* 2.6 Write property test for conflicting patient names detection (Property 5)
    - **Property 5: Conflicting patient names detection**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with 2+ documents each containing a distinct patient name via `Patient Name: X` pattern
    - Assert `_detect_anomalies_impl` returns at least one anomaly with `severity == "warning"` and `description` containing all distinct names
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.3**

  - [x]* 2.7 Write property test for date parsing across formats and labels (Property 9)
    - **Property 9: Date parsing across formats and labels**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with valid ISO date D and label from {`birth date`, `dob`, `date of birth`, `service date`, `date of service`, `dos`, `payment date`, `paid date`, `date paid`}
    - Assert `_find_dates` returns D in its results when given text `"{Label}: {D}"`
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.5**

  - [x]* 2.8 Write property test for no false positive anomalies (Property 10)
    - **Property 10: No false positive anomalies for consistent documents**
    - Add to `unit_tests/test_full_context_agent.py`
    - Use `@given` with documents where all patient names are identical, all birth dates identical and precede all service dates, and all payment dates follow all service dates
    - Assert `_detect_anomalies_impl` returns an empty list
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.6**

- [x] 3. Checkpoint - Verify Full Context Agent migration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Migrate RAG Agent to Strands SDK
  - [x] 4.1 Rewrite `agents/rag_agent/agent.py` to replace the `RAGSummaryAgent` class with module-level Strands architecture
    - Remove OpenTelemetry imports and tracer setup
    - Add imports for `strands` (`Agent`, `tool`), `strands.models` (`BedrockModel`), and `bedrock_agentcore.runtime` (`BedrockAgentCoreApp`)
    - Initialize module-level Bedrock Agent Runtime client
    - Implement `_retrieve_chunks_impl(claim_id: str, chunking_method: str) -> list[dict]` helper with existing Knowledge Base retrieval logic (full-document: 5 results, semantic: 10 results, S3 URI parsing, empty-result error handling)
    - Implement `@tool` decorated `retrieve_chunks(claim_id: str, chunking_method: str) -> str` that calls the impl and returns JSON
    - Implement `_detect_anomalies_impl(chunks: list[dict]) -> list[dict]` helper preserving anomaly detection logic (chronological checks, payment-before-service, cross-chunk patient name conflicts) using `text` and `source_document` fields from chunks
    - Implement `@tool` decorated `detect_anomalies(chunks: str) -> str` that parses JSON input and calls the impl
    - Configure `BedrockModel` with `model_id=f"us.{BEDROCK_MODEL_ID}"`, `region_name=BEDROCK_REGION`, `temperature=0.3`, `max_tokens=2000`
    - Configure `Agent` with model, tools list `[retrieve_chunks, detect_anomalies]`, and system prompt per design
    - Implement `parse_agent_response(result, strategy="rag", default_count=0)` helper
    - Implement `BedrockAgentCoreApp` with `@app.entrypoint` decorated `invoke(payload)` that extracts `claim_id` and optional `chunking_method` and calls the agent
    - Add `if __name__ == "__main__": app.run()` block
    - All `@tool` functions must have docstrings and type hints
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.3, 4.5, 4.6, 5.2, 5.4, 5.7, 6.2, 7.2, 7.4, 8.1, 8.2, 8.3, 9.2_

- [x] 5. Migrate Graph RAG Agent to Strands SDK
  - [x] 5.1 Rewrite `agents/graph_rag_agent/agent.py` to replace the `GraphRAGSummaryAgent` class with module-level Strands architecture
    - Remove OpenTelemetry imports and tracer setup
    - Add imports for `strands` (`Agent`, `tool`), `strands.models` (`BedrockModel`), `bedrock_agentcore.runtime` (`BedrockAgentCoreApp`), and `networkx`
    - Initialize module-level DynamoDB resource and Bedrock clients
    - Implement `_retrieve_claim_documents_impl(claim_id: str) -> list[dict]` helper with existing DynamoDB scan logic
    - Implement `@tool` decorated `retrieve_claim_documents(claim_id: str) -> str` that calls the impl and returns JSON
    - Implement `_build_knowledge_graph_impl(documents: list[dict]) -> nx.DiGraph` helper preserving all entity extraction logic (patient names, provider names, ICD-10 codes, CPT codes, dates, amounts, NPI numbers) and relationship edge creation
    - Implement `@tool` decorated `build_knowledge_graph(documents: str) -> str` that parses JSON input, calls the impl, and returns a JSON graph summary
    - Implement `_extract_entities_impl(graph: nx.DiGraph) -> list[dict]` helper returning entity dicts with `id`, `type`, `label`, `properties`
    - Implement `@tool` decorated `extract_entities(graph_json: str) -> str` that reconstructs the graph and calls the impl
    - Implement `_detect_graph_anomalies_impl(graph: nx.DiGraph) -> list[dict]` helper preserving all graph-based anomaly detection (conflicting DOBs, chronological impossibilities, payment-before-service, conflicting patient names)
    - Implement `@tool` decorated `detect_graph_anomalies(graph_json: str) -> str` that reconstructs the graph and calls the impl
    - Configure `BedrockModel` with `model_id=f"us.{BEDROCK_MODEL_ID}"`, `region_name=BEDROCK_REGION`, `temperature=0.3`, `max_tokens=2000`
    - Configure `Agent` with model, tools list `[retrieve_claim_documents, build_knowledge_graph, extract_entities, detect_graph_anomalies]`, and system prompt per design
    - Implement `parse_agent_response(result, strategy="graph-rag", default_count=0)` helper
    - Implement `BedrockAgentCoreApp` with `@app.entrypoint` decorated `invoke(payload)` that extracts `claim_id` and calls the agent
    - Add `if __name__ == "__main__": app.run()` block
    - All `@tool` functions must have docstrings and type hints
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.4, 5.7, 6.3, 7.3, 7.4, 8.1, 8.2, 8.3, 9.3_

  - [x]* 5.2 Write property test for graph entity extraction completeness (Property 6)
    - **Property 6: Graph RAG entity extraction completeness**
    - Update `unit_tests/test_graph_rag_agent.py` to test the new `_build_knowledge_graph_impl` function
    - Use `importlib.util.spec_from_file_location` for import
    - Use `@given` with document containing patient name (`Patient Name: X`), ICD-10 code, CPT code, service date (`Date of Service: X`), dollar amount (`$X`), and provider name (`Provider Name: X`)
    - Assert graph contains at least one node of each type: `patient`, `diagnosis`, `procedure`, `date`, `amount`, `provider`
    - `@settings(max_examples=100)`
    - **Validates: Requirements 3.3, 10.6**

  - [x]* 5.3 Write property test for graph entity extraction round-trip (Property 7)
    - **Property 7: Graph entity extraction round-trip**
    - Add to `unit_tests/test_graph_rag_agent.py`
    - Use `@given` to generate documents, build graph via `_build_knowledge_graph_impl`, then call `_extract_entities_impl`
    - Assert every node in the graph appears exactly once in the entity list, and each entity dict has keys `id`, `type`, `label`, `properties`
    - `@settings(max_examples=100)`
    - **Validates: Requirements 3.5**

  - [x]* 5.4 Write property test for conflicting DOBs detection in graph (Property 8)
    - **Property 8: Conflicting DOBs detection in graph**
    - Add to `unit_tests/test_graph_rag_agent.py`
    - Use `@given` with documents where the same patient name appears with 2+ distinct dates of birth
    - Build graph via `_build_knowledge_graph_impl`, then call `_detect_graph_anomalies_impl`
    - Assert at least one anomaly with `severity == "critical"` and `description` containing the conflicting DOB values
    - `@settings(max_examples=100)`
    - **Validates: Requirements 4.4**

- [x] 6. Checkpoint - Verify RAG and Graph RAG Agent migrations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update unit tests for migrated module structure
  - [x] 7.1 Update `unit_tests/test_full_context_agent.py` to import and test the new module-level `_impl` functions instead of class methods
    - Update `importlib.util.spec_from_file_location` import to load the new module structure
    - Replace `FullContextSummaryAgent` class instantiation with direct calls to `_combine_document_text_impl`, `_detect_anomalies_impl`, `_find_dates`
    - Add unit tests verifying `@tool` decorator is applied to `retrieve_claim_documents`, `combine_document_text`, `detect_anomalies`
    - Add unit test verifying `BedrockModel` configuration uses correct model ID and region
    - Add edge case tests: empty document list, documents missing `extractedText`, documents missing `fileName`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7_

  - [x] 7.2 Update `unit_tests/test_graph_rag_agent.py` to import and test the new module-level `_impl` functions instead of class methods
    - Update `importlib.util.spec_from_file_location` import to load the new module structure
    - Replace `GraphRAGSummaryAgent` class instantiation with direct calls to `_build_knowledge_graph_impl`, `_extract_entities_impl`, `_detect_graph_anomalies_impl`
    - Add unit tests verifying `@tool` decorator is applied to `retrieve_claim_documents`, `build_knowledge_graph`, `extract_entities`, `detect_graph_anomalies`
    - Add unit test verifying `BedrockModel` configuration uses correct model ID and region
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses Python, so no language selection was needed
- All `@tool` functions use JSON string parameters/returns for LLM compatibility, with `_impl` helpers for direct testability
