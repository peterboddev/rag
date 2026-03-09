# Infrastructure Parameterization Fix - Bugfix Design

## Overview

The CDK infrastructure code contains multiple hardcoded environment-specific values (stack names, resource names, bucket names, table names) that prevent multi-environment deployments. This fix will parameterize all hardcoded values using CDK context variables, CloudFormation parameters, and environment variables, enabling the same codebase to deploy to dev, staging, and production environments without code modifications. The approach uses a three-tier configuration strategy: CDK context for application-level settings, CloudFormation parameters for platform integration, and environment variables for runtime configuration.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when hardcoded environment-specific values prevent deployment to non-dev environments
- **Property (P)**: The desired behavior - all resource names and identifiers should be derived from configurable parameters
- **Preservation**: Existing functionality, IAM permissions, API routes, and resource configurations that must remain unchanged
- **CDK Context**: Configuration values passed via cdk.json or command-line flags (e.g., `--context environment=staging`)
- **CloudFormation Parameters**: Runtime parameters for platform-provided resource identifiers (UserPoolId, KnowledgeBaseId, etc.)
- **applicationName**: The base name for all resources (default: 'rag-app-v2'), configurable via CDK context
- **environment**: The deployment environment (dev, staging, prod), configurable via CDK context
- **Resource Naming Pattern**: `{applicationName}-{resourceType}-{environment}` format used consistently across all resources

## Bug Details

### Fault Condition

The bug manifests when attempting to deploy the CDK stack to any environment other than 'dev', or when the platform team uses different naming conventions. The infrastructure code contains hardcoded values in three locations: stack instantiation (app.ts), resource creation (multi-tenant-document-manager-stack.ts), and Lambda environment variables. These hardcoded values include stack names, DynamoDB table names with '-dev' suffix, S3 bucket names with '-dev' suffix, IAM policy ARNs with hardcoded bucket names, and Lambda environment variables referencing platform buckets.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type DeploymentRequest
  OUTPUT: boolean
  
  RETURN (input.targetEnvironment != 'dev' OR input.applicationName != 'rag-app-v2')
         AND (stackUsesHardcodedName('RAGInfrastructureStack') 
              OR resourcesUseHardcodedSuffix('-dev')
              OR iamPoliciesUseHardcodedARNs()
              OR lambdaEnvVarsUseHardcodedBuckets())
