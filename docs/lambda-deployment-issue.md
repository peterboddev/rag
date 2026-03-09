# Lambda Deployment Issue: S3 Asset Upload

## Status: ✅ RESOLVED

The platform team has implemented automatic CDK asset publishing in the pipeline. This issue is now resolved.

## Original Problem

Lambda function deployment was failing with:
```
Error occurred while GetObject. S3 Error Code: NoSuchKey. 
S3 Error Message: The specified key does not exist.
```

## Root Cause

CDK synthesizes Lambda functions with asset references that point to S3 locations. However, the deployment was failing because these assets were not being uploaded to S3 before CloudFormation tried to create the Lambda functions.

## CDK Asset Workflow

When using `lambda.Code.fromAsset()`, CDK:
1. **During synthesis**: Creates asset metadata in `cdk.out/` with S3 bucket/key references
2. **During deployment**: Expects assets to be uploaded to S3 before CloudFormation runs
3. **CloudFormation**: References the S3 locations to create Lambda functions

## Current Situation

Our CDK stack uses:
```typescript
code: lambda.Code.fromAsset('.', {
  exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
})
```

The buildspec includes all files in artifacts:
```yaml
artifacts:
  files:
    - '**/*'
```

## The Issue

The pipeline appears to be deploying using CloudFormation directly (not `cdk deploy`), which means:
- CDK assets are NOT automatically uploaded to S3
- CloudFormation tries to create Lambda functions with S3 keys that don't exist
- Deployment fails with "NoSuchKey" error

## Platform Team Solution (Implemented)

The platform team has implemented automatic CDK asset publishing in the application pipeline:

### How It Works

1. **Automatic Detection**: Detects CDK applications by checking if `templatePath` contains `cdk.out/`
2. **Asset Publishing Step**: Creates an asset publishing step for each deployment target:
   - Runs `npx cdk-assets publish` to upload Lambda code and Docker images
   - Uploads to CDK bootstrap bucket: `s3://cdk-*-assets-<account>-<region>/`
   - Grants necessary S3 permissions automatically
3. **Proper Sequencing**: Uses `runOrder` to ensure correct execution:
   - Asset publishing runs first (runOrder: 1)
   - CloudFormation deployment runs after (runOrder: 2)

### What This Fixes

✅ Lambda functions with `lambda.Code.fromAsset()` now deploy successfully  
✅ Docker images for Lambda containers are published to ECR  
✅ All CDK assets are uploaded before CloudFormation tries to use them  
✅ No changes required from app teams - works automatically

### Impact on SAM Applications

SAM applications are unaffected - they don't need asset publishing because SAM packages everything during the build phase.

## For Application Teams

No action required! The pipeline now automatically handles CDK asset publishing. You can continue using `lambda.Code.fromAsset()` in your CDK stacks without any special configuration.

---

## Historical Context (Original Investigation)

The sections below document the original investigation and proposed solutions. They are kept for reference but are no longer needed since the platform team has implemented the fix.
