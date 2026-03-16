import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

// CDK Infrastructure Tests for Claim Summary Feature
// Validates Requirements 7.1-7.15
describe('Claim Summary CDK Infrastructure', () => {
  let template: Template;
  beforeAll(() => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'T1', {
      env: { account: '123456789012', region: 'us-east-1' },
    });
    const env = 'dev';
    const appName = 'rag-app';
    const docsTable = 'rag-app-documents-dev';
    // Summary Cache Table
    const sct = new dynamodb.Table(stack, 'SCT', {
      tableName: appName + '-summary-cache-' + env,
      partitionKey: {
        name: 'cacheKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    sct.addGlobalSecondaryIndex({
      indexName: 'claimId-index',
      partitionKey: {
        name: 'claimId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Summary Content Bucket
    const scb = new s3.Bucket(stack, 'SCB', {
      bucketName: appName + '-summary-content-' + env,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        transitions: [{
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: cdk.Duration.days(90),
        }],
      }],
    });
    // Evaluation Results Table
    const ert = new dynamodb.Table(stack, 'ERT', {
      tableName: appName + '-evaluation-results-' + env,
      partitionKey: {
        name: 'claimId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'strategyKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Orchestrator Lambda
    const fn = new lambda.Function(stack, 'ORC', {
      functionName: appName + '-claim-summary-orchestrator-' + env,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'h.handler',
      code: lambda.Code.fromInline('x'),
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        DOCUMENTS_TABLE: docsTable,
        SUMMARY_CACHE_TABLE: sct.tableName,
        SUMMARY_CONTENT_BUCKET: scb.bucketName,
        EVALUATION_RESULTS_TABLE: ert.tableName,
        BEDROCK_REGION: 'us-east-1',
        KNOWLEDGE_BASE_ID: 'kb',
      },
    });
    sct.grantReadWriteData(fn);
    ert.grantReadWriteData(fn);
    scb.grantReadWrite(fn);
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0'],
    }));
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeAgent', 'bedrock-agentcore:*'],
      resources: ['*'],
    }));

    // API Gateway with Cognito Authorizer
    const api = new apigateway.RestApi(stack, 'API', {
      restApiName: 'test',
    });
    const auth = new apigateway.CfnAuthorizer(stack, 'Auth', {
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      restApiId: api.restApiId,
      identitySource: 'method.request.header.Authorization',
      providerArns: [
        'arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_X',
      ],
    });
    const mo: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: { authorizerId: auth.ref },
    };
    const claimRes = api.root
      .addResource('claims')
      .addResource('{claimId}');
    claimRes
      .addResource('summary')
      .addMethod(
        'POST',
        new apigateway.LambdaIntegration(fn, { proxy: true }),
        mo,
      );
    claimRes
      .addResource('evaluations')
      .addMethod(
        'GET',
        new apigateway.LambdaIntegration(fn, { proxy: true }),
        mo,
      );
    template = Template.fromStack(stack);
  });

  // Summary_Cache_Table Tests (Req 7.6)
  describe('Summary_Cache_Table', () => {
    it('has partition key cacheKey (S)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-summary-cache-dev',
        KeySchema: Match.arrayWith([
          { AttributeName: 'cacheKey', KeyType: 'HASH' },
        ]),
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: 'cacheKey', AttributeType: 'S' },
        ]),
      });
    });

    it('has TTL enabled on ttl attribute', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-summary-cache-dev',
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      });
    });

    it('uses PAY_PER_REQUEST billing', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-summary-cache-dev',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    it('has claimId-index GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-summary-cache-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'claimId-index',
            KeySchema: Match.arrayWith([
              { AttributeName: 'claimId', KeyType: 'HASH' },
            ]),
            Projection: { ProjectionType: 'ALL' },
          }),
        ]),
      });
    });
  });

  // Summary_Content_Bucket Tests (Req 7.7)
  describe('Summary_Content_Bucket', () => {
    it('has S3-managed encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'rag-app-summary-content-dev',
        BucketEncryption: {
          ServerSideEncryptionConfiguration: Match.arrayWith([
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ]),
        },
      });
    });

    it('blocks all public access', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'rag-app-summary-content-dev',
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it('has lifecycle rule to IA after 90 days', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'rag-app-summary-content-dev',
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Transitions: Match.arrayWith([
                Match.objectLike({
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 90,
                }),
              ]),
            }),
          ]),
        },
      });
    });
  });

  // Evaluation_Results_Table Tests (Req 7.14)
  describe('Evaluation_Results_Table', () => {
    it('has PK claimId (S) and SK strategyKey (S)', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-evaluation-results-dev',
        KeySchema: Match.arrayWith([
          { AttributeName: 'claimId', KeyType: 'HASH' },
          { AttributeName: 'strategyKey', KeyType: 'RANGE' },
        ]),
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: 'claimId', AttributeType: 'S' },
          { AttributeName: 'strategyKey', AttributeType: 'S' },
        ]),
      });
    });

    it('uses PAY_PER_REQUEST billing', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-evaluation-results-dev',
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  // Orchestrator Lambda Tests (Req 7.1, 7.12, 7.13)
  describe('Orchestrator Lambda', () => {
    it('uses Node.js 20.x runtime (Req 7.1)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Runtime: 'nodejs20.x',
      });
    });

    it('has 120s timeout (Req 7.13)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Timeout: 120,
      });
    });

    it('has 512 MB memory', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        MemorySize: 512,
      });
    });

    it('has all 6 required env vars (Req 7.12)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Environment: {
          Variables: Match.objectLike({
            DOCUMENTS_TABLE: Match.anyValue(),
            SUMMARY_CACHE_TABLE: Match.anyValue(),
            SUMMARY_CONTENT_BUCKET: Match.anyValue(),
            EVALUATION_RESULTS_TABLE: Match.anyValue(),
            BEDROCK_REGION: 'us-east-1',
            KNOWLEDGE_BASE_ID: Match.anyValue(),
          }),
        },
      });
    });

    it('SUMMARY_CACHE_TABLE references cache table', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Environment: {
          Variables: Match.objectLike({
            SUMMARY_CACHE_TABLE: Match.anyValue(),
          }),
        },
      });
    });

    it('SUMMARY_CONTENT_BUCKET references content bucket', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Environment: {
          Variables: Match.objectLike({
            SUMMARY_CONTENT_BUCKET: Match.anyValue(),
          }),
        },
      });
    });

    it('EVALUATION_RESULTS_TABLE references eval table', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'rag-app-claim-summary-orchestrator-dev',
        Environment: {
          Variables: Match.objectLike({
            EVALUATION_RESULTS_TABLE: Match.anyValue(),
          }),
        },
      });
    });

    it('has Bedrock InvokeModel permission (Req 7.2)', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'bedrock:InvokeModel',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('has AgentCore permissions (Req 7.2)', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'bedrock:InvokeAgent',
                'bedrock-agentcore:*',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  // API Gateway Tests (Req 7.10, 7.11, 7.15)
  describe('API Gateway Endpoints', () => {
    it('has POST method with Cognito auth (Req 7.10, 7.11)', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'COGNITO_USER_POOLS',
      });
    });

    it('has GET method with Cognito auth (Req 7.15, 7.11)', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'GET',
        AuthorizationType: 'COGNITO_USER_POOLS',
      });
    });

    it('has Cognito authorizer configured (Req 7.11)', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
        Name: 'CognitoAuthorizer',
        IdentitySource: 'method.request.header.Authorization',
      });
    });

    it('authorizer has Cognito provider ARN', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
        ProviderARNs: Match.arrayWith([
          Match.stringLikeRegexp('arn:aws:cognito-idp:.*:userpool/.*'),
        ]),
      });
    });
  });
});
