# Requirements Document

## Introduction

The existing AgentCore Evaluations integration (`.kiro/specs/agentcore-evaluations/`) built custom evaluator classes (`FaithfulnessEvaluator`, `CompletenessEvaluator`, `AnomalyAccuracyEvaluator`) that call Bedrock directly, and an `EvaluationRunner` that uses a hypothetical `bedrock-agentcore` boto3 client not yet available in the SDK. This migration replaces the custom evaluators with the `strands-agents-evals` SDK's built-in evaluators and switches the AgentCore control plane calls to the real `bedrock-agentcore-control` boto3 client.

The existing `Evaluation_Results_Writer` Lambda, CDK infrastructure, DynamoDB table, OpenTelemetry span attributes on agents, and the `evaluation_config.py` module remain unchanged. The custom evaluator classes are preserved as fallback for environments where the `strands-agents-evals` SDK is not available.

## Glossary

- **Strands_Evals_SDK**: The `strands-agents-evals` Python package providing built-in evaluators (`HelpfulnessEvaluator`, `FaithfulnessEvaluator`, `OutputEvaluator`), the `Case` and `Experiment` classes for running evaluation experiments, and telemetry utilities
- **HelpfulnessEvaluator**: A built-in evaluator from the Strands_Evals_SDK that performs trace-level helpfulness scoring using a 7-level categorical scale
- **SDK_FaithfulnessEvaluator**: A built-in evaluator from the Strands_Evals_SDK that performs trace-level faithfulness scoring using a 5-level categorical scale
- **OutputEvaluator**: A rubric-based evaluator from the Strands_Evals_SDK that accepts a custom `rubric` parameter for domain-specific evaluation criteria
- **Case**: A data class from the Strands_Evals_SDK representing a single evaluation test case with `name`, `input`, `expected_output`, and `metadata` fields
- **Experiment**: A class from the Strands_Evals_SDK that runs a set of `Case` instances through evaluators and returns evaluation reports
- **AgentCore_Control_Client**: The `bedrock-agentcore-control` boto3 client that provides the real AgentCore control plane API for evaluator registration and online evaluation configuration
- **Evaluation_Runner**: The existing Python module (`evaluators/evaluation_runner.py`) that orchestrates evaluator registration, online evaluation configuration, on-demand evaluation, and direct offline evaluation
- **Evaluation_Results_Writer**: The existing Lambda function (Node.js 20.x) that receives evaluation result events and writes scores to the Evaluation_Results_Table DynamoDB table
- **Evaluation_Results_Table**: The existing DynamoDB table (`rag-app-v2-evaluation-results-{environment}`) with partition key `claimId` and sort key `strategyKey`
- **Custom_Evaluator_Classes**: The existing `FaithfulnessEvaluator`, `CompletenessEvaluator`, and `AnomalyAccuracyEvaluator` Python classes in the `evaluators/` directory that call Bedrock directly
- **CI_Evaluation_Script**: The existing `unit_tests/test_evaluation_ci.py` script that runs evaluations against a fixed test dataset
- **COMPLETENESS_PROMPT**: The existing evaluation criteria prompt in `evaluators/completeness_evaluator.py` used for completeness scoring
- **ANOMALY_ACCURACY_PROMPT**: The existing evaluation criteria prompt in `evaluators/anomaly_accuracy_evaluator.py` used for anomaly accuracy scoring

## Requirements

### Requirement 1: Install strands-agents-evals SDK Dependency

**User Story:** As a developer, I want the `strands-agents-evals` package available in the evaluator and agent environments, so that the evaluation pipeline can use the SDK's built-in evaluators and experiment framework.

#### Acceptance Criteria

1. THE agent environment requirements SHALL include `strands-agents-evals` as a dependency in each agent's `requirements.txt` file (`agents/full_context_agent/requirements.txt`, `agents/rag_agent/requirements.txt`, `agents/graph_rag_agent/requirements.txt`)
2. THE evaluator module SHALL be importable with `strands-agents-evals` installed, providing access to `HelpfulnessEvaluator`, `FaithfulnessEvaluator`, `OutputEvaluator`, `Case`, and `Experiment` from the `strands_evals` package
3. IF the `strands-agents-evals` package is not installed, THEN THE Evaluation_Runner SHALL fall back to using the Custom_Evaluator_Classes for direct evaluation

### Requirement 2: Migrate EvaluationRunner Direct Evaluation to Strands Evals Evaluators

**User Story:** As a developer, I want the `EvaluationRunner.evaluate_direct()` method to use the Strands_Evals_SDK evaluators instead of calling custom evaluator classes directly, so that evaluation scoring is consistent with the SDK's built-in scoring methodology.

