# Deployment Documentation

## Overview

This document describes the deployment process for the Multi-Tenant Document Manager application. The system supports both local development deployment and production deployment through the platform team's CI/CD pipeline.

## Deployment Architecture

### Local Development Deployment

For local development and testing, the application can be deployed directly using AWS CDK:

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Deploy infrastructure
npm run deploy
```

### Production Deployment

Production deployment is managed by the platform team through an external CI/CD pipeline:

1. Developer pushes code to repository
2. External pipeline triggers automatically
3. CodeBuild runs unit tests from `unit_tests/` directory
4. If tests pass, CDK infrastructure is synthesized
5. Platform team handles deployment and integration testing
6. Platform team manages production release

## Infrastructure Components

### AWS Resources Created

The CDK stack creates the following AWS resources:

#### Lambda Functions
- **CustomerManagerFunction**: Handles customer creation and lookup
- **DocumentUploadFunction**: Processes file uploads
- **DocumentProcessingFunction**: Handles document text extraction

#### DynamoDB Tables
- **CustomersTable**: Stores customer records with tenant isolation
  - Partition Key: `uuid` (Customer UUID)
  - GSI: `tenant-id-index` for tenant-based queries
  - GSI: `email-index` for email-based lookups

- **DocumentsTable**: Stores document metadata
  - Partition Key: `id` (Document ID)
  - Sort Key: `customerUuid` (Customer UUID)
  - GSI: `tenant-documents-index` for tenant-based document queries

#### S3 Buckets
- **DocumentsBucket**: Stores uploaded documents
  - Encryption: S3-managed encryption
  - Event notifications: Triggers document processing Lambda
  - CORS: Enabled for frontend uploads

#### API Gateway
- **REST API**: Provides HTTP endpoints for frontend
  - CORS enabled for all origins (development)
  - Rate limiting and throttling
  - Lambda integrations for all endpoints

#### IAM Roles
- **LambdaExecutionRole**: Provides necessary permissions for Lambda functions
  - DynamoDB read/write access
  - S3 object operations
  - Textract service access
  - Bedrock service access

### Environment Variables

The following environment variables are automatically configured:

```bash
# Lambda Function Environment Variables
CUSTOMERS_TABLE_NAME=rag-app-v2-customers-dev
DOCUMENTS_TABLE_NAME=rag-app-v2-documents-dev
DOCUMENTS_BUCKET=rag-app-v2-documents-dev
USER_POOL_ID=us-east-1_XXXXXXXXX
REGION=us-east-1

# Platform Integration Variables
KNOWLEDGE_BASE_ID=rag-app-v2-kb-dev
VECTOR_DB_ENDPOINT=https://xxx.us-east-1.aoss.amazonaws.com
PLATFORM_DOCUMENTS_BUCKET=rag-app-v2-documents-dev
BEDROCK_REGION=us-east-1
```

## Deployment Prerequisites

### Local Development

1. **AWS CLI Configuration**:
   ```bash
   aws configure
   # Provide access key, secret key, region, and output format
   ```

2. **Required Permissions**:
   - Lambda: Create, update, delete functions
   - DynamoDB: Create, update, delete tables
   - S3: Create, update, delete buckets
   - API Gateway: Create, update, delete APIs
   - IAM: Create, update, delete roles and policies
   - CloudFormation: Full access for stack operations

3. **Node.js and Dependencies**:
   ```bash
   node --version  # Should be 18+
   npm install -g aws-cdk
   npm install
   ```

### Production Deployment

Production deployment requires:
- Repository access for code push
- Platform team coordination for parameter values
- Integration with existing Cognito User Pool
- Platform-provided API Gateway ID

## Deployment Steps

### Local Development Deployment

1. **Clone and Setup**:
   ```bash
   git clone <repository-url>
   cd multi-tenant-document-manager
   npm install
   ```

2. **Build Application**:
   ```bash
   npm run build
   ```

3. **Run Unit Tests**:
   ```bash
   npm test
   ```

4. **Deploy Infrastructure**:
   ```bash
   npm run deploy
   ```

5. **Verify Deployment**:
   ```bash
   node test-api.js
   ```

### Production Deployment Process

1. **Code Push**:
   ```bash
   git add .
   git commit -m "Feature: Add new functionality"
   git push origin main
   ```

2. **Pipeline Execution**:
   - External pipeline automatically triggers
   - CodeBuild runs unit tests
   - CDK synthesizes CloudFormation templates
   - Platform team reviews and approves deployment

3. **Integration Testing**:
   - Platform team runs integration tests
   - End-to-end workflow validation
   - Performance and security testing

4. **Production Release**:
   - Platform team manages production deployment
   - Blue-green deployment strategy
   - Monitoring and rollback capabilities

## Configuration Management

### CDK Parameters

The stack uses CDK parameters for platform integration:

```typescript
// API Gateway ID (provided by platform team)
const apiGatewayId = new CfnParameter(this, 'ApiGatewayId', {
  type: 'String',
  description: 'API Gateway ID provided by platform team',
  default: 'local-dev' // For local development
});

