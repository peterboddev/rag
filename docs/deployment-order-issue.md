# Deployment Order Issue: Export Name Conflict

## Problem

The application stack deployment is failing with:
```
Export with name rag-app-dev-api-url is already exported by stack rag-app-api-gateway-dev
```

## Root Cause

There are two stacks trying to export the same CloudFormation export name:
1. **Platform Stack**: `rag-app-api-gateway-dev` (platform team's API Gateway stack)
2. **Application Stack**: `RAGApplicationStack` (our application stack - from old deployment)

## Current State

- The application code has been updated to remove the `exportName` from the API Gateway URL output
- However, the existing CloudFormation stack still has the old export
- CloudFormation cannot update the stack because the platform stack is already exporting that name

## Solution Options

### Option 1: Delete Old Application Stack First (Recommended)

The platform team should delete the old `RAGApplicationStack` (or whatever the old stack name was) before deploying the new one:

```bash
# Delete the old stack
aws cloudformation delete-stack --stack-name RAGApplicationStack

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name RAGApplicationStack

# Then deploy the new stack
# (pipeline will handle this automatically)
```

### Option 2: Platform Team Temporarily Removes Their Export

If the platform team can temporarily remove their export:

1. Platform team removes `exportName` from their API Gateway stack
2. Platform team deploys their stack
3. Application team deploys application stack (without the export)
4. Platform team adds back their `exportName`
5. Platform team redeploys their stack

This is more complex and requires coordination.

### Option 3: Change Application Stack Name

If we change the application stack name, CloudFormation will treat it as a new stack:

```typescript
// In infrastructure/app.ts
new RAGApplicationStack(app, 'RAGApplicationStackV2', {
  // ...
});
```

Then delete the old stack after the new one is deployed.

## Recommended Approach

**Option 1** is cleanest. The platform team should:

1. Check if there's an existing application stack:
   ```bash
   aws cloudformation describe-stacks --stack-name RAGApplicationStack
   ```

2. If it exists and has the conflicting export, delete it:
   ```bash
   aws cloudformation delete-stack --stack-name RAGApplicationStack
   ```

3. Wait for deletion to complete (or check status):
   ```bash
   aws cloudformation wait stack-delete-complete --stack-name RAGApplicationStack
   ```

4. Then trigger the pipeline to deploy the new stack

## Prevention

Going forward:
- Platform team owns and exports infrastructure-level resources (API Gateway, DynamoDB tables, etc.)
- Application team should NOT export names that might conflict with platform exports
- Use unique prefixes for application-specific exports (e.g., `rag-app-application-dev-*`)

## Current Code State

The application code is correct - the `exportName` has been removed:

```typescript
// infrastructure/rag-application-stack.ts
new cdk.CfnOutput(this, 'ApiGatewayUrl', {
  value: `https://${apiGatewayId}.execute-api.${this.region}.amazonaws.com/${environment}`,
  description: 'API Gateway URL',
  // exportName removed - platform team exports this from their API Gateway stack
});
```

The issue is purely a CloudFormation state problem, not a code problem.

## Contact

Platform team: Please delete the old application stack before deploying the new one.
