import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class MultiTenantDocumentManagerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameters for platform integration with fallback for local development
    const userPoolIdParam = new cdk.CfnParameter(this, 'UserPoolId', {
      type: 'String',
      description: 'Cognito User Pool ID (rag-app-v2-users-dev)',
      default: 'us-east-1_XXXXXXXXX' // Placeholder for local dev
    });

    const knowledgeBaseIdParam = new cdk.CfnParameter(this, 'KnowledgeBaseId', {
      type: 'String',
      description: 'Bedrock Knowledge Base ID',
      default: 'rag-app-v2-kb-dev' // From platform team
    });

    const vectorDbEndpointParam = new cdk.CfnParameter(this, 'VectorDbEndpoint', {
      type: 'String',
      description: 'OpenSearch Serverless endpoint',
      default: 'https://87qp4ybm7f43l8x4dibg.us-east-1.aoss.amazonaws.com' // Real endpoint from platform team
    });

    const processingQueueUrlParam = new cdk.CfnParameter(this, 'ProcessingQueueUrl', {
      type: 'String',
      description: 'SQS Queue URL for document processing',
      default: 'https://sqs.us-east-1.amazonaws.com/xxx/rag-app-v2-document-processing-dev' // From platform team
    });

    // DynamoDB Tables
    const customersTable = new dynamodb.Table(this, 'CustomersTable', {
      tableName: 'rag-app-v2-customers-dev',
      partitionKey: { name: 'uuid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environment
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI for tenant-based queries
    customersTable.addGlobalSecondaryIndex({
      indexName: 'tenant-id-index',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'customerId', type: dynamodb.AttributeType.STRING },
    });

    // GSI for email-based lookups
    customersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: 'rag-app-v2-documents-dev',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'customerUuid', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environment
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI for tenant-based document queries
    documentsTable.addGlobalSecondaryIndex({
      indexName: 'tenant-documents-index',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for customer-based document queries
    documentsTable.addGlobalSecondaryIndex({
      indexName: 'customer-documents-index',
      partitionKey: { name: 'customerUuid', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for claim-based document queries (Insurance Claim Portal)
    documentsTable.addGlobalSecondaryIndex({
      indexName: 'claim-documents-index',
      partitionKey: { name: 'claimId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // S3 Bucket for document storage
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: 'rag-app-v2-documents-dev',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev environment
      autoDeleteObjects: true, // For dev environment
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'], // Restrict in production
          allowedHeaders: ['*'],
        },
      ],
    });

    // IAM Role for Lambda functions
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
                'dynamodb:BatchWriteItem',
              ],
              resources: [
                customersTable.tableArn,
                `${customersTable.tableArn}/index/*`,
                documentsTable.tableArn,
                `${documentsTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:GetObjectMetadata',
                's3:PutObjectMetadata',
              ],
              resources: [
                `${documentsBucket.bucketArn}/*`,
                'arn:aws:s3:::rag-app-v2-documents-dev/*', // Platform bucket
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
              ],
              resources: [
                'arn:aws:s3:::medical-claims-synthetic-data-dev',
                'arn:aws:s3:::medical-claims-synthetic-data-dev/*',
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:CopyObject',
              ],
              resources: [
                'arn:aws:s3:::rag-app-v2-documents-dev/*',
              ],
            }),
          ],
        }),
        TextractAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:DetectDocumentText',
                'textract:AnalyzeDocument',
              ],
              resources: ['*'],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                'bedrock:ListKnowledgeBases',
                'bedrock:GetKnowledgeBase',
                'bedrock:DeleteKnowledgeBase',
              ],
              resources: ['*'],
            }),
          ],
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll',
                'aoss:DashboardsAccessAll',
              ],
              resources: ['*'],
            }),
          ],
        }),
        SQSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:SendMessage',
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Lambda Functions
    const customerManagerFunction = new lambda.Function(this, 'CustomerManagerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/customer-manager.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        USER_POOL_ID: userPoolIdParam.valueAsString,
        REGION: this.region,
      },
    });

    const documentUploadFunction = new lambda.Function(this, 'DocumentUploadFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-upload.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        USER_POOL_ID: userPoolIdParam.valueAsString,
        REGION: this.region,
      },
    });

    const documentProcessingFunction = new lambda.Function(this, 'DocumentProcessingFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-processing.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        PLATFORM_DOCUMENTS_BUCKET: 'rag-app-v2-documents-dev', // Platform bucket
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    const documentSummaryFunction = new lambda.Function(this, 'DocumentSummaryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-summary.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    const documentRetryFunction = new lambda.Function(this, 'DocumentRetryFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-retry.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        PLATFORM_DOCUMENTS_BUCKET: 'rag-app-v2-documents-dev', // Platform bucket
        REGION: this.region,
      },
    });

    const documentDeleteFunction = new lambda.Function(this, 'DocumentDeleteFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-delete.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        PLATFORM_DOCUMENTS_BUCKET: 'rag-app-v2-documents-dev', // Platform bucket
        REGION: this.region,
      },
    });

    const documentSummarySelectiveFunction = new lambda.Function(this, 'DocumentSummarySelectiveFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/document-summary-selective.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(3),
      memorySize: 512,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    // Chunking Configuration Lambda Functions
    const chunkingConfigGetFunction = new lambda.Function(this, 'ChunkingConfigGetFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunking-config-get.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: this.region,
      },
    });

    const chunkingConfigUpdateFunction = new lambda.Function(this, 'ChunkingConfigUpdateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunking-config-update.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        PROCESSING_QUEUE_URL: processingQueueUrlParam.valueAsString,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    const chunkingMethodsListFunction = new lambda.Function(this, 'ChunkingMethodsListFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunking-methods-list.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        REGION: this.region,
      },
    });

    const chunkingCleanupTriggerFunction = new lambda.Function(this, 'ChunkingCleanupTriggerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunking-cleanup-trigger.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        PROCESSING_QUEUE_URL: processingQueueUrlParam.valueAsString,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    const chunkingCleanupStatusFunction = new lambda.Function(this, 'ChunkingCleanupStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunking-cleanup-status.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: this.region,
      },
    });

    const chunkVisualizationFunction = new lambda.Function(this, 'ChunkVisualizationFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/chunk-visualization-get.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5), // Increased timeout for large documents
      memorySize: 2048, // Increased from 512 MB to 2048 MB for better performance
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
    });

    const embeddingsGenerateFunction = new lambda.Function(this, 'EmbeddingsGenerateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/embeddings-generate.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(15), // Longer timeout for embedding generation
      memorySize: 1024, // More memory for processing
      environment: {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        REGION: this.region,
      },
    });

    // Insurance Claim Portal Lambda Functions
    const patientListFunction = new lambda.Function(this, 'PatientListFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/patient-list.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        REGION: this.region,
      },
    });

    const patientDetailFunction = new lambda.Function(this, 'PatientDetailFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/patient-detail.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        REGION: this.region,
      },
    });

    const claimLoaderFunction = new lambda.Function(this, 'ClaimLoaderFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/claim-loader.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        PLATFORM_DOCUMENTS_BUCKET: 'rag-app-v2-documents-dev',
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      },
    });

    const claimStatusFunction = new lambda.Function(this, 'ClaimStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/src/lambda/claim-status.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      },
    });

    // API Gateway (for local development - will be replaced by platform API Gateway)
    const api = new apigateway.RestApi(this, 'DocumentManagerApi', {
      restApiName: 'Multi-Tenant Document Manager API',
      description: 'API for multi-tenant document management',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type', 
          'X-Amz-Date', 
          'Authorization', 
          'X-Api-Key', 
          'X-Tenant-Id',
          'Accept',
          'Origin',
          'Referer',
          'User-Agent'
        ],
        allowCredentials: false,
        maxAge: cdk.Duration.days(1),
      },
    });

    // API Gateway Cognito Authorizer (disabled for local development)
    // const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
    //   cognitoUserPools: [
    //     // This will be replaced with actual user pool reference when integrated with platform
    //   ],
    //   authorizerName: 'CognitoAuthorizer',
    // });

    // API Routes (without authorization for local development)
    const customersResource = api.root.addResource('customers');
    customersResource.addMethod('POST', new apigateway.LambdaIntegration(customerManagerFunction));

    // Customer-specific chunking configuration routes
    const customerResource = customersResource.addResource('{customerUUID}');
    const chunkingConfigResource = customerResource.addResource('chunking-config');
    chunkingConfigResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingConfigGetFunction));
    chunkingConfigResource.addMethod('PUT', new apigateway.LambdaIntegration(chunkingConfigUpdateFunction));

    const chunkingCleanupResource = chunkingConfigResource.addResource('cleanup');
    chunkingCleanupResource.addMethod('POST', new apigateway.LambdaIntegration(chunkingCleanupTriggerFunction));

    const cleanupStatusResource = chunkingCleanupResource.addResource('{jobId}');
    cleanupStatusResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingCleanupStatusFunction));

    // Chunking methods list route
    const chunkingMethodsResource = api.root.addResource('chunking-methods');
    chunkingMethodsResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingMethodsListFunction));

    const documentsResource = api.root.addResource('documents');
    documentsResource.addMethod('POST', new apigateway.LambdaIntegration(documentUploadFunction));

    const processResource = documentsResource.addResource('process');
    processResource.addMethod('POST', new apigateway.LambdaIntegration(documentProcessingFunction));

    const summaryResource = documentsResource.addResource('summary');
    summaryResource.addMethod('POST', new apigateway.LambdaIntegration(documentSummaryFunction));

    const summarySelectiveResource = summaryResource.addResource('selective');
    summarySelectiveResource.addMethod('POST', new apigateway.LambdaIntegration(documentSummarySelectiveFunction));

    const retryResource = documentsResource.addResource('retry');
    retryResource.addMethod('POST', new apigateway.LambdaIntegration(documentRetryFunction));

    const deleteResource = documentsResource.addResource('delete');
    deleteResource.addMethod('DELETE', new apigateway.LambdaIntegration(documentDeleteFunction));

    // Chunk visualization endpoint
    const chunksResource = documentsResource.addResource('chunks');
    const visualizationResource = chunksResource.addResource('visualization');
    
    // Add POST method with proper CORS configuration
    visualizationResource.addMethod('POST', new apigateway.LambdaIntegration(chunkVisualizationFunction, {
      proxy: true,
    }));

    // Embeddings generation endpoint
    const embeddingsResource = documentsResource.addResource('embeddings');
    const generateResource = embeddingsResource.addResource('generate');
    
    // Add POST method for manual embedding generation
    generateResource.addMethod('POST', new apigateway.LambdaIntegration(embeddingsGenerateFunction, {
      proxy: true,
    }));

    // Insurance Claim Portal endpoints
    const patientsResource = api.root.addResource('patients');
    patientsResource.addMethod('GET', new apigateway.LambdaIntegration(patientListFunction));

    // GET /patients/{patientId}
    const patientResource = patientsResource.addResource('{patientId}');
    patientResource.addMethod('GET', new apigateway.LambdaIntegration(patientDetailFunction));

    const claimsResource = api.root.addResource('claims');
    
    // POST /claims/load (for backward compatibility, though the design shows /claims/{claimId}/load)
    const claimLoadResource = claimsResource.addResource('load');
    claimLoadResource.addMethod('POST', new apigateway.LambdaIntegration(claimLoaderFunction));

    // GET /claims/{claimId}/status
    const claimResource = claimsResource.addResource('{claimId}');
    const claimStatusResource = claimResource.addResource('status');
    claimStatusResource.addMethod('GET', new apigateway.LambdaIntegration(claimStatusFunction));

    // S3 Event trigger for document processing
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessingFunction),
      { prefix: 'uploads/' }
    );

    // Outputs
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL for local development',
    });

    new cdk.CfnOutput(this, 'CustomersTableName', {
      value: customersTable.tableName,
      description: 'DynamoDB Customers Table Name',
    });

    new cdk.CfnOutput(this, 'DocumentsTableName', {
      value: documentsTable.tableName,
      description: 'DynamoDB Documents Table Name',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 Documents Bucket Name',
    });

    new cdk.CfnOutput(this, 'PatientListFunctionArn', {
      value: patientListFunction.functionArn,
      description: 'Patient List Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'PatientDetailFunctionArn', {
      value: patientDetailFunction.functionArn,
      description: 'Patient Detail Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'ClaimLoaderFunctionArn', {
      value: claimLoaderFunction.functionArn,
      description: 'Claim Loader Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'ClaimStatusFunctionArn', {
      value: claimStatusFunction.functionArn,
      description: 'Claim Status Lambda Function ARN',
    });
  }
}
