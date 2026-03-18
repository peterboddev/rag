/**
 * Preservation Property Tests - Infrastructure Parameterization
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**
 *
 * Property 2: Preservation - Existing Functionality
 *
 * These tests capture the baseline behavior of the UNFIXED code and MUST PASS
 * on the current code. They verify that all existing infrastructure patterns
 * are preserved after the parameterization fix is applied.
 *
 * Approach: Source analysis (same as exploration test) to avoid slow esbuild bundling.
 */
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// Read CDK source files once for all tests
const stackSource = fs.readFileSync(
  path.join(__dirname, '..', 'infrastructure', 'rag-application-stack.ts'),
  'utf-8',
);
const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'infrastructure', 'app.ts'),
  'utf-8',
);

describe('Preservation: Infrastructure Parameterization', () => {
  // ============================================================
  // 3.2 - All Lambda functions use Node.js 20.x runtime
  // ============================================================

  /**
   * Property 2a: All Lambda functions MUST use NODEJS_20_X runtime.
   *
   * The createLambdaFunction helper sets runtime: lambda.Runtime.NODEJS_20_X.
   * Every Lambda must go through this helper or explicitly set NODEJS_20_X.
   *
   * **Validates: Requirements 3.2**
   */
  it('should use NODEJS_20_X runtime for all Lambda functions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'CustomerManagerFunction',
          'DocumentUploadFunction',
          'DocumentProcessingFunction',
          'DocumentSummaryFunction',
          'DocumentRetryFunction',
          'DocumentDeleteFunction',
          'DocumentSummarySelectiveFunction',
          'ChunkingConfigGetFunction',
          'ChunkingConfigUpdateFunction',
          'ChunkingMethodsListFunction',
          'ChunkingCleanupTriggerFunction',
          'ChunkingCleanupStatusFunction',
          'ChunkVisualizationFunction',
          'EmbeddingsGenerateFunction',
          'PatientListFunction',
          'PatientDetailFunction',
          'ClaimLoaderFunction',
          'ClaimStatusFunction',
          'DocumentRetrievalFunction',
          'ClaimSummaryOrchestratorFunction',
        ),
        (functionName: string) => {
          // The createLambdaFunction helper must set NODEJS_20_X
          expect(stackSource).toContain('runtime: lambda.Runtime.NODEJS_20_X');

          // The helper must exist and be used for this function
          expect(stackSource).toContain(`'${functionName}'`);

          // All functions are created via createLambdaFunction
          const fnPattern = new RegExp(
            `createLambdaFunction\\(\\s*'${functionName}'`,
          );
          expect(stackSource).toMatch(fnPattern);
        },
      ),
      { numRuns: 20 },
    );
  });


  // ============================================================
  // 3.3 - DynamoDB tables include all GSI indexes
  // ============================================================

  /**
   * Property 2b: DynamoDB GSI indexes MUST all be present.
   *
   * The stack creates GSIs via AwsCustomResource for platform tables
   * and via addGlobalSecondaryIndex for application tables.
   *
   * **Validates: Requirements 3.3**
   */
  it('should include all DynamoDB GSI indexes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'customer-documents-index',
          'tenant-documents-index',
          'claimId-index',
        ),
        (indexName: string) => {
          expect(stackSource).toContain(indexName);
        },
      ),
      { numRuns: 3 },
    );
  });

  /**
   * Property 2b2: GSI creation must be sequential (DynamoDB limitation).
   *
   * **Validates: Requirements 3.3**
   */
  it('should enforce sequential GSI creation with dependency', () => {
    expect(stackSource).toContain('gsiTenant.node.addDependency(gsiCustomer)');
  });

  // ============================================================
  // 3.4 - IAM roles grant permissions to required services
  // ============================================================

  /**
   * Property 2c: IAM policies MUST grant permissions to all required services.
   *
   * **Validates: Requirements 3.4**
   */
  it('should grant IAM permissions to all required AWS services', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'textract:DetectDocumentText',
          'textract:AnalyzeDocument',
          'textract:GetDocumentTextDetection',
          'textract:StartDocumentTextDetection',
          'bedrock:InvokeModel',
          'bedrock:InvokeAgent',
        ),
        (action: string) => {
          expect(stackSource).toContain(action);
        },
      ),
      { numRuns: 6 },
    );
  });

  /**
   * Property 2c2: Textract policy is applied to processing functions.
   *
   * **Validates: Requirements 3.4**
   */
  it('should apply Textract policy to document processing and retry functions', () => {
    expect(stackSource).toContain(
      'documentProcessingFunction.addToRolePolicy(textractPolicy)',
    );
    expect(stackSource).toContain(
      'documentRetryFunction.addToRolePolicy(textractPolicy)',
    );
  });

  // ============================================================
  // 3.5 - API Gateway routes create all existing endpoints
  // ============================================================

  /**
   * Property 2d: All API Gateway resource paths MUST exist.
   *
   * **Validates: Requirements 3.5**
   */
  it('should create all API Gateway resource paths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { resource: 'customers', parent: 'api.root' },
          { resource: 'documents', parent: 'api.root' },
          { resource: 'chunking-methods', parent: 'api.root' },
          { resource: 'patients', parent: 'api.root' },
          { resource: 'claims', parent: 'api.root' },
          { resource: '{customerUUID}', parent: 'customersResource' },
          { resource: 'chunking-config', parent: 'customerResource' },
          { resource: 'cleanup', parent: 'chunkingConfigResource' },
          { resource: '{jobId}', parent: 'chunkingCleanupResource' },
          { resource: '{documentId}', parent: 'documentsResource' },
          { resource: 'process', parent: 'documentsResource' },
          { resource: 'summary', parent: 'documentsResource' },
          { resource: 'selective', parent: 'summaryResource' },
          { resource: 'retry', parent: 'documentsResource' },
          { resource: 'delete', parent: 'documentsResource' },
          { resource: 'chunks', parent: 'documentsResource' },
          { resource: 'visualization', parent: 'chunksResource' },
          { resource: 'embeddings', parent: 'documentsResource' },
          { resource: 'generate', parent: 'embeddingsResource' },
          { resource: '{patientId}', parent: 'patientsResource' },
          { resource: 'load', parent: 'claimsResource' },
          { resource: '{claimId}', parent: 'claimsResource' },
          { resource: 'status', parent: 'claimResource' },
          { resource: 'summary', parent: 'claimResource' },
          { resource: 'evaluations', parent: 'claimResource' },
        ),
        (route: { resource: string; parent: string }) => {
          expect(stackSource).toContain(
            `${route.parent}.addResource('${route.resource}')`,
          );
        },
      ),
      { numRuns: 25 },
    );
  });

  /**
   * Property 2d2: API Gateway methods use correct HTTP verbs and Lambda integrations.
   *
   * **Validates: Requirements 3.5**
   */
  it('should create API methods with correct HTTP verbs and Lambda integrations', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { method: 'POST', resource: 'customersResource', fn: 'customerManagerFunction' },
          { method: 'POST', resource: 'documentsResource', fn: 'documentUploadFunction' },
          { method: 'POST', resource: 'processResource', fn: 'documentProcessingFunction' },
          { method: 'POST', resource: 'summaryResource', fn: 'documentSummaryFunction' },
          { method: 'POST', resource: 'summarySelectiveResource', fn: 'documentSummarySelectiveFunction' },
          { method: 'POST', resource: 'retryResource', fn: 'documentRetryFunction' },
          { method: 'DELETE', resource: 'deleteResource', fn: 'documentDeleteFunction' },
          { method: 'GET', resource: 'chunkingConfigResource', fn: 'chunkingConfigGetFunction' },
          { method: 'PUT', resource: 'chunkingConfigResource', fn: 'chunkingConfigUpdateFunction' },
          { method: 'POST', resource: 'chunkingCleanupResource', fn: 'chunkingCleanupTriggerFunction' },
          { method: 'GET', resource: 'cleanupStatusResource', fn: 'chunkingCleanupStatusFunction' },
          { method: 'GET', resource: 'chunkingMethodsResource', fn: 'chunkingMethodsListFunction' },
          { method: 'POST', resource: 'visualizationResource', fn: 'chunkVisualizationFunction' },
          { method: 'POST', resource: 'generateResource', fn: 'embeddingsGenerateFunction' },
          { method: 'GET', resource: 'patientsResource', fn: 'patientListFunction' },
          { method: 'GET', resource: 'patientResource', fn: 'patientDetailFunction' },
          { method: 'POST', resource: 'claimLoadResource', fn: 'claimLoaderFunction' },
          { method: 'GET', resource: 'claimStatusResource', fn: 'claimStatusFunction' },
          { method: 'GET', resource: 'documentResource', fn: 'documentRetrievalFunction' },
          { method: 'POST', resource: 'claimSummaryResource', fn: 'claimSummaryOrchestratorFunction' },
          { method: 'GET', resource: 'claimEvaluationsResource', fn: 'claimSummaryOrchestratorFunction' },
        ),
        (route: { method: string; resource: string; fn: string }) => {
          const pattern = new RegExp(
            `${route.resource}\\.addMethod\\(\\s*'${route.method}'\\s*,\\s*new apigateway\\.LambdaIntegration\\(${route.fn}`,
          );
          expect(stackSource).toMatch(pattern);
        },
      ),
      { numRuns: 21 },
    );
  });


  // ============================================================
  // 3.6 - S3 event notifications trigger on uploads/ prefix
  // ============================================================

  /**
   * Property 2e: S3 event notification MUST trigger on uploads/ prefix.
   *
   * **Validates: Requirements 3.6**
   */
  it('should configure S3 event notification on uploads/ prefix', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(stackSource).toContain('s3.EventType.OBJECT_CREATED');
        expect(stackSource).toContain("new s3n.LambdaDestination(documentProcessingFunction)");
        expect(stackSource).toContain("prefix: 'uploads/'");
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // 3.7 - CloudFormation parameters accept platform values
  // ============================================================

  /**
   * Property 2f: CfnParameters MUST exist for platform integration.
   *
   * **Validates: Requirements 3.7**
   */
  it('should define CloudFormation parameters for platform integration', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('UserPoolId', 'KnowledgeBaseId', 'VectorDbEndpoint'),
        (paramName: string) => {
          const pattern = new RegExp(
            `new cdk\\.CfnParameter\\(this,\\s*'${paramName}'`,
          );
          expect(stackSource).toMatch(pattern);
        },
      ),
      { numRuns: 3 },
    );
  });

  // ============================================================
  // 3.8 - Stack outputs export all resource names and ARNs
  // ============================================================

  /**
   * Property 2g: CfnOutputs MUST export all resource names and ARNs.
   *
   * **Validates: Requirements 3.8**
   */
  it('should export all required CfnOutputs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'ApiGatewayUrl',
          'DocumentsBucketName',
          'ProcessingQueueUrl',
          'ProcessingDLQUrl',
          'CustomerManagerFunctionArn',
          'DocumentUploadFunctionArn',
          'DocumentProcessingFunctionArn',
          'PatientListFunctionArn',
          'PatientDetailFunctionArn',
          'ClaimLoaderFunctionArn',
          'ClaimStatusFunctionArn',
          'SummaryCacheTableName',
          'SummaryContentBucketName',
          'EvaluationResultsTableName',
          'ClaimSummaryOrchestratorFunctionName',
          'ClaimSummaryOrchestratorFunctionArn',
        ),
        (outputName: string) => {
          const pattern = new RegExp(
            `new cdk\\.CfnOutput\\(this,\\s*'${outputName}'`,
          );
          expect(stackSource).toMatch(pattern);
        },
      ),
      { numRuns: 16 },
    );
  });

  // ============================================================
  // 3.9 - CORS configuration allows same origins, methods, headers
  // ============================================================

  /**
   * Property 2h: CORS configuration MUST allow correct origins, methods, headers.
   *
   * **Validates: Requirements 3.9**
   */
  it('should configure CORS with correct headers, methods, and origins', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // API Gateway CORS response parameters
        expect(stackSource).toContain(
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'",
        );
        expect(stackSource).toContain("'GET,POST,PUT,DELETE,OPTIONS'");
        expect(stackSource).toContain(
          "'method.response.header.Access-Control-Allow-Origin': \"'*'\"",
        );

        // S3 bucket CORS
        expect(stackSource).toContain("allowedOrigins: ['*']");
        expect(stackSource).toContain("allowedHeaders: ['*']");
        expect(stackSource).toContain('s3.HttpMethods.GET');
        expect(stackSource).toContain('s3.HttpMethods.POST');
        expect(stackSource).toContain('s3.HttpMethods.PUT');
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // 3.10 - Removal policy logic (prod=RETAIN, else=DESTROY)
  // ============================================================

  /**
   * Property 2i: Removal policy MUST use conditional logic based on environment.
   *
   * **Validates: Requirements 3.10**
   */
  it('should use environment-conditional removal policies', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // The pattern: environment === 'prod' ? RETAIN : DESTROY
        expect(stackSource).toContain("environment === 'prod'");
        expect(stackSource).toContain('cdk.RemovalPolicy.RETAIN');
        expect(stackSource).toContain('cdk.RemovalPolicy.DESTROY');

        // autoDeleteObjects should be conditional too
        expect(stackSource).toContain("autoDeleteObjects: environment !== 'prod'");
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // 3.1 - Default environment fallback to 'dev'
  // ============================================================

  /**
   * Property 2j: Default environment MUST fall back to 'dev'.
   *
   * **Validates: Requirements 3.1**
   */
  it('should default environment to dev when no context is provided', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // Stack source should have environment fallback
        expect(stackSource).toContain(
          "this.node.tryGetContext('environment') || 'dev'",
        );

        // app.ts should also have environment fallback
        expect(appSource).toContain(
          "app.node.tryGetContext('environment') || 'dev'",
        );
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // Additional preservation: SQS dead letter queue configuration
  // ============================================================

  /**
   * Property 2k: SQS queues MUST have DLQ configuration.
   *
   * **Validates: Requirements 3.4**
   */
  it('should configure SQS processing queue with dead letter queue', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        // DLQ exists
        expect(stackSource).toContain("'ProcessingDLQ'");
        expect(stackSource).toContain("'ProcessingQueue'");

        // DLQ configuration
        expect(stackSource).toContain('maxReceiveCount: 3');
        expect(stackSource).toContain('sqs.QueueEncryption.SQS_MANAGED');
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // Additional preservation: Cognito authorizer on API Gateway
  // ============================================================

  /**
   * Property 2l: API Gateway MUST use Cognito authorizer.
   *
   * **Validates: Requirements 3.5**
   */
  it('should configure Cognito authorizer on API Gateway', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(stackSource).toContain("type: 'COGNITO_USER_POOLS'");
        expect(stackSource).toContain(
          'authorizationType: apigateway.AuthorizationType.COGNITO',
        );
        expect(stackSource).toContain(
          "identitySource: 'method.request.header.Authorization'",
        );
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // Additional preservation: Stack tags and naming in app.ts
  // ============================================================

  /**
   * Property 2m: app.ts MUST set proper stack tags.
   *
   * **Validates: Requirements 3.1**
   */
  it('should set Project and Component tags on the stack', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(appSource).toContain("Project: 'RAG-Platform'");
        expect(appSource).toContain("Component: 'Application'");
        expect(appSource).toContain('Environment: environment');
      }),
      { numRuns: 1 },
    );
  });

  // ============================================================
  // Additional preservation: CloudWatch alarms
  // ============================================================

  /**
   * Property 2n: CloudWatch alarms MUST exist for processing monitoring.
   *
   * **Validates: Requirements 3.4**
   */
  it('should create CloudWatch alarms for processing monitoring', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'ProcessingQueueDepthAlarm',
          'ProcessingDLQAlarm',
          'DocumentProcessingErrorAlarm',
        ),
        (alarmName: string) => {
          expect(stackSource).toContain(`'${alarmName}'`);
        },
      ),
      { numRuns: 3 },
    );
  });
});
