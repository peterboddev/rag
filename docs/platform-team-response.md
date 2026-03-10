# Platform Team Response: Asset Publishing Implementation

## Summary

Thank you for the detailed request. After reviewing our implementation, we can confirm that **Option A is how our pipeline works** - asset publishing happens in the same CodeBuild environment as deployment, and `npx cdk deploy` handles everything automatically.

## Current Implementation

Our deployment stage uses this approach:

```typescript
// Deploy Stage CodeBuild Project
buildSpec: codebuild.BuildSpec.fromObject({
  version: '0.2',
  phases: {
    install: {
      'runtime-versions': {
        nodejs: '20',
      },
      commands: [
        'echo "Installing dependencies..."',
        'npm ci',
      ],
    },
    build: {
      commands: [
        'echo "Deploying CDK stack..."',
        'npx cdk deploy ${target.stackName} --require-approval never --verbose',
      ],
    },
  },
}),
```

**What this means:**
- The deploy stage receives your build artifacts (from `buildOutput`)
- It runs `npm ci` to reinstall dependencies
- It runs `npx cdk deploy` which:
  - Reads `cdk.out/*.template.json` and `cdk.out/*.assets.json`
  - Publishes assets to S3 automatically
  - Deploys the CloudFormation stack

## Required Artifacts

For this to work, your buildspec.yml artifacts **MUST include**:

```yaml
artifacts:
  files:
    - '**/*'  # Include ALL files
```

**Why you need everything:**
1. **CDK source code** - `npx cdk deploy` needs your TypeScript files to run
2. **cdk.out/ directory** - Including templates, assets.json, AND asset directories
3. **package.json** - So `npm ci` knows what to install
4. **node_modules/** (optional) - Can be cached or reinstalled

## The Issue With Your Current Artifacts

Your current configuration:
```yaml
artifacts:
  files:
    - 'cdk.out/*.template.json'
    - 'cdk.out/*.assets.json'
    - 'cdk.out/manifest.json'
    - 'cdk.out/tree.json'
  # Asset directories NOT included ❌
```

**This won't work because:**
- `npx cdk deploy` needs the actual asset directories (`cdk.out/asset.*`)
- Without them, it can't publish assets to S3
- CloudFormation deployment fails with NoSuchKey errors

## Solution: Include All Files in Artifacts

Update your buildspec.yml to:

```yaml
artifacts:
  files:
    - '**/*'  # Include everything
  # Do NOT use base-directory
```

**Addressing your concerns:**

### "Each Lambda asset directory is 216MB"

This is expected for Lambda functions with dependencies. However:

1. **CodePipeline artifact limits:**
   - S3 artifact store has no practical size limit for your use case
   - The 5GB limit per artifact is per-action, not per-pipeline
   - Your 216MB assets are well within limits

2. **Build performance:**
   - Artifacts are compressed during upload
   - S3 transfer is fast (especially within AWS)
   - The time cost is minimal compared to deployment time

3. **Alternative: Optimize Lambda bundle size**
   - Use esbuild or webpack to bundle Lambda code
   - Exclude unnecessary dependencies
   - This reduces asset size significantly (from 216MB to ~5MB typically)

### "Your asset publishing should read from build environment"

This is a misunderstanding of how CodePipeline works:

- **Build stage** and **Deploy stage** run in **separate CodeBuild environments**
- The deploy stage doesn't have access to the build environment's filesystem
- Artifacts are the ONLY way to pass files between stages
- This is by design for isolation and reproducibility

## Recommended Buildspec.yml

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - echo "Installing dependencies..."
      - npm ci

  pre_build:
    commands:
      - echo "Running tests..."
      - npm run test

  build:
    commands:
      - echo "Building application..."
      - npm run build
      - echo "Synthesizing CDK stack..."
      - npx cdk synth
      - echo "Listing generated files..."
      - ls -la cdk.out/

  post_build:
    commands:
      - echo "Build completed successfully"

# Include ALL files - this is required for cdk deploy to work
artifacts:
  files:
    - '**/*'

cache:
  paths:
    - 'node_modules/**/*'
```

