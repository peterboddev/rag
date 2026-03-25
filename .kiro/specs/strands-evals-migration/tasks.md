# Implementation Plan: Strands Evals SDK Migration

## Overview

Migrate the evaluation pipeline from custom evaluator classes and the hypothetical `bedrock-agentcore` client to the `strands-agents-evals` SDK and the real `bedrock-agentcore-control` boto3 client. Implementation proceeds incrementally: dependencies first, then config, then runner, then CI script, with property tests validating each layer.

## Tasks

- [x] 1. Add strands-agents-evals dependency to agent requirements.txt files
  - Add `strands-agents-evals>=0.1.0` to `agents/full_context_agent/requirements.txt`
  - Add `strands-agents-evals>=0.1.0` to `agents/rag_agent/requirements.txt`
  - Add `strands-agents-evals>=0.1.0` to `agents/graph_rag_agent/requirements.txt`
  - _Requirements: 1.1_

- [ ] 2. Update evaluation_config.py with new evaluator definition structure
  - [x] 2.1 Add `evaluatorConfig` and `level` fields to `get_evaluator_definitions()`
    - Each definition gets `level: "TRACE"` field
    - Each definition gets `evaluatorConfig.llmAsAJudge` nested structure with `instructions`, `ratingScale.numerical` (two-point: 1="Very Good", 0="Very Poor"), and `modelConfig.bedrockEvaluatorModelConfig` (modelId `global.anthropic.claude-sonnet-4-5-20250929-v1:0`, maxTokens 500, temperature 1.0)
    - Preserve existing `prompt`, `scoring_schema`, `model_id` fields for backward compatibility
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 2.2 Write property test for evaluator definition structure (Property 10)
    - **Property 10: Evaluator definition structure**
    - **Validates: Requirements 8.1, 8.2, 8.3**
    - File: `unit_tests/test_strands_evals_config.py`
    - Verify each definition has `prompt` (non-empty), `level` ("TRACE"), `evaluatorConfig.llmAsAJudge`, and backward-compat `scoring_schema`/`model_id`

- [ ] 3. Update evaluation_runner.py client and registration
  - [x] 3.1 Add conditional import for strands_evals SDK and switch client to bedrock-agentcore-control
    - Add try/except import block for `from strands_evals.evaluators import OutputEvaluator` setting `_STRANDS_EVALS_AVAILABLE` flag
    - Change `_create_agentcore_client()` to use `boto3.client('bedrock-agentcore-control')` instead of `boto3.client('bedrock-agentcore')`
    - _Requirements: 1.2, 1.3, 3.1_

  - [x] 3.2 Update `_build_registration_payload()` to use evaluatorConfig structure
    - Build payload with `evaluatorName`, `level: "TRACE"`, and `evaluatorConfig.llmAsAJudge` from the definition's `evaluatorConfig` field
    - Remove old flat `evaluationCriteria`/`scoringSchema`/`evaluatorModelId` fields
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 3.3 Write property test for registration payload correctness (Property 1)
    - **Property 1: Registration payload correctness**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2**
    - File: `unit_tests/test_strands_evals_runner.py`

  - [ ]* 3.4 Write property test for registration idempotency (Property 2)
    - **Property 2: Registration idempotency**
    - **Validates: Requirements 3.7**
    - File: `unit_tests/test_strands_evals_runner.py`

- [ ] 4. Update configure_online_evaluation to use create_online_evaluation_config API
  - [x] 4.1 Rewrite `configure_online_evaluation()` to call `create_online_evaluation_config()`
    - Use `onlineEvaluationConfigName` derived from agent_id (underscores not hyphens)
    - Build `evaluators` list with `{"evaluatorId": "Builtin.Helpfulness"}` plus registered custom evaluator IDs
    - Include `rule.samplingConfig.samplingPercentage`, `dataSourceConfig.cloudWatchLogs`, `evaluationExecutionRoleArn`, `enableOnCreate: True`
    - Store evaluator IDs (not ARNs) in `_evaluator_ids` dict
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 4.2 Write property test for online evaluation config correctness (Property 3)
    - **Property 3: Online evaluation config correctness**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
    - File: `unit_tests/test_strands_evals_runner.py`

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Update evaluate_direct() to use Strands Evals SDK
  - [x] 6.1 Implement SDK path in `evaluate_direct()` using `OutputEvaluator`
    - When `_STRANDS_EVALS_AVAILABLE` is True, create four `OutputEvaluator` instances with rubrics from `FAITHFULNESS_PROMPT`, `COMPLETENESS_PROMPT`, `ANOMALY_ACCURACY_PROMPT`, and a helpfulness rubric
    - Call each evaluator's `evaluate()`, extract `.score`, clamp to [0, 1]
    - Add `helpfulness` to the returned dict alongside existing fields
    - When `_STRANDS_EVALS_AVAILABLE` is False, fall back to existing custom evaluator classes and log warning
    - If individual SDK evaluator raises exception, fall back to custom class for that metric
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.3_

  - [ ]* 6.2 Write property test for evaluate_direct output format (Property 4)
    - **Property 4: evaluate_direct output format**
    - **Validates: Requirements 2.5, 6.3**
    - File: `unit_tests/test_strands_evals_runner.py`

  - [ ]* 6.3 Write property test for score clamping (Property 5)
    - **Property 5: Score clamping**
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - File: `unit_tests/test_strands_evals_runner.py`

- [ ] 7. Validate store/read round-trip compatibility
  - [ ]* 7.1 Write property test for evaluation store-then-read round trip (Property 6)
    - **Property 6: Evaluation store-then-read round trip**
    - **Validates: Requirements 7.4, 7.5**
    - File: `unit_tests/test_strands_evals_roundtrip.py`
    - Mock DynamoDB put/get, verify stored-then-read record has numeric `helpfulness`, `faithfulness`, `completeness`, optional `anomalyAccuracy`, and string `evaluatedAt`

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Update CI/CD evaluation script to use Strands Evals SDK
  - [x] 9.1 Update `test_evaluation_ci.py` to use `Case`, `Experiment`, `OutputEvaluator` from SDK
    - Add conditional import for `Case`, `Experiment`, `OutputEvaluator` with `_STRANDS_EVALS_AVAILABLE` flag
    - Update `_evaluate_test_case()` to construct `Case` objects and use `OutputEvaluator` instances when SDK available
    - Fall back to existing custom evaluator classes when SDK unavailable, log warning
    - Keep `_check_pass_fail()`, `_build_report()`, `_write_report()` unchanged
    - Ensure script remains discoverable by `pytest`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 9.2 Write property test for CI pass/fail decision correctness (Property 7)
    - **Property 7: CI pass/fail decision correctness**
    - **Validates: Requirements 5.3, 5.4**
    - File: `unit_tests/test_strands_evals_ci.py`

  - [ ]* 9.3 Write property test for CI report structure completeness (Property 8)
    - **Property 8: CI report structure completeness**
    - **Validates: Requirements 5.5**
    - File: `unit_tests/test_strands_evals_ci.py`

  - [ ]* 9.4 Write property test for Case construction mapping (Property 9)
    - **Property 9: Case construction mapping**
    - **Validates: Requirements 5.1**
    - File: `unit_tests/test_strands_evals_ci.py`

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing custom evaluator classes (faithfulness, completeness, anomaly accuracy) are NOT modified — they remain as fallback
- All code is Python; property tests use `hypothesis`
