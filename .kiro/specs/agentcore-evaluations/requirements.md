# Requirements Document

## Introduction

This specification covers the integration of Amazon Bedrock AgentCore Evaluations into the existing insurance claim summary system. Three Strands SDK agents (Full Context, RAG, Graph RAG) are already deployed to AgentCore Runtime and produce claim summaries. The frontend already displays evaluation scores (helpfulness, faithfulness, completeness, anomalyAccuracy) via the EvaluationScoreDisplay component, and the backend orchestrator already reads from the Evaluation_Results_Table. However, no evaluation pipeline currently exists to score agent outputs and write results to that table.

This feature closes that gap by: (1) registering custom evaluators with the AgentCore Evaluations service, (2) configuring online evaluation to continuously score live agent traces, (3) implementing an on-demand evaluation trigger for targeted assessment, (4) writing evaluation results to the existing Evaluation_Results_Table so the existing UI displays them, and (5) enabling evaluations to run as automated tests in CI/CD.

## Glossary

- **AgentCore_Evaluations**: Amazon Bedrock AgentCore Evaluations service that provides automated LLM-as-a-Judge assessment of agent outputs using built-in and custom evaluators
- **Online_Evaluation**: An AgentCore Evaluations mode that continuously monitors live agent traffic and scores traces automatically as they are produced
- **On_Demand_Evaluation**: An AgentCore Evaluations mode that performs targeted assessment of specific traces or spans, triggered programmatically
- **Built_In_Evaluator**: A pre-configured evaluator provided by AgentCore Evaluations (e.g., `Builtin.Helpfulness`) that cannot be modified
- **Custom_Evaluator**: A user-defined evaluator registered with AgentCore Evaluations that specifies evaluation criteria, scoring schema, and evaluator model
- **Evaluator_ARN**: The Amazon Resource Name identifying an evaluator, either built-in (`arn:aws:bedrock-agentcore:::evaluator/Builtin.Helpfulness`) or custom (`arn:aws:bedrock-agentcore:{region}:{account}:evaluator/{evaluator-id}`)
- **Evaluation_Results_Table**: The existing DynamoDB table (`rag-app-v2-evaluation-results-{environment}`) with partition key `claimId` and sort key `strategyKey` that stores evaluation scores
- **Evaluation_Results_Writer**: A new Lambda function that receives evaluation results from AgentCore Evaluations and writes them to the Evaluation_Results_Table
- **Faithfulness_Evaluator**: A custom evaluator that scores how accurately a summary reflects source documents without hallucinations (0-1 scale)
- **Completeness_Evaluator**: A custom evaluator that scores coverage of key claim elements: patient info, diagnosis, procedures, dates, provider, amounts (0-1 scale)
- **Anomaly_Accuracy_Evaluator**: A custom evaluator that scores the accuracy of detected data anomalies against known ground truth anomalies (0-1 scale)
- **Orchestrator_Lambda**: The existing TypeScript Lambda (`claim-summary-orchestrator`) that routes summarization requests and reads evaluation scores from the Evaluation_Results_Table
- **EvaluationScoreDisplay**: The existing React component that renders evaluation score badges (helpfulness, faithfulness, completeness, anomalyAccuracy) in the strategy comparison view
- **Strands_Agent**: A Python agent built with the Strands Agents SDK, deployed to AgentCore Runtime, with built-in OpenTelemetry tracing
- **Agent_Trace**: An OpenTelemetry/OpenInference trace emitted by a Strands Agent during execution, containing spans for tool calls, LLM invocations, and agent responses
- **Evaluation_Runner**: A Python module that orchestrates on-demand evaluation by invoking the AgentCore Evaluations API for specific agent traces
- **CI_Evaluation_Script**: A script that runs evaluations against a fixed test dataset in CI/CD and fails the build if scores fall below configured thresholds

## Requirements

### Requirement 1: Register Custom Evaluators with AgentCore Evaluations

