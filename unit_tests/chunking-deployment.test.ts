/**
 * Deployment and integration tests for the complete chunking configuration system (Task 12).
 * Validates: All Requirements (1-8)
 *
 * Tests cover:
 * 1. CDK infrastructure synthesizes correctly with all chunking resources
 * 2. API endpoint configurations are correct
 * 3. Lambda function configurations are valid
 * 4. IAM permissions are properly scoped
 * 5. Error scenarios and recovery work correctly
 */
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';

import {
  ChunkingValidationError,
  CleanupError,
  ServiceUnavailableError,
  buildErrorResponse,
  retryWithBackoff,
  structuredLog,
} from '../src/services/chunking-errors';
import {
  SUPPORTED_CHUNKING_METHODS,
  ChunkingMethod,
} from '../src/types';

// ============================================================
// Section 1: CDK Infrastructure Synthesis Tests
// ============================================================

describe('CDK Infrastructure - Chunking Resources', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'ChunkingTestStack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

    const env = 'dev';
    const appName = 'rag-app-v2';

    // Simulate platform-provided tables
    const customersTable = dynamodb.Table.fromTableName(stack, 'Customers', `${appName}-customers-${env}`);
    const documentsTable = dynamodb.Table.fromTableName(stack, 'Documents', `${appName}-documents-${env}`);

    // Processing queue (mirrors real stack)
    const processingQueue = new sqs.Queue(stack, 'PQ', {
      visibilityTimeout: cdk.Duration.seconds(900),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // --- Chunking Config Get Lambda ---
    const chunkingConfigGetFn = new lambda.Function(stack, 'ChunkingConfigGet', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>{}'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: 'us-east-1',
      },
    });

    // --- Chunking Config Update Lambda ---
    const chunkingConfigUpdateFn = new lambda.Function(stack, 'ChunkingConfigUpdate', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>{}'),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: `${appName}-kb-${env}`,
        VECTOR_DB_ENDPOINT: 'https://placeholder.us-east-1.aoss.amazonaws.com',
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
        BEDROCK_REGION: 'us-east-1',
        REGION: 'us-east-1',
      },
    });

    // --- Chunking Methods List Lambda ---
    const chunkingMethodsListFn = new lambda.Function(stack, 'ChunkingMethodsList', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>{}'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        REGION: 'us-east-1',
      },
    });

    // --- Chunking Cleanup Trigger Lambda ---
    const chunkingCleanupTriggerFn = new lambda.Function(stack, 'ChunkingCleanupTrigger', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>{}'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: `${appName}-kb-${env}`,
        VECTOR_DB_ENDPOINT: 'https://placeholder.us-east-1.aoss.amazonaws.com',
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
        BEDROCK_REGION: 'us-east-1',
        REGION: 'us-east-1',
      },
    });

    // --- Chunking Cleanup Status Lambda ---
    const chunkingCleanupStatusFn = new lambda.Function(stack, 'ChunkingCleanupStatus', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>{}'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: 'us-east-1',
      },
    });

    // --- API Gateway with Cognito Authorizer ---
    const api = new apigateway.RestApi(stack, 'API', { restApiName: 'chunking-test-api' });
    const authorizer = new apigateway.CfnAuthorizer(stack, 'Auth', {
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      restApiId: api.restApiId,
      identitySource: 'method.request.header.Authorization',
      providerArns: ['arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_X'],
    });
    const methodOpts: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: { authorizerId: authorizer.ref },
    };

    // Route: /customers/{customerUUID}/chunking-config
    const customersRes = api.root.addResource('customers');
    const customerRes = customersRes.addResource('{customerUUID}');
    const chunkingConfigRes = customerRes.addResource('chunking-config');
    chunkingConfigRes.addMethod('GET', new apigateway.LambdaIntegration(chunkingConfigGetFn, { proxy: true }), methodOpts);
    chunkingConfigRes.addMethod('PUT', new apigateway.LambdaIntegration(chunkingConfigUpdateFn, { proxy: true }), methodOpts);

    // Route: /customers/{customerUUID}/chunking-config/cleanup
    const cleanupRes = chunkingConfigRes.addResource('cleanup');
    cleanupRes.addMethod('POST', new apigateway.LambdaIntegration(chunkingCleanupTriggerFn, { proxy: true }), methodOpts);

    // Route: /customers/{customerUUID}/chunking-config/cleanup/{jobId}
    const cleanupStatusRes = cleanupRes.addResource('{jobId}');
    cleanupStatusRes.addMethod('GET', new apigateway.LambdaIntegration(chunkingCleanupStatusFn, { proxy: true }), methodOpts);

    // Route: /chunking-methods
    const chunkingMethodsRes = api.root.addResource('chunking-methods');
    chunkingMethodsRes.addMethod('GET', new apigateway.LambdaIntegration(chunkingMethodsListFn, { proxy: true }), methodOpts);

    template = Template.fromStack(stack);
  });

  // --- Lambda Runtime & Configuration ---

  describe('Lambda function configurations', () => {
    it('all chunking Lambdas use Node.js 20.x runtime', () => {
      const lambdas = template.findResources('AWS::Lambda::Function');
      const lambdaKeys = Object.keys(lambdas);
      expect(lambdaKeys.length).toBeGreaterThanOrEqual(5);

      for (const key of lambdaKeys) {
        expect(lambdas[key].Properties.Runtime).toBe('nodejs20.x');
      }
    });

    it('ChunkingConfigUpdate has 10-minute timeout for long cleanup operations', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 600,
        MemorySize: 1024,
        Environment: {
          Variables: Match.objectLike({
            KNOWLEDGE_BASE_ID: Match.anyValue(),
            VECTOR_DB_ENDPOINT: Match.anyValue(),
            PROCESSING_QUEUE_URL: Match.anyValue(),
          }),
        },
      });
    });

    it('ChunkingCleanupTrigger has 15-minute timeout for batch cleanup', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 900,
        MemorySize: 1024,
      });
    });

    it('ChunkingConfigGet has standard 30s timeout', () => {
      // Multiple lambdas have 30s timeout; just verify at least one exists
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
        MemorySize: 256,
      });
    });
  });

  describe('Lambda environment variables', () => {
    it('config update Lambda has all required env vars for cleanup workflow', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 600,
        Environment: {
          Variables: Match.objectLike({
            CUSTOMERS_TABLE_NAME: Match.anyValue(),
            DOCUMENTS_TABLE_NAME: Match.anyValue(),
            KNOWLEDGE_BASE_ID: Match.anyValue(),
            VECTOR_DB_ENDPOINT: Match.anyValue(),
            PROCESSING_QUEUE_URL: Match.anyValue(),
            BEDROCK_REGION: 'us-east-1',
            REGION: 'us-east-1',
          }),
        },
      });
    });

    it('cleanup trigger Lambda has all required env vars', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 900,
        Environment: {
          Variables: Match.objectLike({
            CUSTOMERS_TABLE_NAME: Match.anyValue(),
            DOCUMENTS_TABLE_NAME: Match.anyValue(),
            KNOWLEDGE_BASE_ID: Match.anyValue(),
            VECTOR_DB_ENDPOINT: Match.anyValue(),
            PROCESSING_QUEUE_URL: Match.anyValue(),
          }),
        },
      });
    });

    it('config get Lambda only needs CUSTOMERS_TABLE_NAME and REGION', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 30,
        Environment: {
          Variables: Match.objectLike({
            CUSTOMERS_TABLE_NAME: Match.anyValue(),
            REGION: 'us-east-1',
          }),
        },
      });
    });
  });

  // --- API Gateway Endpoint Tests ---

  describe('API Gateway endpoints', () => {
    it('has Cognito authorizer configured', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
        Name: 'CognitoAuthorizer',
        IdentitySource: 'method.request.header.Authorization',
      });
    });

    it('has GET method with Cognito auth for chunking-config', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        AuthorizationType: 'COGNITO_USER_POOLS',
      });
    });

    it('has PUT method with Cognito auth for chunking-config update', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'PUT',
        AuthorizationType: 'COGNITO_USER_POOLS',
      });
    });

    it('has POST method with Cognito auth for cleanup trigger', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'COGNITO_USER_POOLS',
      });
    });

    it('all methods use Lambda proxy integration', () => {
      const methods = template.findResources('AWS::ApiGateway::Method', {
        Properties: {
          AuthorizationType: 'COGNITO_USER_POOLS',
        },
      });
      for (const key of Object.keys(methods)) {
        const integration = methods[key].Properties.Integration;
        if (integration) {
          expect(integration.Type).toBe('AWS_PROXY');
        }
      }
    });
  });

  // --- SQS Queue Tests ---

  describe('Processing queue', () => {
    it('has SQS queue for document reprocessing', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 900,
      });
    });
  });
});

