# Platform Team Action Required

## Issue: CodeBuild Not Using Repository buildspec.yml

### Problem

The CodeBuild project for `rag-app-build` appears to have a buildspec override configured that is not using the `buildspec.yml` from the application repository.

**Evidence:**
- Repository `buildspec.yml` has 13 commands in `post_build` phase
- CodeBuild logs show: `POST_BUILD: 1 commands`
- Artifacts collection fails with: `Skipping invalid file path template.yaml`

### Root Cause

The CodeBuild project configuration likely has one of these issues:
1. **Buildspec Override**: Project is configured with an inline buildspec or alternate buildspec path
2. **Cached Buildspec**: Project is using an old cached version of the buildspec

### Required Action

The platform team needs to configure the CodeBuild project to use the buildspec.yml from the repository:

#### Option 1: Use Repository Buildspec (Recommended)

In the CodeBuild project configuration:
1. Go to AWS Console → CodeBuild → Projects → `rag-app-build`
2. Click "Edit" → "Buildspec"
3. Select "Use a buildspec file"
4. Set buildspec name to: `buildspec.yml`
5. Save changes

#### Option 2: Update Buildspec Override

If the platform team needs to maintain a buildspec override, update it to include the application team's post_build commands:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - echo "Installing dependencies..."
      - npm ci --include=dev
      
  pre_build:
    commands:
      - echo "Running unit tests..."
      - npm run test --if-present
      
  build:
    commands:
      - echo "Building TypeScript..."
      - npm run build
      - echo "Synthesizing CDK..."
      - echo "Environment context: ${ENVIRONMENT:-dev}"
      - |
        if [ -n "$ENVIRONMENT" ]; then
          cdk synth --context environment=$ENVIRONMENT || exit 1
        else
          npm run synth || exit 1
        fi
      - echo "Verifying CDK output..."
      - ls -la cdk.out/ | head -20
      - echo "Checking if RAGApplicationStack template was created..."
      - test -f cdk.out/RAGApplicationStack.template.json && echo "✓ Stack template found" || (echo "✗ Stack template NOT found - CDK synth failed" && exit 1)
      
  post_build:
    commands:
      - echo "Copying CDK template to expected SAM format..."
      - cp cdk.out/RAGApplicationStack.template.json template.yaml
      - echo "Verifying template.yaml was created at root..."
      - ls -la template.yaml
      - echo "Template file size:"
      - wc -l template.yaml
      - echo "Build artifacts ready for deployment"

artifacts:
  files:
    - 'template.yaml'
    - 'cdk.out/**/*'
  name: BuildOutput
```

### Why This Matters

The application team needs control over:
1. **Build steps**: TypeScript compilation, CDK synthesis
2. **Test execution**: Unit test configuration and execution
3. **Artifact generation**: Creating `template.yaml` for deployment stage
4. **Environment configuration**: Handling environment-specific builds

Without the correct buildspec, the deployment stage fails because `template.yaml` is not created.

### Verification

After making changes, verify the buildspec is being used:

```bash
# Check CodeBuild project configuration
aws codebuild batch-get-projects --names rag-app-build \
  --query 'projects[0].source.buildspec' --output text

# Should return empty (uses repo buildspec) or show the override
```

### Current Impact

- ✅ Build phase completes successfully
- ✅ Unit tests pass
- ✅ CDK synthesis succeeds
- ❌ Deployment stage fails: `File [template.yaml] does not exist in artifact [BuildOutput]`

### Timeline

This is blocking application deployment. Please prioritize this configuration change.

### Contact

For questions about the application team's build requirements, contact the development team.

## Related Documentation

- [Project Guidelines](./.kiro/steering/project-guidelines.md) - Clarifies buildspec ownership
- [Pipeline Configuration](./pipeline-configuration.md) - Expected pipeline behavior
- [Deployment Guide](./deployment.md) - Full deployment process
