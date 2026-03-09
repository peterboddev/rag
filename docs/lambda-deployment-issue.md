# Lambda Deployment Issue: S3 Asset Upload

## Problem

Lambda function deployment is failing with:
```
Error occurred while GetObject. S3 Error Code: NoSuchKey. 
S3 Error Message: The specified key does not exist.
```

## Root Cause

CDK synthesizes Lambda functions with asset references that point to S3 locations. However, the deployment is failing because these assets are not being uploaded to S3 before CloudFormation tries to create the Lambda functions.

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

## Solutions

### Option 1: Use `cdk deploy` in Pipeline (Recommended)

The platform team's pipeline should use `cdk deploy` instead of CloudFormation deploy:

```bash
# Instead of:
aws cloudformation deploy --template-file template.yaml ...

# Use:
npx cdk deploy --require-approval never --context environment=dev
```

This automatically handles asset uploads to the CDK bootstrap bucket.

### Option 2: Manual Asset Upload

If the pipeline must use CloudFormation, add an asset upload step:

```bash
# In buildspec post_build phase:
- echo "Uploading CDK assets..."
- npx cdk-assets publish cdk.out/RAGApplicationStack.assets.json
```

This uploads assets before CloudFormation deployment.

### Option 3: Change Lambda Packaging (Not Recommended)

Change Lambda code to use inline bundling or pre-packaged ZIP files. This is more complex and loses CDK's automatic asset management.

## Questions for Platform Team

1. **Deployment Method**: Does the pipeline use `cdk deploy` or `aws cloudformation deploy`?
2. **Asset Upload**: Is there a step that uploads CDK assets to S3 before deployment?
3. **CDK Bootstrap**: Is the pipeline using the CDK bootstrap bucket for assets?
4. **Working Examples**: Are there other CDK applications successfully deploying Lambda functions through this pipeline?

## Verification

To verify CDK assets are being created correctly:

```bash
# Check asset metadata
cat cdk.out/RAGApplicationStack.assets.json

# Check if assets exist in bootstrap bucket
aws s3 ls s3://cdk-hnb659fds-assets-<account>-<region>/
```

## Recommended Next Steps

1. Platform team confirms deployment method (cdk deploy vs cloudformation deploy)
2. If using CloudFormation, add asset upload step to pipeline
3. If using cdk deploy, investigate why assets aren't being uploaded
4. Test with a simple Lambda function to isolate the issue

## Contact

Application team is ready to adjust CDK code if needed, but this appears to be a pipeline configuration issue rather than an application code issue.
