# Platform Infrastructure Migration Guide

## Overview

This guide documents the migration from the self-managed `rag-app-v2` infrastructure to the platform-integrated `rag-app` architecture. The migration transitions from creating our own DynamoDB tables, IAM roles, and API Gateway to importing platform-provided resources.

## Migration Summary

### What Changed

**Removed (Now Platform-Managed):**
- DynamoDB table creation (`rag-app-v2-customers-dev`, `rag-app-v2-documents-dev`)
- IAM role creation for Lambda functions
- API Gateway REST API creation
- Resource naming with `-v2` suffix

**Added (Application-Managed):**
- SSM parameter lookups for platform resources
- Resource imports using CDK constructs
- SQS queue for document processing
- Standardized `rag-app` naming convention

**Unchanged:**
- All Lambda function code
- API endpoint paths and methods
- Multi-tenant architecture
- Document processing pipeline
- Insurance Claim Portal functionality

### Benefits

1. **Centralized Management**: Platform team manages shared infrastructure
2. **Consistent Security**: Standardized IAM roles and policies
3. **Simplified Operations**: Reduced operational overhead
4. **Better Governance**: Centralized monitoring and compliance
5. **Cost Optimization**: Shared resource costs

## Prerequisites

Before starting the migration, ensure:

1. **Platform Infrastructure Deployed**: Platform team has deployed all required resources
2. **SSM Parameters Exist**: All required SSM parameters are populated
3. **Backup Created**: Current infrastructure and data backed up
4. **Testing Environment**: Dev environment available for testing

### Required SSM Parameters

Verify these parameters exist in AWS Systems Manager Parameter Store:

```bash
# IAM Role
aws ssm get-parameter --name /rag-app/dev/iam/application-role-arn

# API Gateway
aws ssm get-parameter --name /rag-app/dev/apigateway/api-id
aws ssm get-parameter --name /rag-app/dev/apigateway/root-resource-id

# DynamoDB Tables
aws ssm get-parameter --name /rag-app/dev/dynamodb/customers-table-name
aws ssm get-parameter --name /rag-app/dev/dynamodb/documents-table-name
```

## Step-by-Step Migration Process

### Phase 1: Code Preparation

#### Step 1: Update Infrastructure Code

1. **Create New Stack File**
   ```bash
   # New file: infrastructure/rag-application-stack.ts
   # Implements SSM parameter lookups and resource imports
   ```

2. **Update App Entry Point**
   ```bash
   # Update: infrastructure/app.ts
   # Change stack name from RAGInfrastructureStack to RAGApplicationStack
   ```

3. **Update CDK Configuration**
   ```bash
   # Update: cdk.json
   # Add environment context variable
   ```

#### Step 2: Update Tests

1. **Update Unit Tests**
   ```bash
   # Update: unit_tests/infrastructure-stack.test.ts
   # Change resource names from rag-app-v2 to rag-app
   ```

2. **Run Tests Locally**
   ```bash
   npm test
   ```

#### Step 3: Update Documentation

1. **Update README**
   - Add SSM parameter requirements
   - Document platform prerequisites
   - Update resource naming conventions
   - Add troubleshooting section

2. **Create Architecture Documentation**
   - Document platform vs application resources
   - Create architecture diagrams
   - Document data flows

### Phase 2: Development Environment Deployment

#### Step 4: Verify Platform Infrastructure

```bash
# Check DynamoDB tables exist
aws dynamodb describe-table --table-name rag-app-customers-dev
aws dynamodb describe-table --table-name rag-app-documents-dev

# Check API Gateway exists
API_ID=$(aws ssm get-parameter --name /rag-app/dev/apigateway/api-id --query 'Parameter.Value' --output text)
aws apigateway get-rest-api --rest-api-id $API_ID

# Check IAM role exists
ROLE_ARN=$(aws ssm get-parameter --name /rag-app/dev/iam/application-role-arn --query 'Parameter.Value' --output text)
aws iam get-role --role-name $(echo $ROLE_ARN | cut -d'/' -f2)
```

#### Step 5: Review CDK Diff