#### Acceptance Criteria

1. WHEN `evaluate_direct()` is called with a summary, source documents, and anomalies list, THE Evaluation_Runner SHALL use the Strands_Evals_SDK `HelpfulnessEvaluator` for helpfulness scoring
2. WHEN `evaluate_direct()` is called, THE Evaluation_Runner SHALL use the Strands_Evals_SDK `FaithfulnessEvaluator` for faithfulness scoring
3. WHEN `evaluate_direct()` is called, THE Evaluation_Runner SHALL use the Strands_Evals_SDK `OutputEvaluator` with the existing `COMPLETENESS_PROMPT` as the `rubric` parameter for completeness scoring
4. WHEN `evaluate_direct()` is called, THE Evaluation_Runner SHALL use the Strands_Evals_SDK `OutputEvaluator` with the existing `ANOMALY_ACCURACY_PROMPT` as the `rubric` parameter for anomaly accuracy scoring
5. THE `evaluate_direct()` method SHALL return a dict containing `helpfulness`, `faithfulness`, `completeness`, `anomalyAccuracy`, and `evaluatedAt` fields with numeric scores in the 0-1 range
6. IF the Strands_Evals_SDK is not available (import fails), THEN THE Evaluation_Runner SHALL fall back to using the Custom_Evaluator_Classes and log a warning indicating fallback mode

### Requirement 3: Switch AgentCore Client to bedrock-agentcore-control

**User Story:** As a developer, I want the `EvaluationRunner` to use the real `bedrock-agentcore-control` boto3 client instead of the hypothetical `bedrock-agentcore` client, so that evaluator registration and online evaluation configuration use the actual AWS API.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL create a boto3 client using `boto3.client('bedrock-agentcore-control')` instead of `boto3.client('bedrock-agentcore')`
2. WHEN `register_evaluators()` is called, THE Evaluation_Runner SHALL call `client.create_evaluator()` with an `evaluatorConfig` parameter containing an `llmAsAJudge` structure that includes `instructions`, `ratingScale`, and `modelConfig` fields
3. THE `evaluatorConfig.llmAsAJudge.instructions` field SHALL contain the evaluation criteria prompt from the corresponding evaluator definition (FAITHFULNESS_PROMPT, COMPLETENESS_PROMPT, or ANOMALY_ACCURACY_PROMPT)
4. THE `evaluatorConfig.llmAsAJudge.modelConfig.bedrockEvaluatorModelConfig` SHALL specify `modelId` as `global.anthropic.claude-sonnet-4-5-20250929-v1:0` and `inferenceConfig` with `maxTokens` of 500 and `temperature` of 1.0
5. THE `evaluatorConfig.llmAsAJudge.ratingScale.numerical` SHALL define a two-point scale with value 1 labeled "Very Good" and value 0 labeled "Very Poor"
6. WHEN `register_evaluators()` is called, THE Evaluation_Runner SHALL specify the `level` parameter as `TRACE` for each custom evaluator registration
7. IF a custom evaluator with the same name already exists (conflict error), THEN THE Evaluation_Runner SHALL retrieve the existing evaluator ARN instead of creating a duplicate

### Requirement 4: Migrate Online Evaluation Configuration to bedrock-agentcore-control API

**User Story:** As a developer, I want the online evaluation configuration to use the real `bedrock-agentcore-control` API structure, so that live agent traces are scored using the correct API contract.

#### Acceptance Criteria

1. WHEN `configure_online_evaluation()` is called with an agent identifier, THE Evaluation_Runner SHALL call `client.create_online_evaluation_config()` with the correct parameter structure
2. THE `create_online_evaluation_config()` call SHALL include an `onlineEvaluationConfigName` parameter derived from the agent identifier
3. THE `create_online_evaluation_config()` call SHALL include a `rule` parameter with a `samplingConfig` containing a `samplingPercentage` value
4. THE `create_online_evaluation_config()` call SHALL include a `dataSourceConfig` parameter with a `cloudWatchLogs` structure specifying `logGroupNames` and `serviceNames`
5. THE `create_online_evaluation_config()` call SHALL include an `evaluators` list containing the built-in Helpfulness evaluator ID (`Builtin.Helpfulness`) and all registered custom evaluator IDs
6. THE `create_online_evaluation_config()` call SHALL include an `evaluationExecutionRoleArn` parameter
7. THE `create_online_evaluation_config()` call SHALL set `enableOnCreate` to `True`

### Requirement 5: Update CI/CD Evaluation Script to Use Strands Evals Experiment Framework

**User Story:** As a developer, I want the CI/CD evaluation script to use the Strands_Evals_SDK `Experiment` and `Case` classes, so that CI evaluations follow the same SDK patterns as production evaluation.