**User Story:** As a developer, I want custom evaluators registered with the AgentCore Evaluations service, so that domain-specific metrics (faithfulness, completeness, anomaly accuracy) are scored alongside the built-in Helpfulness evaluator.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL register a Faithfulness_Evaluator with AgentCore Evaluations that uses the LLM-as-a-Judge pattern to score summary faithfulness to source documents on a 0-1 scale
2. THE Evaluation_Runner SHALL register a Completeness_Evaluator with AgentCore Evaluations that uses the LLM-as-a-Judge pattern to score coverage of key claim elements (patient info, diagnosis, procedures, dates, provider, amounts) on a 0-1 scale
3. THE Evaluation_Runner SHALL register an Anomaly_Accuracy_Evaluator with AgentCore Evaluations that scores the accuracy of detected anomalies against source document content on a 0-1 scale
4. WHEN a custom evaluator is registered, THE Evaluation_Runner SHALL store the returned Evaluator_ARN in the evaluation configuration for use in online and on-demand evaluation
5. THE custom evaluator registration SHALL specify `amazon.nova-pro-v1:0` as the evaluator model
6. IF a custom evaluator with the same name already exists, THEN THE Evaluation_Runner SHALL retrieve the existing Evaluator_ARN instead of creating a duplicate

### Requirement 2: Configure Online Evaluation for Live Agent Traffic

**User Story:** As a developer, I want AgentCore Evaluations to continuously score live agent traces, so that every claim summary produced in the system receives quality scores without manual intervention.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL configure Online_Evaluation for each of the three Strands Agents (Full Context, RAG, Graph RAG) using the AgentCore Evaluations API
2. THE Online_Evaluation configuration SHALL include the Built_In_Evaluator for Helpfulness (`Builtin.Helpfulness`) and all three registered Custom_Evaluators (Faithfulness, Completeness, Anomaly Accuracy)
3. WHEN a Strands_Agent produces an Agent_Trace, THE AgentCore_Evaluations service SHALL automatically score the trace using all configured evaluators
4. WHEN AgentCore_Evaluations completes scoring of a trace, THE Evaluation_Results_Writer SHALL receive the scores and write them to the Evaluation_Results_Table
5. THE Online_Evaluation configuration SHALL associate each evaluator with the correct agent by specifying the agent runtime endpoint or identifier

### Requirement 3: Implement Evaluation Results Writer Lambda

**User Story:** As a developer, I want evaluation scores written to the existing Evaluation_Results_Table, so that the existing frontend EvaluationScoreDisplay component and backend orchestrator display scores without modification.

#### Acceptance Criteria

1. THE Evaluation_Results_Writer SHALL be a Lambda function that receives evaluation result events from AgentCore Evaluations
2. WHEN the Evaluation_Results_Writer receives evaluation scores, THE Evaluation_Results_Writer SHALL write a record to the Evaluation_Results_Table with partition key `claimId` and sort key `strategyKey` in the format `{strategy}#{chunkingMethod}`
3. THE Evaluation_Results_Writer SHALL write the fields `helpfulness`, `faithfulness`, `completeness`, `evaluatedAt` (ISO 8601 timestamp), and optionally `anomalyAccuracy` to the Evaluation_Results_Table
4. THE Evaluation_Results_Writer SHALL extract the `claimId` and `strategy` from the Agent_Trace metadata or span attributes
5. IF the Evaluation_Results_Writer receives a score update for an existing `claimId` and `strategyKey` combination, THEN THE Evaluation_Results_Writer SHALL overwrite the previous record with the new scores
6. IF the Evaluation_Results_Writer fails to write to the Evaluation_Results_Table, THEN THE Evaluation_Results_Writer SHALL log the error with the claimId, strategyKey, and error details
7. THE Evaluation_Results_Writer SHALL use Node.js 20.x runtime

### Requirement 4: Implement On-Demand Evaluation Trigger