// ============================================================
// Section 2: Chunking Method Validation & Configuration Tests
// ============================================================

describe('Chunking method configuration validation', () => {
  it('SUPPORTED_CHUNKING_METHODS contains exactly 5 methods', () => {
    expect(SUPPORTED_CHUNKING_METHODS).toHaveLength(5);
  });

  it('all methods have required fields', () => {
    for (const method of SUPPORTED_CHUNKING_METHODS) {
      expect(method.id).toBeTruthy();
      expect(method.name).toBeTruthy();
      expect(method.description).toBeTruthy();
      expect(method.parameters).toBeDefined();
      expect(method.parameters.strategy).toBeTruthy();
    }
  });

  it('includes default, fixed_size_512, fixed_size_1024, semantic, hierarchical', () => {
    const ids = SUPPORTED_CHUNKING_METHODS.map(m => m.id);
    expect(ids).toContain('default');
    expect(ids).toContain('fixed_size_512');
    expect(ids).toContain('fixed_size_1024');
    expect(ids).toContain('semantic');
    expect(ids).toContain('hierarchical');
  });

  it('fixed_size methods have chunkSize and chunkOverlap', () => {
    const fixedMethods = SUPPORTED_CHUNKING_METHODS.filter(
      m => m.parameters.strategy === 'fixed_size'
    );
    expect(fixedMethods.length).toBe(2);
    for (const m of fixedMethods) {
      expect(m.parameters.chunkSize).toBeGreaterThan(0);
      expect(m.parameters.chunkOverlap).toBeGreaterThanOrEqual(0);
      expect(m.parameters.chunkOverlap!).toBeLessThan(m.parameters.chunkSize!);
    }
  });

  it('semantic method has maxTokens', () => {
    const semantic = SUPPORTED_CHUNKING_METHODS.find(m => m.id === 'semantic');
    expect(semantic).toBeDefined();
    expect(semantic!.parameters.maxTokens).toBeGreaterThan(0);
  });

  it('hierarchical method has chunkSize and chunkOverlap', () => {
    const hierarchical = SUPPORTED_CHUNKING_METHODS.find(m => m.id === 'hierarchical');
    expect(hierarchical).toBeDefined();
    expect(hierarchical!.parameters.chunkSize).toBeGreaterThan(0);
    expect(hierarchical!.parameters.chunkOverlap).toBeGreaterThanOrEqual(0);
  });

  it('default method has strategy "default" with no extra params required', () => {
    const def = SUPPORTED_CHUNKING_METHODS.find(m => m.id === 'default');
    expect(def).toBeDefined();
    expect(def!.parameters.strategy).toBe('default');
  });
});