## How It Works (Corrected Workflow)

```
┌─────────────────────────────────────────────────────────────┐
│ CodeBuild: Build Stage (your buildspec.yml)                │
├─────────────────────────────────────────────────────────────┤
│ 1. npm ci                                                   │
│ 2. npm run test                                             │
│ 3. npm run build                                            │
│ 4. npx cdk synth                                            │
│    → Creates cdk.out/*.template.json                        │
│    → Creates cdk.out/*.assets.json                          │
│    → Creates cdk.out/asset.* directories (216MB each)       │
│ 5. Upload ALL files as artifacts (including asset dirs)     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CodePipeline: Artifact Transfer                             │
├─────────────────────────────────────────────────────────────┤
│ • Artifacts stored in S3 (compressed)                       │
│ • Includes: source code, cdk.out/, package.json            │
│ • Size: ~216MB (compressed to ~100MB typically)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ CodeBuild: Deploy Stage (platform-controlled)              │
├─────────────────────────────────────────────────────────────┤
│ 1. Download build artifacts (ALL files)                    │
│ 2. npm ci (reinstall dependencies)                         │
│ 3. npx cdk deploy RAGApplicationStack                      │
│    → Reads cdk.out/RAGApplicationStack.template.json       │
│    → Reads cdk.out/RAGApplicationStack.assets.json         │
│    → Publishes assets from cdk.out/asset.* to S3           │
│    → Deploys CloudFormation stack                          │
│ 4. ✅ Deployment succeeds                                   │
└─────────────────────────────────────────────────────────────┘
```

## Why We Use This Approach

**Alternative approaches we considered:**

1. **Separate asset publishing stage** ❌
   - Requires passing asset directories between stages
   - More complex, more failure points
   - No benefit over `cdk deploy`

2. **Manual asset publishing with cdk-assets** ❌
   - Requires custom scripting
   - Error-prone
   - `cdk deploy` does this automatically

3. **Current approach: npx cdk deploy** ✅
   - Single command handles everything
   - Reliable and well-tested
   - Standard CDK deployment pattern
   - Automatic asset publishing

## Optimizing Lambda Bundle Size (Optional)

If 216MB artifacts are a concern, you can optimize your Lambda bundles:

### Option 1: Use esbuild (Recommended)

```typescript
// In your CDK stack
const chatFunction = new lambda.Function(this, 'ChatFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('src/handlers', {
    bundling: {
      image: lambda.Runtime.NODEJS_20_X.bundlingImage,
      command: [
        'bash', '-c',
        'npm install && npx esbuild index.ts --bundle --platform=node --target=node20 --outfile=/asset-output/index.js'
      ],
    },
  }),
});
```

This reduces bundle size from 216MB to ~5MB typically.

### Option 2: Exclude unnecessary dependencies

```typescript
code: lambda.Code.fromAsset('src/handlers', {
  bundling: {
    nodeModules: ['@aws-sdk/client-bedrock-runtime'], // Only include what you need
    externalModules: ['aws-sdk'], // Exclude AWS SDK (available in Lambda runtime)
  },
}),
```

## Next Steps

1. **Update your buildspec.yml** to include all files:
   ```yaml
   artifacts:
     files:
       - '**/*'
   ```

2. **Commit and push** the change

3. **Pipeline will trigger automatically**

4. **Verify in CodeBuild logs:**
   - Build stage uploads artifacts successfully
   - Deploy stage downloads artifacts
   - `npx cdk deploy` publishes assets to S3
   - CloudFormation deployment succeeds

5. **Optional: Optimize Lambda bundles** to reduce artifact size

## Questions?

If you have any questions or need help with:
- Updating your buildspec.yml
- Optimizing Lambda bundle sizes
- Debugging deployment issues

Please reach out to the platform team.

---

**Platform Team**  
Last Updated: 2026-03-10