**User Story:** As a developer, I want to trigger evaluations for specific agent traces on demand, so that I can evaluate summaries during testing and development without waiting for online evaluation.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL expose a function that triggers On_Demand_Evaluation for a specific Agent_Trace using the AgentCore Evaluations API
2. WHEN On_Demand_Evaluation is triggered, THE Evaluation_Runner SHALL specify the Built_In_Evaluator and all registered Custom_Evaluators
3. WHEN On_Demand_Evaluation completes, THE Evaluation_Runner SHALL return the evaluation scores as a dict with keys `helpfulness`, `faithfulness`, `completeness`, `anomalyAccuracy`, and `evaluatedAt`
4. THE Evaluation_Runner SHALL support triggering evaluation by trace ID or by providing the summary text and source documents directly
5. IF On_Demand_Evaluation fails, THEN THE Evaluation_Runner SHALL return an error dict with a descriptive message and the failing evaluator name

### Requirement 5: CDK Infrastructure for Evaluation Pipeline

**User Story:** As a DevOps engineer, I want the evaluation pipeline infrastructure defined in CDK, so that the Evaluation_Results_Writer Lambda, IAM permissions, and event routing are deployed consistently through the pipeline.

#### Acceptance Criteria

1. THE rag-application-stack SHALL define the Evaluation_Results_Writer Lambda function with Node.js 20.x runtime
2. THE rag-application-stack SHALL grant the Evaluation_Results_Writer Lambda write access to the existing Evaluation_Results_Table
3. THE rag-application-stack SHALL grant the Evaluation_Results_Writer Lambda permissions to receive events from AgentCore Evaluations
4. THE rag-application-stack SHALL set the `EVALUATION_RESULTS_TABLE` and `BEDROCK_REGION` environment variables on the Evaluation_Results_Writer Lambda
5. THE rag-application-stack SHALL grant the Orchestrator_Lambda permissions to invoke the AgentCore Evaluations API for on-demand evaluation triggers
6. THE rag-application-stack SHALL create IAM policies allowing the evaluation pipeline to call `bedrock-agentcore:CreateEvaluator`, `bedrock-agentcore:GetEvaluator`, `bedrock-agentcore:CreateEvaluationConfig`, and `bedrock-agentcore:StartEvaluation` actions
7. THE rag-application-stack SHALL parameterize the AgentCore agent identifiers using CDK parameters or environment variables

### Requirement 6: Evaluation Score Format Compatibility

**User Story:** As a developer, I want evaluation scores written in the exact format the existing frontend and backend expect, so that no changes are needed to the EvaluationScoreDisplay component or the Orchestrator_Lambda read path.

#### Acceptance Criteria

1. THE Evaluation_Results_Writer SHALL write `helpfulness` as a numeric value between 0 and 1
2. THE Evaluation_Results_Writer SHALL write `faithfulness` as a numeric value between 0 and 1
3. THE Evaluation_Results_Writer SHALL write `completeness` as a numeric value between 0 and 1
4. THE Evaluation_Results_Writer SHALL write `anomalyAccuracy` as a numeric value between 0 and 1 when anomaly evaluation is performed
5. THE Evaluation_Results_Writer SHALL write `evaluatedAt` as an ISO 8601 timestamp string
6. THE Evaluation_Results_Writer SHALL construct the `strategyKey` sort key as `{strategy}#{chunkingMethod}` where `chunkingMethod` is `none` for non-RAG strategies
7. WHEN the Orchestrator_Lambda queries the Evaluation_Results_Table with a `claimId` and `strategyKey`, THE returned record SHALL contain all fields expected by the EvaluationScores TypeScript interface

### Requirement 7: CI/CD Evaluation Integration

**User Story:** As a developer, I want evaluations to run as automated tests in the CI/CD pipeline, so that summary quality regressions are caught before deployment.

#### Acceptance Criteria

