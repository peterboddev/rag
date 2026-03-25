# Implementation Plan: AgentCore Evaluations Integration

## Overview

Integrate Amazon Bedrock AgentCore Evaluations into the insurance claim summary system. This involves creating the AnomalyAccuracyEvaluator, extending evaluation config, building the EvaluationRunner, implementing the Evaluation_Results_Writer Lambda, adding OpenTelemetry span attributes to agents, wiring CDK infrastructure, and creating a CI/CD evaluation script. The existing frontend and orchestrator read paths remain unchanged.

## Tasks

- [x] 1. Create AnomalyAccuracyEvaluator and extend evaluation config
  - [x] 1.1 Create `evaluators/anomaly_accuracy_evaluator.py` with `AnomalyAccuracyEvaluator` class
    - Define `ANOMALY_ACCURACY_PROMPT` for scoring detected anomalies against source document content
    - Implement `evaluate(anomalies: list[dict], source_documents: str) -> dict` returning `score`, `reasoning`, `false_positives`, `missed_anomalies`
    - Handle edge cases: empty anomalies list returns `score: 0.0`, empty source documents returns `score: 0.0`, unparseable LLM response returns `score: 0.0`
    - Follow existing evaluator patterns from `FaithfulnessEvaluator` and `CompletenessEvaluator`
    - _Requirements: 1.3, 10.4_

  - [ ]* 1.2 Write unit tests for AnomalyAccuracyEvaluator in `unit_tests/test_anomaly_accuracy_evaluator.py`
    - Test empty anomalies list returns score 0.0
    - Test empty source documents returns score 0.0
    - Test unparseable LLM response returns score 0.0
    - Test valid LLM response is parsed correctly
    - _Requirements: 1.3_

  - [x] 1.3 Extend `evaluators/evaluation_config.py` with `get_evaluator_definitions()` and `get_score_thresholds()`
    - Add `get_evaluator_definitions()` returning evaluator name, prompt, and scoring schema for Faithfulness, Completeness, and AnomalyAccuracy
    - Add `get_score_thresholds()` returning `DEFAULT_SCORE_THRESHOLDS` dict with configurable pass/fail thresholds
    - Import `ANOMALY_ACCURACY_PROMPT` from the new evaluator module
    - Reuse existing `FAITHFULNESS_PROMPT` and `COMPLETENESS_PROMPT` from their respective modules
    - Specify `amazon.nova-pro-v1:0` as evaluator model in definitions
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 10.1, 10.2_

  - [ ]* 1.4 Write unit tests for evaluation config extensions in `unit_tests/test_anomaly_accuracy_evaluator.py`
    - Test `get_evaluator_definitions()` returns all three evaluator definitions with correct prompts
    - Test `get_score_thresholds()` returns thresholds in valid 0-1 range
    - Test existing `FaithfulnessEvaluator` and `CompletenessEvaluator` remain importable and callable
    - _Requirements: 8.1, 8.3, 10.3_

- [x] 2. Implement EvaluationRunner
  - [x] 2.1 Create `evaluators/evaluation_runner.py` with `EvaluationRunner` class
    - Implement `register_evaluators()` that registers Faithfulness, Completeness, and AnomalyAccuracy custom evaluators with AgentCore Evaluations API using prompts from `get_evaluator_definitions()`
    - Handle idempotent registration: if evaluator already exists (409 conflict), retrieve existing ARN via `GetEvaluator`
    - Store returned Evaluator ARNs in configuration keyed by evaluator name
    - Implement `configure_online_evaluation(agent_id: str)` that creates online evaluation config including built-in Helpfulness + 3 custom evaluator ARNs
    - Implement `evaluate_trace(trace_id: str)` for on-demand evaluation via AgentCore API
    - Implement `evaluate_direct(summary, source_documents, anomalies)` for offline evaluation using evaluator classes directly
    - Implement `store_results(claim_id, strategy, chunking_method, scores)` to write to Evaluation_Results_Table
    - Raise `EvaluatorRegistrationError` on registration failure, `EvaluationConfigError` on config failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.2 Write property test for evaluator registration payload correctness in `unit_tests/test_evaluation_runner.py`
    - **Property 1: Evaluator registration payload correctness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 10.1, 10.2, 10.5**

  - [ ]* 2.3 Write property test for evaluator registration idempotency in `unit_tests/test_evaluation_runner.py`
    - **Property 2: Evaluator registration idempotency**
    - **Validates: Requirements 1.6**

  - [ ]* 2.4 Write property test for evaluation configuration completeness in `unit_tests/test_evaluation_runner.py`
    - **Property 3: Evaluation configuration includes all evaluators**
    - **Validates: Requirements 2.2, 4.2**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Evaluation Results Writer Lambda
  - [x] 4.1 Create `src/lambda/evaluation-results-writer.ts` Lambda handler
    - Parse `EvaluationResultEvent` from AgentCore Evaluations
    - Extract `claim.id`, `claim.strategy`, `claim.chunking_method` from `spanAttributes`
    - Skip writing and log warning if `claim.id` is missing
    - Default `claim.strategy` to `unknown` if missing, log warning
    - Construct `strategyKey` as `{strategy}#{chunkingMethod}` where `chunkingMethod` defaults to `none`
    - Clamp all scores (`helpfulness`, `faithfulness`, `completeness`, `anomalyAccuracy`) to [0.0, 1.0]
    - Write record to `Evaluation_Results_Table` with `claimId`, `strategyKey`, numeric scores, `evaluatedAt` (ISO 8601), optional reasoning fields, and `traceId`
    - Return 200 on success, 400 on malformed payload, 500 on DynamoDB write failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.4, 9.5_

  - [ ]* 4.2 Write property test for DynamoDB record correctness in `unit_tests/test_evaluation_results_writer.test.ts`
    - **Property 4: Evaluation Results Writer produces correct DynamoDB records**
    - **Validates: Requirements 2.4, 3.2, 3.3, 3.4, 6.5, 9.4**

  - [ ]* 4.3 Write property test for score clamping in `unit_tests/test_evaluation_results_writer.test.ts`
    - **Property 5: All evaluation scores are clamped to [0, 1]**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [ ]* 4.4 Write property test for strategy key format in `unit_tests/test_evaluation_results_writer.test.ts`
    - **Property 6: Strategy key format correctness**
    - **Validates: Requirements 6.6**

  - [ ]* 4.5 Write property test for write-then-read round trip in `unit_tests/test_evaluation_results_writer.test.ts`
    - **Property 7: Evaluation write-then-read round trip**
    - **Validates: Requirements 6.7**

  - [ ]* 4.6 Write unit tests for error handling in `unit_tests/test_evaluation_results_writer.test.ts`
    - Test skip writing when `claim.id` is missing from span attributes
    - Test log error on DynamoDB write failure
    - Test return 400 on malformed event payload
    - _Requirements: 3.6, 9.5_