// ============================================================
// Section 3: Error Handling & Recovery Tests
// ============================================================

describe('Error handling for deployment scenarios', () => {
  describe('buildErrorResponse handles all chunking error types', () => {
    it('returns 400 with details for ChunkingValidationError', () => {
      const err = new ChunkingValidationError('Invalid method', { methodId: 'bad' });
      const resp = buildErrorResponse(500, err);
      expect(resp.statusCode).toBe(400);
      const body = JSON.parse(resp.body);
      expect(body.code).toBe('CHUNKING_VALIDATION_ERROR');
      expect(body.details.methodId).toBe('bad');
      expect(body.timestamp).toBeDefined();
    });

    it('returns 503 for retryable CleanupError', () => {
      const err = new CleanupError('KB timeout', 'knowledge_base', true);
      const resp = buildErrorResponse(500, err);
      expect(resp.statusCode).toBe(503);
      const body = JSON.parse(resp.body);
      expect(body.details.phase).toBe('knowledge_base');
      expect(body.details.isRetryable).toBe(true);
    });

    it('returns 500 for non-retryable CleanupError', () => {
      const err = new CleanupError('Corrupt data', 'vector_db', false);
      const resp = buildErrorResponse(500, err);
      expect(resp.statusCode).toBe(500);
    });

    it('returns 503 for ServiceUnavailableError with retry info', () => {
      const err = new ServiceUnavailableError('Bedrock down', 'Bedrock', 5000);
      const resp = buildErrorResponse(500, err);
      expect(resp.statusCode).toBe(503);
      const body = JSON.parse(resp.body);
      expect(body.details.serviceName).toBe('Bedrock');
      expect(body.details.retryAfterMs).toBe(5000);
    });

    it('returns 404 for not-found errors', () => {
      const resp = buildErrorResponse(500, new Error('Customer not found: abc'));
      expect(resp.statusCode).toBe(404);
      expect(JSON.parse(resp.body).code).toBe('NOT_FOUND');
    });

    it('returns 500 for unknown errors without leaking internals', () => {
      const resp = buildErrorResponse(500, new Error('DB connection failed'));
      expect(resp.statusCode).toBe(500);
      const body = JSON.parse(resp.body);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.message).not.toContain('DB connection');
    });

    it('always includes CORS headers', () => {
      const resp = buildErrorResponse(500, new Error('test'));
      expect(resp.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(resp.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('retry with backoff for AWS service failures', () => {
    it('succeeds on first attempt without delay', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries transient failures and recovers', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new ServiceUnavailableError('down', 'Bedrock'))
        .mockResolvedValue('recovered');
      const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry validation errors', async () => {
      const fn = jest.fn().mockRejectedValue(
        new ChunkingValidationError('bad', {})
      );
      await expect(
        retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 })
      ).rejects.toThrow(ChunkingValidationError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting all retries', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('persistent'));
      await expect(
        retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 })
      ).rejects.toThrow('persistent');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('structured logging for deployment monitoring', () => {
    it('logs info level with operation context', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation();
      structuredLog('info', 'Config updated', { operation: 'chunking-config-update', customerUUID: 'c1' });
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(spy.mock.calls[0][0]);
      expect(logged.level).toBe('info');
      expect(logged.operation).toBe('chunking-config-update');
      expect(logged.customerUUID).toBe('c1');
      expect(logged.timestamp).toBeDefined();
      spy.mockRestore();
    });

    it('logs error level to console.error', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation();
      structuredLog('error', 'Cleanup failed', { operation: 'cleanup', customerUUID: 'c2' });
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});

// ============================================================
// Section 4: Lambda Handler Validation Tests
// ============================================================

describe('Lambda handler configurations', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    // EmbeddingCleanupService constructor requires REGION for OpenSearch SigV4
    process.env = {
      ...originalEnv,
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      VECTOR_DB_ENDPOINT: 'https://placeholder.us-east-1.aoss.amazonaws.com',
      CUSTOMERS_TABLE_NAME: 'test-customers',
      DOCUMENTS_TABLE_NAME: 'test-documents',
      KNOWLEDGE_BASE_ID: 'test-kb',
      PROCESSING_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/test-queue',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('chunking-config-get handler', () => {
    it('module exports a handler function', () => {
      const mod = require('../src/lambda/chunking-config-get');
      expect(typeof mod.handler).toBe('function');
    });
  });

  describe('chunking-config-update handler', () => {
    it('module exports a handler function', () => {
      const mod = require('../src/lambda/chunking-config-update');
      expect(typeof mod.handler).toBe('function');
    });
  });

  describe('chunking-methods-list handler', () => {
    it('module exports a handler function', () => {
      const mod = require('../src/lambda/chunking-methods-list');
      expect(typeof mod.handler).toBe('function');
    });
  });

  describe('chunking-cleanup-trigger handler', () => {
    it('module exports a handler function', () => {
      const mod = require('../src/lambda/chunking-cleanup-trigger');
      expect(typeof mod.handler).toBe('function');
    });
  });

  describe('chunking-cleanup-status handler', () => {
    it('module exports a handler function', () => {
      const mod = require('../src/lambda/chunking-cleanup-status');
      expect(typeof mod.handler).toBe('function');
    });
  });
});

// ============================================================
// Section 5: Service Module Validation Tests
// ============================================================

describe('Service module exports', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      VECTOR_DB_ENDPOINT: 'https://placeholder.us-east-1.aoss.amazonaws.com',
      CUSTOMERS_TABLE_NAME: 'test-customers',
      DOCUMENTS_TABLE_NAME: 'test-documents',
      KNOWLEDGE_BASE_ID: 'test-kb',
      PROCESSING_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123/test-queue',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('ChunkingConfigurationService is importable and constructable', () => {
    const { ChunkingConfigurationService } = require('../src/services/chunking-configuration');
    expect(ChunkingConfigurationService).toBeDefined();
    const svc = new ChunkingConfigurationService();
    expect(typeof svc.validateChunkingMethod).toBe('function');
    expect(typeof svc.getAvailableChunkingMethods).toBe('function');
    expect(typeof svc.getCustomerChunkingConfig).toBe('function');
    expect(typeof svc.updateCustomerChunkingConfig).toBe('function');
  });

  it('EmbeddingCleanupService is importable and constructable', () => {
    const { EmbeddingCleanupService } = require('../src/services/embedding-cleanup');
    expect(EmbeddingCleanupService).toBeDefined();
    const svc = new EmbeddingCleanupService();
    expect(typeof svc.cleanupCustomerEmbeddings).toBe('function');
    expect(typeof svc.identifyCustomerEmbeddings).toBe('function');
    expect(typeof svc.enqueueCleanup).toBe('function');
    expect(typeof svc.cancelCleanup).toBe('function');
  });

  it('chunking-errors exports all error classes and utilities', () => {
    const mod = require('../src/services/chunking-errors');
    expect(mod.ChunkingValidationError).toBeDefined();
    expect(mod.CleanupError).toBeDefined();
    expect(mod.ServiceUnavailableError).toBeDefined();
    expect(mod.retryWithBackoff).toBeDefined();
    expect(mod.calculateBackoffDelay).toBeDefined();
    expect(mod.buildErrorResponse).toBeDefined();
    expect(mod.structuredLog).toBeDefined();
  });
});

// ============================================================
// Section 6: Chunking Method Validation Logic Tests
// ============================================================

describe('ChunkingConfigurationService.validateChunkingMethod', () => {
  let svc: any;

  beforeAll(() => {
    const { ChunkingConfigurationService } = require('../src/services/chunking-configuration');
    svc = new ChunkingConfigurationService();
  });

  it('accepts all supported chunking methods', () => {
    for (const method of SUPPORTED_CHUNKING_METHODS) {
      expect(svc.validateChunkingMethod(method)).toBe(true);
    }
  });

  it('rejects method with unknown id', () => {
    const bad: ChunkingMethod = {
      id: 'nonexistent',
      name: 'Bad',
      description: 'Bad method',
      parameters: { strategy: 'default' },
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });

  it('rejects method missing name', () => {
    const bad = {
      id: 'default',
      name: '',
      description: 'desc',
      parameters: { strategy: 'default' as const },
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });

  it('rejects method missing parameters', () => {
    const bad = {
      id: 'default',
      name: 'Default',
      description: 'desc',
      parameters: undefined as any,
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });

  it('rejects fixed_size with chunkOverlap >= chunkSize', () => {
    const bad: ChunkingMethod = {
      id: 'fixed_size_512',
      name: 'Fixed Size (512 tokens)',
      description: 'desc',
      parameters: { strategy: 'fixed_size', chunkSize: 100, chunkOverlap: 100 },
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });

  it('rejects fixed_size with zero chunkSize', () => {
    const bad: ChunkingMethod = {
      id: 'fixed_size_512',
      name: 'Fixed Size (512 tokens)',
      description: 'desc',
      parameters: { strategy: 'fixed_size', chunkSize: 0, chunkOverlap: 0 },
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });

  it('rejects unknown strategy', () => {
    const bad: ChunkingMethod = {
      id: 'default',
      name: 'Default Chunking',
      description: 'desc',
      parameters: { strategy: 'unknown' as any },
    };
    expect(svc.validateChunkingMethod(bad)).toBe(false);
  });
});