// Cognito User Pool ID
const userPoolId = new CfnParameter(this, 'UserPoolId', {
  type: 'String',
  description: 'Cognito User Pool ID (rag-app-v2-users-dev)',
  default: 'us-east-1_XXXXXXXXX'
});
```

### Environment-Specific Configuration

#### Development Environment
- Simplified authentication (header-based tenant ID)
- Debug logging enabled
- CORS allows all origins
- Relaxed security policies

#### Production Environment
- Full Cognito authentication
- Production logging levels
- Restricted CORS origins
- Enhanced security policies

## Monitoring and Verification

### Deployment Verification

After deployment, verify the following:

1. **API Gateway Endpoints**:
   ```bash
   curl -X POST https://api-id.execute-api.region.amazonaws.com/prod/customers \
     -H "Content-Type: application/json" \
     -H "X-Tenant-Id: test-tenant" \
     -d '{"customerEmail": "test@example.com"}'
   ```

2. **Lambda Functions**:
   - Check CloudWatch logs for successful invocations
   - Verify environment variables are set correctly
   - Test error handling scenarios

3. **DynamoDB Tables**:
   - Verify table creation and GSI configuration
   - Test read/write operations
   - Check encryption settings

4. **S3 Buckets**:
   - Verify bucket creation and permissions
   - Test file upload and event notifications
   - Check encryption and CORS settings

### Health Checks

Implement the following health checks:

```bash
# API Health Check
curl -X GET https://api-id.execute-api.region.amazonaws.com/prod/health

# Database Connectivity
aws dynamodb describe-table --table-name rag-app-v2-customers-dev

# S3 Bucket Access
aws s3 ls s3://rag-app-v2-documents-dev/
```

## Troubleshooting

### Common Deployment Issues

1. **Permission Errors**:
   ```
   Error: User is not authorized to perform: lambda:CreateFunction
   ```
   **Solution**: Ensure AWS credentials have necessary permissions

2. **Resource Conflicts**:
   ```
   Error: Resource already exists
   ```
   **Solution**: Check for existing resources or use different stack name

3. **Timeout Issues**:
   ```
   Error: Resource creation timed out
   ```
   **Solution**: Check CloudFormation events for specific resource issues

### Debugging Steps

1. **Check CloudFormation Stack**:
   ```bash
   aws cloudformation describe-stacks --stack-name MultiTenantDocumentManagerStack
   ```

2. **Review CloudWatch Logs**:
   ```bash
   aws logs describe-log-groups --log-group-name-prefix /aws/lambda/
   ```

3. **Validate CDK Synthesis**:
   ```bash
   npm run synth
   ```

### Rollback Procedures

#### Local Development
```bash
npm run destroy
```

#### Production
- Contact platform team for rollback procedures
- Platform team manages blue-green deployment rollback
- Database migration rollback (if applicable)

## Security Considerations

### Deployment Security

1. **Secrets Management**:
   - No hardcoded secrets in code
   - Use AWS Systems Manager Parameter Store
   - Environment-specific configuration

2. **IAM Permissions**:
   - Least-privilege principle
   - Role-based access control
   - Regular permission audits

3. **Network Security**:
   - VPC endpoints for AWS services
   - Security groups with minimal access
   - Encryption in transit and at rest

### Post-Deployment Security

1. **Access Logging**:
   - Enable CloudTrail for API calls
   - S3 access logging
   - DynamoDB point-in-time recovery

2. **Monitoring**:
   - CloudWatch alarms for security events
   - AWS Config for compliance monitoring
   - Regular security assessments

## Cost Optimization

### Resource Optimization

1. **Lambda Functions**:
   - Right-size memory allocation
   - Use provisioned concurrency judiciously
   - Monitor cold start metrics

2. **DynamoDB**:
   - Use on-demand billing for variable workloads
   - Optimize GSI design
   - Enable point-in-time recovery selectively

3. **S3 Storage**:
   - Implement lifecycle policies
   - Use appropriate storage classes
   - Monitor storage metrics

### Cost Monitoring

```bash
# Check AWS costs
aws ce get-cost-and-usage --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY --metrics BlendedCost
```

## Maintenance and Updates

### Regular Maintenance Tasks

1. **Dependency Updates**:
   ```bash
   npm audit
   npm update
   ```

2. **Security Patches**:
   - Monitor AWS security bulletins
   - Update Lambda runtimes
   - Review IAM policies

3. **Performance Monitoring**:
   - Review CloudWatch metrics
   - Optimize based on usage patterns
   - Scale resources as needed

### Update Procedures

1. **Code Updates**:
   - Follow standard git workflow
   - Run unit tests before deployment
   - Use feature flags for gradual rollout

2. **Infrastructure Updates**:
   - Test CDK changes in development
   - Review CloudFormation diffs
   - Coordinate with platform team for production

## Support and Escalation

### Development Issues
- Review documentation in `docs/` directory
- Check unit test coverage
- Use local debugging tools

### Infrastructure Issues
- Contact platform team for production issues
- Provide CloudFormation stack details
- Include relevant CloudWatch logs

### Emergency Procedures
- Platform team manages production incidents
- Follow established incident response procedures
- Document lessons learned for future improvements