1. THE CI_Evaluation_Script SHALL run evaluations against a fixed test dataset of claim summaries with known expected quality ranges
2. THE CI_Evaluation_Script SHALL invoke the Faithfulness_Evaluator, Completeness_Evaluator, and Anomaly_Accuracy_Evaluator directly (without requiring AgentCore Evaluations service access) for offline testing
3. WHEN any evaluation score falls below a configurable threshold, THE CI_Evaluation_Script SHALL exit with a non-zero status code and report the failing metric, actual score, and threshold
4. THE CI_Evaluation_Script SHALL support configurable score thresholds via environment variables or a configuration file
5. THE CI_Evaluation_Script SHALL produce a JSON report with per-test-case scores and an overall pass/fail status
6. THE CI_Evaluation_Script SHALL be executable via `pytest` from the `unit_tests/` directory

### Requirement 8: Evaluation Configuration Management

**User Story:** As a developer, I want evaluation configuration (evaluator definitions, thresholds, model settings) managed in a single configuration module, so that evaluator behavior is consistent across online evaluation, on-demand evaluation, and CI/CD testing.

#### Acceptance Criteria

1. THE evaluation configuration module SHALL define the evaluation criteria prompt for each custom evaluator (Faithfulness, Completeness, Anomaly Accuracy)
2. THE evaluation configuration module SHALL define the scoring schema (0-1 scale, score field name, reasoning field name) for each custom evaluator
3. THE evaluation configuration module SHALL define default score thresholds for CI/CD pass/fail decisions (helpfulness, faithfulness, completeness, anomaly accuracy)
4. THE evaluation configuration module SHALL specify the evaluator model ID as `amazon.nova-pro-v1:0`
5. WHEN the evaluation configuration module is imported, THE module SHALL provide evaluator definitions usable by both the AgentCore registration code and the offline CI/CD evaluators
6. THE evaluation configuration module SHALL reside in the `evaluators/` directory

### Requirement 9: Agent Trace Metadata for Evaluation Context

**User Story:** As a developer, I want agent traces to include claim metadata (claimId, strategy, chunkingMethod), so that the evaluation pipeline can associate scores with the correct claim and strategy in the Evaluation_Results_Table.

#### Acceptance Criteria

1. WHEN a Strands_Agent processes a claim, THE agent entry point SHALL set OpenTelemetry span attributes `claim.id`, `claim.strategy`, and `claim.chunking_method` on the root span
2. THE `claim.strategy` span attribute SHALL contain one of `full-context`, `rag`, or `graph-rag`
3. THE `claim.chunking_method` span attribute SHALL contain the chunking method value for RAG strategy or `none` for non-RAG strategies
4. WHEN the Evaluation_Results_Writer receives evaluation results, THE Evaluation_Results_Writer SHALL extract `claim.id`, `claim.strategy`, and `claim.chunking_method` from the trace span attributes to construct the `claimId` partition key and `strategyKey` sort key
5. IF the trace span attributes do not contain `claim.id`, THEN THE Evaluation_Results_Writer SHALL log a warning and skip writing the evaluation result

### Requirement 10: Existing Evaluator Migration to AgentCore Registration

**User Story:** As a developer, I want the existing custom evaluator implementations (FaithfulnessEvaluator, CompletenessEvaluator) reused as the evaluation criteria for AgentCore custom evaluator registration, so that evaluation behavior is preserved and no duplicate logic is maintained.

#### Acceptance Criteria

1. THE Evaluation_Runner SHALL use the existing `FAITHFULNESS_PROMPT` from `evaluators/faithfulness_evaluator.py` as the evaluation criteria when registering the Faithfulness custom evaluator with AgentCore Evaluations
2. THE Evaluation_Runner SHALL use the existing `COMPLETENESS_PROMPT` from `evaluators/completeness_evaluator.py` as the evaluation criteria when registering the Completeness custom evaluator with AgentCore Evaluations
3. THE existing `FaithfulnessEvaluator` and `CompletenessEvaluator` classes SHALL remain available for direct invocation in CI/CD offline testing
4. THE Evaluation_Runner SHALL add a new `ANOMALY_ACCURACY_PROMPT` for the Anomaly Accuracy evaluator that scores detected anomalies against source document content
5. WHEN the AgentCore-registered evaluators and the offline CI/CD evaluators are given the same input, THE scores SHALL be comparable because both use the same evaluation criteria prompts and the same evaluator model