#### Acceptance Criteria

1. THE CI_Evaluation_Script SHALL construct `Case` objects from each test case in the test dataset, mapping `claim_id` to `name`, `source_documents` to `input`, `summary` to `expected_output`, and `anomalies` and `strategy` to `metadata`
2. THE CI_Evaluation_Script SHALL create an `Experiment` with the constructed `Case` objects and the Strands_Evals_SDK evaluators (`HelpfulnessEvaluator`, `FaithfulnessEvaluator`, `OutputEvaluator` with completeness rubric, `OutputEvaluator` with anomaly accuracy rubric)
3. WHEN the `Experiment.run_evaluations()` method completes, THE CI_Evaluation_Script SHALL extract scores from the evaluation reports and compare them against configurable thresholds
4. WHEN any evaluation score falls below a configurable threshold, THE CI_Evaluation_Script SHALL exit with a non-zero status code and report the failing metric, actual score, and threshold
5. THE CI_Evaluation_Script SHALL produce a JSON report with per-test-case scores and an `overall_status` field that is `pass` when all test cases pass and `fail` when any test case fails
6. IF the Strands_Evals_SDK is not available, THEN THE CI_Evaluation_Script SHALL fall back to using the Custom_Evaluator_Classes directly and log a warning
7. THE CI_Evaluation_Script SHALL remain executable via `pytest` from the `unit_tests/` directory

### Requirement 6: Preserve Custom Evaluator Classes as Fallback

**User Story:** As a developer, I want the existing custom evaluator classes (`FaithfulnessEvaluator`, `CompletenessEvaluator`, `AnomalyAccuracyEvaluator`) to remain available and functional, so that evaluation works in environments where the Strands_Evals_SDK is not installed.

#### Acceptance Criteria

1. THE Custom_Evaluator_Classes SHALL remain in the `evaluators/` directory with unchanged public interfaces (`evaluate()` method signatures and return types)
2. THE `evaluators/__init__.py` module SHALL continue to export `AnomalyAccuracyEvaluator` and `EvaluationRunner`
3. WHEN the Strands_Evals_SDK is not installed, THE Evaluation_Runner `evaluate_direct()` method SHALL use the Custom_Evaluator_Classes and produce scores in the same format as the SDK-based evaluation
4. THE existing `FAITHFULNESS_PROMPT`, `COMPLETENESS_PROMPT`, and `ANOMALY_ACCURACY_PROMPT` constants SHALL remain exported from their respective modules for use as `OutputEvaluator` rubrics

### Requirement 7: Evaluation Score Format Compatibility

**User Story:** As a developer, I want evaluation scores produced by the Strands_Evals_SDK evaluators to be written in the same format the existing Evaluation_Results_Writer and frontend expect, so that no downstream changes are needed.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL normalize Strands_Evals_SDK `HelpfulnessEvaluator` categorical scores (7-level) to a numeric value between 0 and 1 before storing results
2. THE Evaluation_Runner SHALL normalize Strands_Evals_SDK `FaithfulnessEvaluator` categorical scores (5-level) to a numeric value between 0 and 1 before storing results
3. THE Evaluation_Runner SHALL normalize Strands_Evals_SDK `OutputEvaluator` scores to a numeric value between 0 and 1 before storing results
4. THE `store_results()` method SHALL continue to write records to the Evaluation_Results_Table with the same schema: `claimId` (partition key), `strategyKey` (sort key), numeric `helpfulness`, `faithfulness`, `completeness`, optional `anomalyAccuracy`, and `evaluatedAt` (ISO 8601 string)
5. FOR ALL valid evaluation inputs, evaluating with the Strands_Evals_SDK evaluators then storing results then reading results SHALL produce a record that satisfies the existing `EvaluationScores` TypeScript interface (round-trip property)

### Requirement 8: Update Evaluation Configuration for New API Structure

**User Story:** As a developer, I want the evaluation configuration module to support the new `bedrock-agentcore-control` API parameter structure, so that evaluator definitions can be used for both the new API registration and the existing offline evaluation.

#### Acceptance Criteria

1. THE `get_evaluator_definitions()` function SHALL return evaluator definitions that include the `evaluatorConfig` structure expected by the `bedrock-agentcore-control` `create_evaluator()` API
2. THE evaluator definitions SHALL include the `level` field set to `TRACE` for each custom evaluator
3. THE evaluator definitions SHALL continue to include the `prompt` field referencing the existing evaluation criteria prompts for backward compatibility with offline evaluation
4. THE `get_score_thresholds()` function SHALL remain unchanged, returning the same default thresholds for CI/CD pass/fail decisions