- [x] 5. Add OpenTelemetry span attributes to agent entry points
  - [x] 5.1 Update `agents/full_context_agent/agent.py` entry point to set span attributes
    - Import `opentelemetry.trace`
    - In `invoke(payload)`, get current span and set `claim.id`, `claim.strategy` = `full-context`, `claim.chunking_method` = `none`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 5.2 Update `agents/rag_agent/agent.py` entry point to set span attributes
    - In `invoke(payload)`, set `claim.id`, `claim.strategy` = `rag`, `claim.chunking_method` from payload (default `semantic`)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 5.3 Update `agents/graph_rag_agent/agent.py` entry point to set span attributes
    - In `invoke(payload)`, set `claim.id`, `claim.strategy` = `graph-rag`, `claim.chunking_method` = `none`
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 5.4 Write property test for agent span attributes in `unit_tests/test_agent_span_attributes.py`
    - **Property 10: Agent span attributes correctness**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add CDK infrastructure for Evaluation Results Writer
  - [x] 7.1 Add Evaluation_Results_Writer Lambda and IAM policies to `infrastructure/rag-application-stack.ts`
    - Define `EvaluationResultsWriterFunction` using `createLambdaFunction` helper with Node.js 20.x runtime
    - Set `EVALUATION_RESULTS_TABLE` and `BEDROCK_REGION` environment variables
    - Grant write access to existing `evaluationResultsTable`
    - Create IAM policy for AgentCore Evaluations actions: `bedrock-agentcore:CreateEvaluator`, `bedrock-agentcore:GetEvaluator`, `bedrock-agentcore:CreateEvaluationConfig`, `bedrock-agentcore:StartEvaluation`
    - Parameterize AgentCore agent identifiers using CDK context or environment variables
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 7.2 Write CDK unit tests in `unit_tests/test_evaluation_cdk.test.ts`
    - Test writer Lambda uses Node.js 20.x runtime
    - Test writer Lambda has DynamoDB write access to evaluation results table
    - Test writer Lambda has correct environment variables
    - Test AgentCore IAM policies are created
    - _Requirements: 5.1, 5.2, 5.4, 5.6_

- [x] 8. Implement CI/CD evaluation script
  - [x] 8.1 Create test dataset at `evaluators/test_data/test_cases.json`
    - Include 2-3 test cases with `claim_id`, `strategy`, `source_documents`, `summary`, `anomalies`, and `expected_score_ranges`
    - Cover full-context and rag strategies
    - _Requirements: 7.1_

  - [x] 8.2 Create CI evaluation script at `unit_tests/test_evaluation_ci.py`
    - Load test dataset from `evaluators/test_data/test_cases.json`
    - Invoke `FaithfulnessEvaluator`, `CompletenessEvaluator`, `AnomalyAccuracyEvaluator` directly (no AgentCore service dependency)
    - Assert each score meets configurable thresholds from `get_score_thresholds()` or environment variable overrides
    - Produce JSON report with per-test-case scores and `overall_status` field (`pass`/`fail`)
    - Exit with non-zero status if any score below threshold
    - Executable via `pytest` from `unit_tests/` directory
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 8.3 Write property test for CI pass/fail decision correctness in `unit_tests/test_evaluation_ci.py`
    - **Property 8: CI/CD pass/fail decision correctness**
    - **Validates: Requirements 7.3**

  - [ ]* 8.4 Write property test for CI report structure completeness in `unit_tests/test_evaluation_ci.py`
    - **Property 9: CI/CD report structure completeness**
    - **Validates: Requirements 7.5**

- [x] 9. Wire everything together and add agent requirements
  - [x] 9.1 Add `opentelemetry-api` to each agent's `requirements.txt`
    - Update `agents/full_context_agent/requirements.txt`
    - Update `agents/rag_agent/requirements.txt`
    - Update `agents/graph_rag_agent/requirements.txt`
    - _Requirements: 9.1_

  - [x] 9.2 Update `evaluators/__init__.py` to export new modules
    - Export `AnomalyAccuracyEvaluator` and `EvaluationRunner`
    - _Requirements: 8.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Python tests use `hypothesis` library; TypeScript tests use `fast-check`
- All tests go in the `unit_tests/` directory per project guidelines
- Frontend (`EvaluationScoreDisplay`) and orchestrator read path are unchanged — no tasks needed
