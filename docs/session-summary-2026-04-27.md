# Session Summary — April 27, 2026

## What was accomplished

### Enriched Agent Fix
- Enriched agent was returning `ResourceNotFoundException` on DynamoDB Query — turned out the container had stale/corrupted code from the `agentcore deploy` dockerignore bug
- Redeployed enriched agent container via manual CodeBuild + EC2 `agentcore deploy` — now working

### Full Context Agent — Model Switch & Deployment
- Nova Pro `ConverseStream` was consistently producing `modelStreamErrorException` with invalid ToolUse sequences
- Switched full_context_agent from Nova Pro to Claude Sonnet 4 (`us.anthropic.claude-sonnet-4-20250514-v1:0`)
- Added retry logic (3 attempts with exponential backoff) for transient model errors
- Destroyed old runtime (`full_context_agent-OoiQfVAkoJ`) and created new one (`full_context_agent-JPy4fp8FSf`)
- Updated orchestrator Lambda env var `FULL_CONTEXT_AGENT_ENDPOINT` to new ARN

### AgentCore Starter Toolkit Dockerignore Bug
- Identified and documented the `agentcore deploy` dockerignore bug: the CLI always uses a hardcoded `dockerignore.template` with 47 patterns that strips source files
- The bug is in `CodeBuildService._parse_dockerignore()` and `CodeZipPackager._get_ignore_patterns()` — both unconditionally load from `dockerignore.template` via `importlib.resources`
- User provided a fix in `bedrock-agentcore-starter-toolkit-dockerignore-fix.tar.gz` — patched the toolkit on EC2 to respect user `.dockerignore` files
- Verified fix works: `Using user .dockerignore with 11 patterns` instead of `Using dockerignore.template with 47 patterns`
- Bugfix spec at `.kiro/specs/agent-core-deploy-bugfix/bugfix.md`
- No existing GitHub issue found — new issue to be filed

### Full Context Tab (Frontend Feature)
- Created spec: `.kiro/specs/full-context-tab/`
- Pulled full-context strategy out of StrategyComparisonView into its own "Full Context Analysis" tab in ClaimSummaryModal
- StrategyComparisonView now only has 3 fast strategies: RAG, Graph RAG, Enriched
- New FullContextTab component with model selector, custom prompt, Generate/Regenerate button, elapsed timer
- Both tabs always mounted (display:none for hidden) to preserve state across switches
- Async regeneration pattern: forceRegenerate returns 202, frontend polls for result

### Split Anomaly Detection (Agent Feature)
- Created spec: `.kiro/specs/split-anomaly-detection/`
- Split `detect_anomalies` into `detect_anomalies_deterministic` and `detect_anomalies_llm` tools
- Fixed payment date comparison bug (was flagging payment AFTER service as anomalous)
- Added `_check_billed_vs_allowed_anomalies` with correct descriptions
- Created `detect_anomalies_llm` tool using Bedrock `invoke_model` with structured prompt
- Updated system prompt and tool list
- Added `source?: 'deterministic' | 'llm'` to DataAnomaly TypeScript type
- Refactored AnomalySection to group by source: "🔧 Rule-Based", "🤖 AI-Detected", "⚠️ Other"
- Orchestrator tags untagged anomalies as "llm"

### Orchestrator Lambda Updates
- Added async regeneration pattern (202 + polling) for forceRegenerate requests
- Added retry logic for transient ConverseStream/ToolUse errors
- Deployed via esbuild bundle + direct Lambda code update

## Current State

### Working
- Enriched agent (AgentCore) — DynamoDB access fixed
- Full-context agent (AgentCore, Claude Sonnet 4) — no more ToolUse errors
- Financial timeline agent (AgentCore) — working
- RAG/Graph RAG strategies — working (cache hits fast)
- Frontend: two-tab layout (Summarize Claim + Full Context Analysis)
- Anomaly source tagging in orchestrator
- Async regeneration pattern

### Pending
- AgentCore container caching: the full_context_agent container may still be running old code (without the deterministic anomaly tool). The handler post-processing tags anomalies as "llm" as a workaround. Once the container refreshes, deterministic anomalies will appear with proper tags.
- Cache invalidation IAM: the orchestrator Lambda role doesn't have `dynamodb:Query` on the `claimId-index` GSI of the summary cache table — cache invalidation fails silently
- The `agentcore deploy` dockerignore fix needs to be PR'd to the upstream repo
- Optional: property-based tests for the split anomaly detection feature
- Evaluation job caller fixes applied (model ID, job name lowercase, IAM permissions, inference params removed) but metric names need updating — `Builtin.Faithfulness` and `Builtin.Completeness` are for knowledge base evaluations, not model evaluations. Need to switch to judge-based evaluation metrics or use the correct metric names for the task type.

## Key Config
- Full context agent ARN: `arn:aws:bedrock-agentcore:us-east-1:450683699755:runtime/full_context_agent-JPy4fp8FSf`
- Enriched agent ARN: `arn:aws:bedrock-agentcore:us-east-1:450683699755:runtime/enriched_agent-GnXeYAHi4F`
- EC2 instance (eu-west-1): `i-0622f69effbd56274` — stopped, has patched agentcore toolkit
- Orchestrator Lambda: `rag-app-development-ClaimSummaryOrchestratorFuncti-yKDyBwo7PSI1`
