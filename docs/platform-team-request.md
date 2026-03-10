# Platform Team Request: CDK Asset Publishing Verification

## Summary

We've updated our buildspec.yml to follow the guide's recommendations, but we need to verify that your asset publishing implementation works correctly with our artifact configuration.

## Current Situation

**Our buildspec.yml artifacts section:**
```yaml
artifacts:
  files:
    - 'cdk.out/*.template.json'
    - 'cdk.out/*.assets.json'
    - 'cdk.out/manifest.json'
    - 'cdk.out/tree.json'
  # Note: Asset directories (cdk.out/asset.*) are NOT included
```

**Why we're not including asset directories:**
- Each Lambda asset directory is 216MB (node_modules is 214MB)
- Including them would exceed CodePipeline artifact size limits
- Your asset publishing should read from the build environment, not artifacts

## What We Need From You

### 1. Confirm Asset Publishing Implementation

Please confirm that your CDK asset publishing step:

✅ Runs in the **same CodeBuild environment** where `cdk synth` was executed  
✅ Reads `cdk.out/*.assets.json` to determine what to upload  
✅ Accesses `cdk.out/asset.*` directories directly from the build environment  
✅ Runs `cdk-assets publish` (or equivalent) to upload to S3  
✅ Completes **before** CloudFormation deployment starts  

### 2. Verify Our Artifact Configuration

Does your pipeline need anything else in our build artifacts besides:
- `cdk.out/*.template.json` (CloudFormation templates)
- `cdk.out/*.assets.json` (asset metadata)
- `cdk.out/manifest.json` (CDK manifest)
- `cdk.out/tree.json` (CDK tree)

### 3. Check Asset Publishing Logs

When our next build runs, please verify in CodeBuild logs that:
- Asset publishing step finds and reads `RAGApplicationStack.assets.json`
- Assets are uploaded to `s3://cdk-hnb659fds-assets-450683699755-us-east-1/`
- CloudFormation deployment uses the uploaded S3 keys successfully

## Expected Workflow

```
┌─────────────────────────────────────────────────────────────┐
│ CodeBuild: Build Stage (our buildspec.yml)                 │
├─────────────────────────────────────────────────────────────┤
│ 1. npm ci                                                   │
│ 2. npm run test                                             │
│ 3. npm run build                                            │
│ 4. npx cdk synth                                            │
│    → Creates cdk.out/*.template.json                        │
│    → Creates cdk.out/*.assets.json                          │
│    → Creates cdk.out/asset.* directories (216MB each)       │
│ 5. Upload artifacts (only JSON files, not asset dirs)       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CodeBuild: Asset Publishing Stage (your implementation)    │
├─────────────────────────────────────────────────────────────┤
│ 1. Download build artifacts (JSON files only)              │
│ 2. Read cdk.out/RAGApplicationStack.assets.json            │
│ 3. Access cdk.out/asset.* from build environment           │
│    ⚠️  CRITICAL: Must run in same environment as build     │
│ 4. Run: cdk-assets publish -p cdk.out/RAGApplicationStack  │
│    .assets.json                                             │
│ 5. Upload Lambda code to S3 CDK assets bucket              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CloudFormation: Deploy Stage                                │
├─────────────────────────────────────────────────────────────┤
│ 1. Download artifacts (template.json)                      │
│ 2. Deploy stack                                             │
│ 3. Lambda functions reference S3 keys from asset publish   │
│ 4. ✅ Deployment succeeds                                   │
└─────────────────────────────────────────────────────────────┘
```

## The Problem We're Trying to Solve

**Previous Issue:**
- Lambda deployment failed with "S3 Error Code: NoSuchKey"
- Assets weren't being uploaded before CloudFormation deployment

**Current Question:**
- Does your asset publishing step run in the same CodeBuild environment as the build?
- Or does it run in a separate environment where `cdk.out/asset.*` directories don't exist?

**If it runs in a separate environment:**
- You'll need us to include `cdk.out/asset.*/**/*` in artifacts (but this is 216MB+)
- Or you need to modify your implementation to run in the same environment

## Recommended Solution

**Option A (Preferred):** Asset publishing runs in the same CodeBuild environment
- Our artifacts stay small (only JSON files)
- Your asset publishing accesses `cdk.out/asset.*` directly
- Fast and efficient

**Option B (Fallback):** Asset publishing runs in a separate environment
- We include `cdk.out/asset.*/**/*` in artifacts (216MB+)
- Slower builds and larger artifact storage
- Works but not optimal

## Next Steps

1. Please review your asset publishing implementation
2. Let us know which option applies to your setup
3. We'll adjust our buildspec.yml accordingly
4. Test with our next deployment

## Contact

Application Team: RAG Application  
Stack Name: `RAGApplicationStack`  
Environment: `dev`

Thank you!