END FUNCTION
```

### Examples

- **Example 1**: Deploying to staging environment with `cdk deploy --context environment=staging` fails because DynamoDB tables are created with names 'rag-app-v2-customers-dev' and 'rag-app-v2-documents-dev' instead of 'rag-app-v2-customers-staging' and 'rag-app-v2-documents-staging'

- **Example 2**: Platform team provides staging bucket 'rag-app-v2-documents-staging' but Lambda functions reference hardcoded 'rag-app-v2-documents-dev' in PLATFORM_DOCUMENTS_BUCKET environment variable, causing S3 access failures

- **Example 3**: Deploying with different application name `cdk deploy --context applicationName=medical-rag` creates stack named 'RAGInfrastructureStack' instead of 'medical-rag-stack-dev', violating naming conventions

- **Edge Case**: Deploying to production with `cdk deploy --context environment=prod` uses DESTROY removal policy on DynamoDB tables and S3 buckets, which should be RETAIN in production

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All Lambda functions must continue to use Node.js 20.x runtime
- DynamoDB tables must continue to include all existing GSI indexes (tenant-id-index, email-index, tenant-documents-index, customer-documents-index, claim-documents-index)
- IAM roles must continue to grant all necessary permissions for Bedrock, Textract, S3, DynamoDB, OpenSearch, and SQS
- API Gateway routes must continue to create all existing endpoints with correct Lambda integrations
- S3 event notifications must continue to trigger document processing on object creation in uploads/ prefix
- CloudFormation parameters must continue to accept UserPoolId, KnowledgeBaseId, VectorDbEndpoint, and ProcessingQueueUrl
- Stack outputs must continue to export all resource names and ARNs
- CORS configuration must continue to allow the same origins, methods, and headers
- Lambda timeout and memory configurations must remain unchanged

**Scope:**
All inputs that do NOT involve changing the environment or application name should be completely unaffected by this fix. This includes:
- Lambda function logic and handlers
- DynamoDB table schemas and indexes
- IAM permission scopes and actions
- API Gateway route paths and methods
- S3 bucket encryption and CORS settings

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Hardcoded Stack Name**: The app.ts file instantiates the stack with hardcoded name 'RAGInfrastructureStack' instead of deriving it from context variables
   - Stack name should follow pattern: `{applicationName}-stack-{environment}`
   - Stack tags use hardcoded 'Environment: dev' instead of context value

2. **Hardcoded Resource Names**: The multi-tenant-document-manager-stack.ts creates resources with hardcoded '-dev' suffix
   - DynamoDB tables: 'rag-app-v2-customers-dev', 'rag-app-v2-documents-dev'
   - S3 bucket: 'rag-app-v2-documents-dev'
   - Should use pattern: `{applicationName}-{resourceType}-{environment}`

3. **Hardcoded Lambda Environment Variables**: Lambda functions reference hardcoded platform bucket names
   - PLATFORM_DOCUMENTS_BUCKET: 'rag-app-v2-documents-dev'
   - SOURCE_BUCKET: 'medical-claims-synthetic-data-dev'
   - Should accept these as CloudFormation parameters

4. **Hardcoded IAM Policy ARNs**: IAM policies use hardcoded S3 bucket ARNs
   - 'arn:aws:s3:::rag-app-v2-documents-dev/*'
   - 'arn:aws:s3:::medical-claims-synthetic-data-dev/*'
   - Should construct ARNs dynamically from parameters

5. **Missing Environment-Specific Configuration**: No mechanism to change removal policies based on environment
   - Development uses DESTROY for easy cleanup
   - Production should use RETAIN to prevent accidental data loss

## Correctness Properties

Property 1: Fault Condition - Parameterized Resource Naming

_For any_ deployment request where the target environment is not 'dev' OR the application name is not 'rag-app-v2', the fixed CDK stack SHALL derive all resource names (stack name, DynamoDB tables, S3 buckets) from configurable CDK context variables using the pattern `{applicationName}-{resourceType}-{environment}`, and SHALL construct IAM policy ARNs dynamically from CloudFormation parameters, enabling successful deployment to any environment without code modifications.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Existing Functionality

_For any_ deployment that uses default context values (applicationName='rag-app-v2', environment='dev'), the fixed CDK stack SHALL produce exactly the same resource configurations as the original code, preserving all Lambda runtimes (Node.js 20.x), DynamoDB indexes, IAM permissions, API Gateway routes, S3 event notifications, and CloudFormation outputs.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `infrastructure/app.ts`

**Function**: Stack instantiation

**Specific Changes**:
1. **Add Context Variable Retrieval**: Read applicationName and environment from CDK context with defaults
   - `const applicationName = app.node.tryGetContext('applicationName') || 'rag-app-v2'`
   - `const environment = app.node.tryGetContext('environment') || 'dev'`

2. **Parameterize Stack Name**: Construct stack name from context variables
   - Change from: `new MultiTenantDocumentManagerStack(app, 'RAGInfrastructureStack', ...)`
   - Change to: `new MultiTenantDocumentManagerStack(app, `${applicationName}-stack-${environment}`, ...)`

3. **Parameterize Stack Tags**: Use environment context variable in tags
   - Change from: `Environment: 'dev'`
   - Change to: `Environment: environment`

4. **Pass Context to Stack**: Add context variables to stack props
   - Create custom props interface extending StackProps
   - Pass applicationName and environment to stack constructor

**File**: `infrastructure/multi-tenant-document-manager-stack.ts`

**Function**: Constructor and resource creation

**Specific Changes**:
1. **Add Custom Props Interface**: Define interface for context variables
   ```typescript
   export interface MultiTenantDocumentManagerStackProps extends cdk.StackProps {
     applicationName: string;
     environment: string;
   }
   ```

2. **Update Constructor Signature**: Accept custom props
   - Change from: `constructor(scope: Construct, id: string, props?: cdk.StackProps)`
   - Change to: `constructor(scope: Construct, id: string, props: MultiTenantDocumentManagerStackProps)`

3. **Add CloudFormation Parameters for Platform Buckets**: Create parameters for platform-provided bucket names
   ```typescript
   const platformDocumentsBucketParam = new cdk.CfnParameter(this, 'PlatformDocumentsBucket', {
     type: 'String',
     description: 'Platform-provided documents bucket name',
     default: `${props.applicationName}-documents-${props.environment}`
   });
   
   const sourceBucketParam = new cdk.CfnParameter(this, 'SourceBucket', {
     type: 'String',
     description: 'Source bucket for medical claims data',
     default: `medical-claims-synthetic-data-${props.environment}`
   });
   ```

4. **Parameterize DynamoDB Table Names**: Use context variables in table names
   - Change from: `tableName: 'rag-app-v2-customers-dev'`
   - Change to: `tableName: `${props.applicationName}-customers-${props.environment}``
   - Apply to both customersTable and documentsTable

5. **Parameterize S3 Bucket Name**: Use context variables in bucket name
   - Change from: `bucketName: 'rag-app-v2-documents-dev'`
   - Change to: `bucketName: `${props.applicationName}-documents-${props.environment}``

6. **Parameterize IAM Policy ARNs**: Construct ARNs dynamically from parameters
   - Change from: `'arn:aws:s3:::rag-app-v2-documents-dev/*'`
   - Change to: `arn:aws:s3:::${platformDocumentsBucketParam.valueAsString}/*`
   - Change from: `'arn:aws:s3:::medical-claims-synthetic-data-dev'`
   - Change to: `arn:aws:s3:::${sourceBucketParam.valueAsString}`

7. **Parameterize Lambda Environment Variables**: Use parameter values instead of hardcoded strings
   - Change PLATFORM_DOCUMENTS_BUCKET from: `'rag-app-v2-documents-dev'`
   - Change to: `platformDocumentsBucketParam.valueAsString`
   - Change SOURCE_BUCKET from: `'medical-claims-synthetic-data-dev'`
   - Change to: `sourceBucketParam.valueAsString`

8. **Add Environment-Specific Removal Policies**: Use conditional logic for removal policies
   ```typescript
   const removalPolicy = props.environment === 'prod' 
     ? cdk.RemovalPolicy.RETAIN 
     : cdk.RemovalPolicy.DESTROY;
   ```
   - Apply to DynamoDB tables and S3 bucket

**File**: `cdk.json`

**Section**: Context configuration

**Specific Changes**:
1. **Add Default Context Values**: Define default values for applicationName and environment
   ```json
   "context": {
     "applicationName": "rag-app-v2",
     "environment": "dev",
     // ... existing context values
   }
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code by attempting multi-environment deployments, then verify the fix works correctly across all environments and preserves existing dev environment behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Attempt to deploy the unfixed CDK stack to staging environment and with different application name. Run CDK synth to observe the generated CloudFormation template. Verify that resource names contain hardcoded '-dev' suffix and cannot adapt to different environments.

**Test Cases**:
1. **Staging Deployment Test**: Run `cdk synth --context environment=staging` on unfixed code (will show '-dev' suffixed resources)
2. **Custom Application Name Test**: Run `cdk synth --context applicationName=medical-rag` on unfixed code (will show 'rag-app-v2' in resource names)
3. **Production Deployment Test**: Run `cdk synth --context environment=prod` on unfixed code (will show DESTROY removal policy)
4. **CloudFormation Template Inspection**: Examine synthesized template for hardcoded values in resource names and IAM policies

**Expected Counterexamples**:
- DynamoDB table names contain 'rag-app-v2-customers-dev' regardless of context
- S3 bucket names contain 'rag-app-v2-documents-dev' regardless of context
- IAM policy ARNs reference 'arn:aws:s3:::rag-app-v2-documents-dev/*' regardless of context
- Stack name is 'RAGInfrastructureStack' regardless of context
- Possible causes: missing context variable retrieval, hardcoded string literals, no conditional logic for environment-specific settings

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (non-dev environments or different application names), the fixed stack produces the expected parameterized behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := cdkSynth_fixed(input.environment, input.applicationName)
  ASSERT resourceNamesFollowPattern(result, input.applicationName, input.environment)
  ASSERT iamPoliciesUseDynamicARNs(result)
  ASSERT lambdaEnvVarsUseParameters(result)
  ASSERT removalPolicyMatchesEnvironment(result, input.environment)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (default dev environment with default application name), the fixed stack produces the same result as the original stack.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT cdkSynth_original(input) = cdkSynth_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Synthesize CloudFormation template with default context values on UNFIXED code, capture resource configurations, then synthesize with fixed code and verify all resources match exactly.

**Test Cases**:
1. **Default Dev Environment Preservation**: Verify `cdk synth` (no context) produces identical resources before and after fix
2. **Lambda Runtime Preservation**: Verify all Lambda functions continue to use nodejs20.x runtime
3. **DynamoDB Index Preservation**: Verify all GSI indexes are created with correct configurations
4. **IAM Permission Preservation**: Verify IAM roles grant same permissions to same services
5. **API Gateway Route Preservation**: Verify all API routes are created with correct paths and integrations
6. **CloudFormation Output Preservation**: Verify all stack outputs are exported with correct values

### Unit Tests

- Test context variable retrieval with defaults (applicationName, environment)
- Test resource name construction using pattern `{applicationName}-{resourceType}-{environment}`
- Test IAM policy ARN construction from parameters
- Test removal policy selection based on environment (DESTROY for dev/staging, RETAIN for prod)
- Test CloudFormation parameter creation for platform buckets
- Test Lambda environment variable assignment from parameters

### Property-Based Tests

- Generate random environment names (dev, staging, prod, test) and verify resource names adapt correctly
- Generate random application names and verify all resources use the provided name
- Generate random combinations of context values and verify consistent naming patterns
- Test that all IAM policy ARNs are constructed dynamically without hardcoded values
- Test that removal policies are correctly set based on environment across many scenarios

### Integration Tests

- Deploy stack to isolated AWS account with staging context and verify all resources are created with '-staging' suffix
- Deploy stack with custom application name and verify CloudFormation stack name follows pattern
- Verify Lambda functions can access platform buckets using parameterized environment variables
- Verify IAM policies grant access to correct S3 buckets based on parameters
- Test that production deployment uses RETAIN removal policy on critical resources