```bash
# Review changes before deployment
cdk diff --context environment=dev

# Expected changes:
# - Remove: DynamoDB tables, IAM role, API Gateway
# - Add: S3 bucket, SQS queue, Lambda functions
# - Modify: Lambda environment variables
```

#### Step 6: Deploy to Development

```bash
# Deploy the new stack
cdk deploy --context environment=dev \
  --parameters UserPoolId=<user-pool-id> \
  --parameters KnowledgeBaseId=<kb-id> \
  --parameters VectorDbEndpoint=<opensearch-endpoint>

# Monitor deployment
# Watch for any errors related to SSM parameters or resource imports
```

#### Step 7: Verify Deployment

```bash
# Check stack outputs
aws cloudformation describe-stacks \
  --stack-name RAGApplicationStack \
  --query 'Stacks[0].Outputs'

# Verify Lambda functions created
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `RAGApplicationStack`)].FunctionName'

# Verify S3 bucket created
aws s3 ls | grep rag-app-documents-dev

# Verify SQS queue created
aws sqs list-queues | grep rag-app-document-processing-dev
```

### Phase 3: Testing & Validation

#### Step 8: Smoke Tests

Run smoke tests on all API endpoints:

```bash
# Test customer creation
curl -X POST https://<api-gateway-url>/customers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "name": "Test User"}'

# Test document upload
curl -X POST https://<api-gateway-url>/documents \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"customerUuid": "<uuid>", "filename": "test.pdf"}'

# Test chunking configuration
curl -X GET https://<api-gateway-url>/customers/<uuid>/chunking-config \
  -H "Authorization: Bearer <token>"

# Test Insurance Claim Portal
curl -X GET https://<api-gateway-url>/patients \
  -H "Authorization: Bearer <token>"
```

#### Step 9: Integration Tests

Platform team runs integration tests:
- End-to-end document processing
- Multi-tenant isolation verification
- API Gateway authorization
- Lambda function permissions

#### Step 10: Performance Testing

Verify performance meets requirements:
- Lambda cold start times
- API response times
- Document processing throughput
- DynamoDB query performance

### Phase 4: Staging & Production

#### Step 11: Deploy to Staging

```bash
# Deploy to staging environment
cdk deploy --context environment=staging \
  --parameters UserPoolId=<staging-user-pool-id> \
  --parameters KnowledgeBaseId=<staging-kb-id> \
  --parameters VectorDbEndpoint=<staging-opensearch-endpoint>

# Run full test suite in staging
npm test
```

#### Step 12: Production Deployment

```bash
# Review production configuration
cdk diff --context environment=prod

# Deploy to production
cdk deploy --context environment=prod \
  --parameters UserPoolId=<prod-user-pool-id> \
  --parameters KnowledgeBaseId=<prod-kb-id> \
  --parameters VectorDbEndpoint=<prod-opensearch-endpoint>

# Monitor production deployment
# Watch CloudWatch logs for errors
```

#### Step 13: Post-Deployment Monitoring

Monitor for 24-48 hours:
- CloudWatch Logs for errors
- CloudWatch Metrics for performance
- API Gateway metrics
- Lambda function metrics
- DynamoDB metrics

### Phase 5: Cleanup

#### Step 14: Remove Old Infrastructure

After successful migration and monitoring:

```bash
# The old stack (RAGInfrastructureStack) can be deleted
# This will remove the old self-managed resources
cdk destroy RAGInfrastructureStack --context environment=dev

# Note: Only do this after confirming new stack is working correctly
```

#### Step 15: Update CI/CD Pipeline

Update deployment pipeline configuration:
- Change stack name from `RAGInfrastructureStack` to `RAGApplicationStack`
- Update environment variables
- Update deployment commands

## Verification Steps

### Verify Platform Resources

```bash
# Verify DynamoDB tables accessible
aws dynamodb scan --table-name rag-app-customers-dev --max-items 1
aws dynamodb scan --table-name rag-app-documents-dev --max-items 1

# Verify IAM role permissions
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>

# Verify API Gateway configuration
aws apigateway get-resources --rest-api-id <api-id>
```

