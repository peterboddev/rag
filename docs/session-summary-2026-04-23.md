# Session Summary — April 22-23, 2026

## Current State: Everything deployed and working

Full pipeline is green — CDK infrastructure, AgentCore evaluators, online evaluation configs, and all 5 agent containers deployed and producing results in the frontend.

## What was fixed

### CDK/Infrastructure
- `Code.fromAsset('.')` → `Code.fromAsset('src')` to avoid WSL symlink errors with `medical_data`
- Added `npm install -g aws-cdk@latest` to buildspec for CDK CLI version compatibility
- Evaluator instructions: removed invalid placeholders, used `{context}`/`{assistant_turn}` instead of custom ones
- Evaluator model ID: `us.anthropic.claude-sonnet-4-6` (inference profile, not foundation model)
- Renamed `Faithfulness` evaluator to `ClaimFaithfulness` (built-in name conflict)
- Created agent log groups via custom resources (idempotent with `ignoreErrorCodesMatching`)
- Shared pre-created IAM execution role for OnlineEvaluationConfigs (IAM eventual consistency workaround)
- Added `email-index` GSI on customers table
- Frontend `DocumentSummary.tsx`: switched from raw `fetch` to `apiRequest` for auth headers

### AgentCore L2 Construct bugs found and fixed (in tarball)
- `EvaluatorReference._render()`: use `evaluatorId` not `evaluatorArn`
- Log group ARNs need `:*` suffix
- Missing `logs:StartQuery`, `logs:GetQueryResults` on `aws/spans`
- Missing `logs:CreateLogGroup`/`CreateLogStream`/`PutLogEvents` for evaluation results
- Missing `bedrock:InvokeModel` for LLM-as-a-Judge evaluators
- Inference profile detection (`us.`, `eu.`, `global.` prefixes)

### Agent deployment
- `agentcore launch` tool has a bug: dockerignore template strips all source files, leaving only Dockerfile in the zip
- Workaround: manually build source zips with proper content and trigger CodeBuild via S3 source override
- Buildspec updated to package source properly for future pipeline runs

## Pending items

### Agent code changes not yet deployed
- `max_tokens` increase (2000→4096) in `agents/full_context_agent/agent.py`, `agents/rag_agent/agent.py`, `agents/graph_rag_agent/agent.py`
- System prompt change in `full_context_agent/agent.py`: removed "Return as JSON" instruction that conflicts with Nova Pro tool use
- Debug logging added to `agents/enriched_agent/agent.py` (DynamoDB query params) — can be removed once confirmed working

### Pipeline agent deployment
- `.bedrock_agentcore/` is gitignored, so the pipeline can't access Dockerfiles
- The buildspec `post_build` phase packages source and triggers CodeBuild, but needs the Dockerfiles
- Options: (a) un-gitignore `.bedrock_agentcore/`, (b) store Dockerfiles in `agents/{name}/Dockerfile` and copy during build, (c) use a separate deployment mechanism

### Environment setup notes
- AWS CLI in WSL: use `alias aws=/usr/local/bin/aws` and symlink `~/.aws` to `/mnt/d/Users/piotrbod/.aws`
- AWS profile: `AWSAdministratorAccess-450683699755` for account `450683699755` (us-east-1)
- Kiro runs in Git Bash (Windows) — use `--profile AWSAdministratorAccess-450683699755` for all AWS commands targeting the deployment account
- Default credentials (no profile) go to account `227392978404` in `us-east-2` — wrong account
- EC2 instance `i-0622f69effbd56274` in `eu-west-1` — stopped, has agentcore toolkit installed, IAM role `TestRole` has broad permissions

### Known issues
- API Gateway 29s timeout vs Lambda 120s timeout — cold start agent calls can time out on first request
- The `agentcore launch` tool's zip filtering is broken (strips all source files) — manual zip creation is the workaround
- Enriched agent was getting `ResourceNotFoundException` on DynamoDB query — debug logging was added but the issue resolved after rebuilding the container with proper source