### Verify Application Resources

```bash
# Verify S3 bucket
aws s3 ls s3://rag-app-documents-dev/

# Verify SQS queue
aws sqs get-queue-attributes --queue-url <queue-url> --attribute-names All

# Verify Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `RAGApplicationStack`)].FunctionName'
```

### Verify Functionality

Test all major features:
- [ ] Customer creation
- [ ] Document upload
- [ ] Document processing
- [ ] Document summary generation
- [ ] Chunking configuration
- [ ] Insurance Claim Portal
- [ ] Multi-tenant isolation

## Rollback Procedures

If issues occur during migration:

### Rollback Step 1: Identify Issue

Determine the scope of the issue:
- Infrastructure deployment failure
- Application functionality broken
- Performance degradation
- Data access issues

### Rollback Step 2: Revert Code Changes

```bash
# Revert to previous commit
git revert <commit-hash>

# Or checkout previous version
git checkout <previous-tag>
```

### Rollback Step 3: Redeploy Old Stack

```bash
# Deploy old stack
cdk deploy RAGInfrastructureStack --context environment=dev

# Verify old stack working
# Run smoke tests
```

### Rollback Step 4: Investigate and Fix

- Review CloudWatch logs for errors
- Check SSM parameters
- Verify platform infrastructure
- Contact platform team if needed

## Troubleshooting

### Issue: SSM Parameter Not Found

**Symptoms:**
- Deployment fails with "dummy-value" error
- Stack creation fails during SSM lookup

**Resolution:**
1. Verify parameter exists in SSM
2. Check parameter name matches expected format
3. Verify AWS region is correct
4. Contact platform team to create missing parameters

### Issue: Lambda Permission Denied

**Symptoms:**
- Lambda functions fail with AccessDenied errors
- Cannot access DynamoDB, S3, or other services

**Resolution:**
1. Verify IAM role ARN in SSM is correct
2. Check IAM role has necessary permissions
3. Verify Lambda functions using correct role
4. Contact platform team to update IAM role

### Issue: API Gateway 404 Errors

**Symptoms:**
- API endpoints return 404 Not Found
- Routes not accessible

**Resolution:**
1. Verify API Gateway ID in SSM is correct
2. Check routes were added to correct API
3. Verify API Gateway deployment
4. Check Cognito authorizer configuration

### Issue: DynamoDB Table Not Found

**Symptoms:**
- Lambda functions fail with ResourceNotFoundException
- Cannot access DynamoDB tables

**Resolution:**
1. Verify table names in SSM parameters
2. Check tables exist in correct region
3. Verify Lambda has correct table names in environment variables
4. Contact platform team to verify table deployment

## Post-Migration Checklist

- [ ] All Lambda functions deployed successfully
- [ ] All API endpoints accessible
- [ ] Document upload and processing working
- [ ] Multi-tenant isolation verified
- [ ] Insurance Claim Portal functional
- [ ] CloudWatch logs showing no errors
- [ ] Performance metrics within acceptable range
- [ ] Unit tests passing
- [ ] Integration tests passing (platform team)
- [ ] Documentation updated
- [ ] CI/CD pipeline updated
- [ ] Team trained on new architecture
- [ ] Monitoring dashboards updated

## Support

### Development Team Responsibilities
- Application code and Lambda functions
- API route implementation
- Unit testing
- Application-specific resources (S3, SQS)

### Platform Team Responsibilities
- Platform infrastructure (DynamoDB, IAM, API Gateway)
- SSM parameter management
- Integration testing
- Production deployment
- Infrastructure monitoring

### Contact Information
- **Platform Team**: [Contact details]
- **Development Team Lead**: [Contact details]
- **DevOps Support**: [Contact details]

## Additional Resources

- [Architecture Documentation](./architecture.md)
- [API Design Specifications](./api-design.md)
- [RAG Platform Integration Guide](../docs/rag-app-team-guide.md)
- [CDK Best Practices](https://docs.aws.amazon.com/cdk/latest/guide/best-practices.html)
