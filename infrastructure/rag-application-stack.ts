import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface RAGApplicationStackProps extends cdk.StackProps {
  applicationName?: string;
}

export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: RAGApplicationStackProps) {
    super(scope, id, props);

    // 1. Retrieve environment from context
    const environment = this.node.tryGetContext('environment') || 'dev';
    const applicationName = props?.applicationName || this.node.tryGetContext('applicationName') || 'rag-app';

    // Parameters for platform integration with fallback for local development
    const userPoolIdParam = new cdk.CfnParameter(this, 'UserPoolId', {
      type: 'String',
      description: 'Cognito User Pool ID',
      default: 'us-east-1_XXXXXXXXX' // Placeholder for local dev
    });

    const knowledgeBaseIdParam = new cdk.CfnParameter(this, 'KnowledgeBaseId', {
      type: 'String',
      description: 'Bedrock Knowledge Base ID',
      default: 'IJ9SLGVYQ1'
    });

    const vectorDbEndpointParam = new cdk.CfnParameter(this, 'VectorDbEndpoint', {
      type: 'String',
      description: 'OpenSearch Serverless endpoint',
      default: 'https://placeholder.us-east-1.aoss.amazonaws.com'
    });

    const sourceBucketParam = new cdk.CfnParameter(this, 'SourceBucket', {
      type: 'String',
      description: 'Source S3 bucket for medical claims synthetic data',
      default: `medical-claims-synthetic-data-${environment}`
    });

    // 2. Import platform resources via SSM
    const applicationRoleArn = ssm.StringParameter.valueFromLookup(
      this,
      `/${applicationName}/${environment}/iam/application-role-arn`
    );

    const apiGatewayId = ssm.StringParameter.valueFromLookup(
      this,
      `/${applicationName}/${environment}/apigateway/api-id`
    );

    const apiGatewayRootResourceId = ssm.StringParameter.valueFromLookup(
      this,
      `/${applicationName}/${environment}/apigateway/root-resource-id`
    );

    const customersTableName = ssm.StringParameter.valueFromLookup(
      this,
      `/${applicationName}/${environment}/dynamodb/customers-table-name`
    );

    const documentsTableName = ssm.StringParameter.valueFromLookup(
      this,
      `/${applicationName}/${environment}/dynamodb/documents-table-name`
    );

    // Note: valueFromLookup returns dummy values during first synthesis
    // Real values are looked up during deployment and cached in cdk.context.json

    // 3. Import platform resources
    const customersTable = dynamodb.Table.fromTableName(
      this,
      'CustomersTable',
      customersTableName
    );

    const documentsTable = dynamodb.Table.fromTableName(
      this,
      'DocumentsTable',
      documentsTableName
    );

    // 3a. Add Global Secondary Indexes to platform tables sequentially
    // Note: DynamoDB only allows 1 GSI operation at a time
    // Note: GSIs are managed by application team, not platform team
    
    // Documents Table GSI names
    const documentsCustomerIndexName = 'customer-documents-index';
    const documentsTenantIndexName = 'tenant-documents-index';
    
    // Create first GSI (idempotent - checks if exists before creating)
    const gsiCustomer = new cr.AwsCustomResource(this, 'GSICustomer', {
      onCreate: {
        service: 'DynamoDB',
        action: 'updateTable',
        parameters: {
          TableName: documentsTableName,
          AttributeDefinitions: [
            { AttributeName: 'customerUuid', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexUpdates: [
            {
              Create: {
                IndexName: documentsCustomerIndexName,
                KeySchema: [
                  { AttributeName: 'customerUuid', KeyType: 'HASH' },
                ],
                Projection: { ProjectionType: 'ALL' },
              },
            },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('DocumentsTableGSICustomer'),
        outputPaths: [], // Don't capture response - table description can be too large
        ignoreErrorCodesMatching: '.*', // Ignore all errors to make truly idempotent
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'describeTable',
        parameters: {
          TableName: documentsTableName,
        },
        physicalResourceId: cr.PhysicalResourceId.of('DocumentsTableGSICustomer'),
        outputPaths: [],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false, // Use runtime SDK version
    });

    // Create second GSI - depends on first GSI to ensure sequential creation (idempotent - checks if exists before creating)
    const gsiTenant = new cr.AwsCustomResource(this, 'GSITenant', {
      onCreate: {
        service: 'DynamoDB',
        action: 'updateTable',
        parameters: {
          TableName: documentsTableName,
          AttributeDefinitions: [
            { AttributeName: 'tenantId', AttributeType: 'S' },
          ],
          GlobalSecondaryIndexUpdates: [
            {
              Create: {
                IndexName: documentsTenantIndexName,
                KeySchema: [
                  { AttributeName: 'tenantId', KeyType: 'HASH' },
                ],
                Projection: { ProjectionType: 'ALL' },
              },
            },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('DocumentsTableGSITenant'),
        outputPaths: [], // Don't capture response - table description can be too large
        ignoreErrorCodesMatching: '.*', // Ignore all errors to make truly idempotent
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'describeTable',
        parameters: {
          TableName: documentsTableName,
        },
        physicalResourceId: cr.PhysicalResourceId.of('DocumentsTableGSITenant'),
        outputPaths: [],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      installLatestAwsSdk: false, // Use runtime SDK version
    });

    // Ensure second GSI waits for first GSI to complete
    gsiTenant.node.addDependency(gsiCustomer);

    // Import IAM role - handle dummy values during synthesis
    const lambdaExecutionRole = applicationRoleArn.startsWith('arn:')
      ? iam.Role.fromRoleArn(
          this,
          'LambdaExecutionRole',
          applicationRoleArn,
          { mutable: false }
        )
      : undefined; // During first synthesis, role will be undefined

    const api = apigateway.RestApi.fromRestApiAttributes(
      this,
      'ImportedApi',
      {
        restApiId: apiGatewayId,
        rootResourceId: apiGatewayRootResourceId
      }
    );

    // Use CfnAuthorizer to reference the platform-provided Cognito User Pool
    const authorizer = new apigateway.CfnAuthorizer(this, 'ApiAuthorizer', {
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      restApiId: apiGatewayId,
      identitySource: 'method.request.header.Authorization',
      providerArns: [
        `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolIdParam.valueAsString}`
      ],
    });

    // 4. Create application-specific resources
    // Note: Using auto-generated bucket names to avoid conflicts
    // CDK will generate names like: rag-app-development-documentsbucket-xxxxx
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      // bucketName removed - let CDK auto-generate to avoid conflicts
      removalPolicy: environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.POST,
            s3.HttpMethods.PUT
          ],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // Dead Letter Queue for failed processing messages
    const processingDLQ = new sqs.Queue(this, 'ProcessingDLQ', {
      visibilityTimeout: cdk.Duration.seconds(1800), // 30 min for retry inspection
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: processingDLQ,
        maxReceiveCount: 3,
      },
    });

    // 5. Create Lambda functions with imported IAM role
    // Lambda function configuration helper with esbuild bundling
    const createLambdaFunction = (
      id: string,
      handler: string,
      environment: { [key: string]: string },
      timeout: cdk.Duration = cdk.Duration.seconds(30),
      memorySize: number = 256
    ): lambda.Function => {
      // Convert handler path from dist/src/lambda/xxx.handler to src/lambda/xxx.ts
      const sourcePath = handler
        .replace('dist/', '')
        .replace('.handler', '.ts');
      
      return new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('.', {
          bundling: {
            image: lambda.Runtime.NODEJS_20_X.bundlingImage,
            command: [
              'bash', '-c', [
                'npm install --omit=dev',
                `npx esbuild ${sourcePath} --bundle --platform=node --target=node20 --external:@aws-sdk/* --outfile=/asset-output/index.js`,
              ].join(' && ')
            ],
            local: {
              tryBundle(outputDir: string) {
                try {
                  const { execSync } = require('child_process');
                  execSync(`npx esbuild ${sourcePath} --bundle --platform=node --target=node20 --external:@aws-sdk/* --outfile=${outputDir}/index.js`, {
                    stdio: 'inherit',
                  });
                  return true;
                } catch {
                  return false;
                }
              },
            },
          },
        }),
        role: lambdaExecutionRole, // undefined during first synthesis, real role during deployment
        timeout,
        memorySize,
        environment,
      });
    };

    // Customer Manager Function
    const customerManagerFunction = createLambdaFunction(
      'CustomerManagerFunction',
      'dist/src/lambda/customer-manager.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        USER_POOL_ID: userPoolIdParam.valueAsString,
        REGION: this.region,
      }
    );

    // Document Upload Function
    const documentUploadFunction = createLambdaFunction(
      'DocumentUploadFunction',
      'dist/src/lambda/document-upload.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        USER_POOL_ID: userPoolIdParam.valueAsString,
        REGION: this.region,
      },
      cdk.Duration.seconds(60),
      512
    );

    // Document Processing Function
    const documentProcessingFunction = createLambdaFunction(
      'DocumentProcessingFunction',
      'dist/src/lambda/document-processing.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(5),
      1024
    );

    // Document Summary Function
    const documentSummaryFunction = createLambdaFunction(
      'DocumentSummaryFunction',
      'dist/src/lambda/document-summary.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(2),
      512
    );

    // Document Retry Function
    const documentRetryFunction = createLambdaFunction(
      'DocumentRetryFunction',
      'dist/src/lambda/document-retry.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: this.region,
      },
      cdk.Duration.minutes(5),
      1024
    );

    // Document Delete Function
    const documentDeleteFunction = createLambdaFunction(
      'DocumentDeleteFunction',
      'dist/src/lambda/document-delete.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: this.region,
      }
    );

    // Document Summary Selective Function
    const documentSummarySelectiveFunction = createLambdaFunction(
      'DocumentSummarySelectiveFunction',
      'dist/src/lambda/document-summary-selective.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(3),
      512
    );

    // Chunking Config Get Function
    const chunkingConfigGetFunction = createLambdaFunction(
      'ChunkingConfigGetFunction',
      'dist/src/lambda/chunking-config-get.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: this.region,
      }
    );

    // Chunking Config Update Function
    const chunkingConfigUpdateFunction = createLambdaFunction(
      'ChunkingConfigUpdateFunction',
      'dist/src/lambda/chunking-config-update.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(10),
      1024
    );

    // Chunking Methods List Function
    const chunkingMethodsListFunction = createLambdaFunction(
      'ChunkingMethodsListFunction',
      'dist/src/lambda/chunking-methods-list.handler',
      {
        REGION: this.region,
      }
    );

    // Chunking Cleanup Trigger Function
    const chunkingCleanupTriggerFunction = createLambdaFunction(
      'ChunkingCleanupTriggerFunction',
      'dist/src/lambda/chunking-cleanup-trigger.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        PROCESSING_QUEUE_URL: processingQueue.queueUrl,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(15),
      1024
    );

    // Chunking Cleanup Status Function
    const chunkingCleanupStatusFunction = createLambdaFunction(
      'ChunkingCleanupStatusFunction',
      'dist/src/lambda/chunking-cleanup-status.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        REGION: this.region,
      }
    );

    // Chunk Visualization Function
    const chunkVisualizationFunction = createLambdaFunction(
      'ChunkVisualizationFunction',
      'dist/src/lambda/chunk-visualization-get.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.minutes(5),
      2048
    );

    // Embeddings Generate Function
    const embeddingsGenerateFunction = createLambdaFunction(
      'EmbeddingsGenerateFunction',
      'dist/src/lambda/embeddings-generate.handler',
      {
        CUSTOMERS_TABLE_NAME: customersTable.tableName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        BEDROCK_REGION: this.region,
        VECTOR_DB_ENDPOINT: vectorDbEndpointParam.valueAsString,
        REGION: this.region,
      },
      cdk.Duration.minutes(15),
      1024
    );

    // Insurance Claim Portal Functions
    const patientListFunction = createLambdaFunction(
      'PatientListFunction',
      'dist/src/lambda/patient-list.handler',
      {
        SOURCE_BUCKET: sourceBucketParam.valueAsString,
        REGION: this.region,
      }
    );

    const patientDetailFunction = createLambdaFunction(
      'PatientDetailFunction',
      'dist/src/lambda/patient-detail.handler',
      {
        SOURCE_BUCKET: sourceBucketParam.valueAsString,
        REGION: this.region,
      }
    );

    // Grant S3 permissions to patient list and detail functions
    const sourceBucket = s3.Bucket.fromBucketName(this, 'SourceBucketRef', sourceBucketParam.valueAsString);
    sourceBucket.grantRead(patientListFunction);
    sourceBucket.grantRead(patientDetailFunction);

    const claimLoaderFunction = createLambdaFunction(
      'ClaimLoaderFunction',
      'dist/src/lambda/claim-loader.handler',
      {
        SOURCE_BUCKET: sourceBucketParam.valueAsString,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      },
      cdk.Duration.minutes(5),
      512
    );

    // Grant S3 permissions to claim loader function
    sourceBucket.grantRead(claimLoaderFunction);
    documentsBucket.grantWrite(claimLoaderFunction);

    const claimStatusFunction = createLambdaFunction(
      'ClaimStatusFunction',
      'dist/src/lambda/claim-status.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      }
    );

    const documentRetrievalFunction = createLambdaFunction(
      'DocumentRetrievalFunction',
      'dist/src/lambda/document-retrieval.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        REGION: this.region,
      }
    );

    // Grant S3 read permissions to document retrieval function
    documentsBucket.grantRead(documentRetrievalFunction);
    
    // Grant DynamoDB read permissions to document retrieval function
    documentsTable.grantReadData(documentRetrievalFunction);

    // ============================================================
    // CloudWatch Alarms for Processing Monitoring
    // ============================================================

    // Alarm: Processing queue depth too high (> 100 messages visible)
    new cloudwatch.Alarm(this, 'ProcessingQueueDepthAlarm', {
      alarmDescription: 'Processing queue has more than 100 visible messages',
      metric: processingQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // Alarm: Any message in DLQ indicates processing failures
    new cloudwatch.Alarm(this, 'ProcessingDLQAlarm', {
      alarmDescription: 'Messages detected in processing dead letter queue - processing failures occurring',
      metric: processingDLQ.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });

    // Alarm: Document processing Lambda errors
    new cloudwatch.Alarm(this, 'DocumentProcessingErrorAlarm', {
      alarmDescription: 'Document processing Lambda function is producing errors',
      metric: documentProcessingFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // ============================================================
    // Textract IAM Permissions for Processing Functions
    // ============================================================

    const textractPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'textract:DetectDocumentText',
        'textract:AnalyzeDocument',
        'textract:GetDocumentTextDetection',
        'textract:StartDocumentTextDetection',
      ],
      resources: ['*'],
    });

    documentProcessingFunction.addToRolePolicy(textractPolicy);
    documentRetryFunction.addToRolePolicy(textractPolicy);

    // 6. Add API routes to imported API Gateway
    // Create resource hierarchy with Cognito authorization
    const methodOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: {
        authorizerId: authorizer.ref,
      },
    };

    // CORS configuration for OPTIONS methods (preflight requests)
    const corsIntegration = new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
          'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
      }],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    });

    const corsMethodOptions: apigateway.MethodOptions = {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Origin': true,
        },
      }],
    };

    // Helper function to add CORS OPTIONS method to a resource
    const addCorsOptions = (resource: apigateway.IResource) => {
      resource.addMethod('OPTIONS', corsIntegration, corsMethodOptions);
    };

    const customersResource = api.root.addResource('customers');
    addCorsOptions(customersResource);
    customersResource.addMethod('POST', new apigateway.LambdaIntegration(customerManagerFunction, { proxy: true }), methodOptions);

    const customerResource = customersResource.addResource('{customerUUID}');
    addCorsOptions(customerResource);
    
    const chunkingConfigResource = customerResource.addResource('chunking-config');
    addCorsOptions(chunkingConfigResource);
    chunkingConfigResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingConfigGetFunction, { proxy: true }), methodOptions);
    chunkingConfigResource.addMethod('PUT', new apigateway.LambdaIntegration(chunkingConfigUpdateFunction, { proxy: true }), methodOptions);

    const chunkingCleanupResource = chunkingConfigResource.addResource('cleanup');
    addCorsOptions(chunkingCleanupResource);
    chunkingCleanupResource.addMethod('POST', new apigateway.LambdaIntegration(chunkingCleanupTriggerFunction, { proxy: true }), methodOptions);

    const cleanupStatusResource = chunkingCleanupResource.addResource('{jobId}');
    addCorsOptions(cleanupStatusResource);
    cleanupStatusResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingCleanupStatusFunction, { proxy: true }), methodOptions);

    const chunkingMethodsResource = api.root.addResource('chunking-methods');
    addCorsOptions(chunkingMethodsResource);
    chunkingMethodsResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingMethodsListFunction, { proxy: true }), methodOptions);

    const documentsResource = api.root.addResource('documents');
    addCorsOptions(documentsResource);
    documentsResource.addMethod('POST', new apigateway.LambdaIntegration(documentUploadFunction, { proxy: true }), methodOptions);

    const documentResource = documentsResource.addResource('{documentId}');
    addCorsOptions(documentResource);
    documentResource.addMethod('GET', new apigateway.LambdaIntegration(documentRetrievalFunction, { proxy: true }), methodOptions);

    const processResource = documentsResource.addResource('process');
    addCorsOptions(processResource);
    processResource.addMethod('POST', new apigateway.LambdaIntegration(documentProcessingFunction, { proxy: true }), methodOptions);

    const summaryResource = documentsResource.addResource('summary');
    addCorsOptions(summaryResource);
    summaryResource.addMethod('POST', new apigateway.LambdaIntegration(documentSummaryFunction, { proxy: true }), methodOptions);

    const summarySelectiveResource = summaryResource.addResource('selective');
    addCorsOptions(summarySelectiveResource);
    summarySelectiveResource.addMethod('POST', new apigateway.LambdaIntegration(documentSummarySelectiveFunction, { proxy: true }), methodOptions);

    const retryResource = documentsResource.addResource('retry');
    addCorsOptions(retryResource);
    retryResource.addMethod('POST', new apigateway.LambdaIntegration(documentRetryFunction, { proxy: true }), methodOptions);

    const deleteResource = documentsResource.addResource('delete');
    addCorsOptions(deleteResource);
    deleteResource.addMethod('DELETE', new apigateway.LambdaIntegration(documentDeleteFunction, { proxy: true }), methodOptions);

    const chunksResource = documentsResource.addResource('chunks');
    addCorsOptions(chunksResource);
    
    const visualizationResource = chunksResource.addResource('visualization');
    addCorsOptions(visualizationResource);
    visualizationResource.addMethod('POST', new apigateway.LambdaIntegration(chunkVisualizationFunction, { proxy: true }), methodOptions);

    const embeddingsResource = documentsResource.addResource('embeddings');
    addCorsOptions(embeddingsResource);
    
    const generateResource = embeddingsResource.addResource('generate');
    addCorsOptions(generateResource);
    generateResource.addMethod('POST', new apigateway.LambdaIntegration(embeddingsGenerateFunction, { proxy: true }), methodOptions);

    // Insurance Claim Portal endpoints
    const patientsResource = api.root.addResource('patients');
    addCorsOptions(patientsResource);
    patientsResource.addMethod('GET', new apigateway.LambdaIntegration(patientListFunction, { proxy: true }), methodOptions);

    const patientResource = patientsResource.addResource('{patientId}');
    addCorsOptions(patientResource);
    patientResource.addMethod('GET', new apigateway.LambdaIntegration(patientDetailFunction, { proxy: true }), methodOptions);

    const claimsResource = api.root.addResource('claims');
    addCorsOptions(claimsResource);
    
    const claimLoadResource = claimsResource.addResource('load');
    addCorsOptions(claimLoadResource);
    claimLoadResource.addMethod('POST', new apigateway.LambdaIntegration(claimLoaderFunction, { proxy: true }), methodOptions);

    const claimResource = claimsResource.addResource('{claimId}');
    addCorsOptions(claimResource);
    
    const claimStatusResource = claimResource.addResource('status');
    addCorsOptions(claimStatusResource);
    claimStatusResource.addMethod('GET', new apigateway.LambdaIntegration(claimStatusFunction, { proxy: true }), methodOptions);

    // Create a deployment to register our new methods
    const deployment = new apigateway.Deployment(this, 'ApiDeployment', {
      api: api,
      description: `Deployment for ${environment} environment - ${new Date().toISOString()}`,
    });

    // Ensure deployment happens after all methods are added
    deployment.node.addDependency(customersResource);
    deployment.node.addDependency(documentsResource);
    deployment.node.addDependency(chunkingMethodsResource);
    deployment.node.addDependency(patientsResource);
    deployment.node.addDependency(claimsResource);

    // Note: The API Gateway stage needs to be updated to use this deployment
    // Platform team should either:
    // 1. Add apigateway:PATCH permission to CloudFormation execution role, OR
    // 2. Manually update the stage after deployment using:
    //    aws apigateway update-stage --rest-api-id wvbm6ooz1j --stage-name dev --patch-operations op=replace,path=/deploymentId,value=<deployment-id>
    //
    // The deployment ID is output below for manual updates if needed
    
    // Gateway Responses — add CORS headers to API Gateway error responses (4xx/5xx)
    // Without these, the browser blocks error responses due to missing CORS headers
    const gatewayResponseCorsHeaders = {
      'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
      'gatewayresponse.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'",
      'gatewayresponse.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
    };

    new apigateway.CfnGatewayResponse(this, 'GatewayResponseDefault4XX', {
      restApiId: api.restApiId,
      responseType: 'DEFAULT_4XX',
      responseParameters: gatewayResponseCorsHeaders,
    });

    new apigateway.CfnGatewayResponse(this, 'GatewayResponseDefault5XX', {
      restApiId: api.restApiId,
      responseType: 'DEFAULT_5XX',
      responseParameters: gatewayResponseCorsHeaders,
    });

    new apigateway.CfnGatewayResponse(this, 'GatewayResponseUnauthorized', {
      restApiId: api.restApiId,
      responseType: 'UNAUTHORIZED',
      responseParameters: gatewayResponseCorsHeaders,
    });

    new apigateway.CfnGatewayResponse(this, 'GatewayResponseAccessDenied', {
      restApiId: api.restApiId,
      responseType: 'ACCESS_DENIED',
      responseParameters: gatewayResponseCorsHeaders,
    });

    // 7. Configure S3 event notifications
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(documentProcessingFunction),
      { prefix: 'uploads/' }
    );

    // 8. Export stack outputs
    // Note: API Gateway URL is exported by platform team's API Gateway stack
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: `https://${apiGatewayId}.execute-api.${this.region}.amazonaws.com/${environment}`,
      description: 'API Gateway endpoint URL',
      // exportName removed - platform team exports this from their API Gateway stack
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'Documents S3 Bucket Name',
      exportName: `${applicationName}-${environment}-documents-bucket`
    });

    new cdk.CfnOutput(this, 'ProcessingQueueUrl', {
      value: processingQueue.queueUrl,
      description: 'Document Processing Queue URL',
      exportName: `${applicationName}-${environment}-processing-queue-url`
    });

    new cdk.CfnOutput(this, 'ProcessingDLQUrl', {
      value: processingDLQ.queueUrl,
      description: 'Document Processing Dead Letter Queue URL',
      exportName: `${applicationName}-${environment}-processing-dlq-url`
    });

    // Lambda function ARN outputs
    new cdk.CfnOutput(this, 'CustomerManagerFunctionArn', {
      value: customerManagerFunction.functionArn,
      description: 'Customer Manager Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'DocumentUploadFunctionArn', {
      value: documentUploadFunction.functionArn,
      description: 'Document Upload Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'DocumentProcessingFunctionArn', {
      value: documentProcessingFunction.functionArn,
      description: 'Document Processing Lambda Function ARN',
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

    // ============================================================
    // Claim Status History Infrastructure
    // ============================================================

    const statusHistoryTable = new dynamodb.Table(this, 'ClaimStatusHistoryTable', {
      tableName: `${applicationName}-claim-status-history-${environment}`,
      partitionKey: { name: 'claimId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'ClaimStatusHistoryTableName', {
      value: statusHistoryTable.tableName,
      description: 'Claim Status History DynamoDB Table Name',
    });

    const claimStatusHistoryFunction = createLambdaFunction(
      'ClaimStatusHistoryFunction',
      'dist/src/lambda/claim-status-history.handler',
      {
        STATUS_HISTORY_TABLE: statusHistoryTable.tableName,
        REGION: this.region,
      },
      cdk.Duration.seconds(30),
      256
    );

    statusHistoryTable.grantReadWriteData(claimStatusHistoryFunction);

    // GET /claims/{claimId}/history
    const claimHistoryResource = claimResource.addResource('history');
    addCorsOptions(claimHistoryResource);
    claimHistoryResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(claimStatusHistoryFunction, { proxy: true }),
      methodOptions
    );
    // POST /claims/{claimId}/history
    claimHistoryResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(claimStatusHistoryFunction, { proxy: true }),
      methodOptions
    );

    deployment.node.addDependency(claimHistoryResource);

    // ============================================================
    // Claim Search Infrastructure
    // ============================================================

    const claimSearchFunction = createLambdaFunction(
      'ClaimSearchFunction',
      'dist/src/lambda/claim-search.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        BEDROCK_REGION: this.region,
        REGION: this.region,
      },
      cdk.Duration.seconds(30),
      512
    );

    // Grant Bedrock Agent Runtime permissions for Knowledge Base retrieval
    claimSearchFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:Retrieve'],
      resources: ['*'],
    }));

    // POST /claims/search
    const claimSearchResource = claimsResource.addResource('search');
    addCorsOptions(claimSearchResource);
    claimSearchResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(claimSearchFunction, { proxy: true }),
      methodOptions
    );

    deployment.node.addDependency(claimSearchResource);

    // ============================================================
    // Claim Export Infrastructure
    // ============================================================

    const claimExportFunction = createLambdaFunction(
      'ClaimExportFunction',
      'dist/src/lambda/claim-export-pdf.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        STATUS_HISTORY_TABLE: statusHistoryTable.tableName,
        REGION: this.region,
      },
      cdk.Duration.seconds(30),
      256
    );

    statusHistoryTable.grantReadData(claimExportFunction);

    // POST /claims/{claimId}/export
    const claimExportResource = claimResource.addResource('export');
    addCorsOptions(claimExportResource);
    claimExportResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(claimExportFunction, { proxy: true }),
      methodOptions
    );

    deployment.node.addDependency(claimExportResource);

    // ============================================================
    // Claim Summary Feature Infrastructure
    // ============================================================

    // Summary Cache Table - stores cache metadata for claim summaries
    // Partition key: cacheKey = {claimId}#{strategy}#{chunkingMethod}
    const summaryCacheTable = new dynamodb.Table(this, 'SummaryCacheTable', {
      tableName: `${applicationName}-summary-cache-${environment}`,
      partitionKey: {
        name: 'cacheKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying summaries by claimId
    summaryCacheTable.addGlobalSecondaryIndex({
      indexName: 'claimId-index',
      partitionKey: {
        name: 'claimId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Export Summary Cache Table name
    new cdk.CfnOutput(this, 'SummaryCacheTableName', {
      value: summaryCacheTable.tableName,
      description: 'Summary Cache DynamoDB Table Name',
      exportName: `${applicationName}-${environment}-summary-cache-table`,
    });

    // Summary Content Bucket - stores full summary text content
    // Path structure: summaries/{claimId}/{strategy}/{chunkingMethod}.json
    const summaryContentBucket = new s3.Bucket(this, 'SummaryContentBucket', {
      bucketName: `${applicationName}-summary-content-${environment}`,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Export Summary Content Bucket name
    new cdk.CfnOutput(this, 'SummaryContentBucketName', {
      value: summaryContentBucket.bucketName,
      description: 'Summary Content S3 Bucket Name',
      exportName: `${applicationName}-${environment}-summary-content-bucket`,
    });

    // Evaluation Results Table - stores evaluation scores per claim per strategy
    // Partition key: claimId, Sort key: strategyKey = {strategy}#{chunkingMethod}
    const evaluationResultsTable = new dynamodb.Table(this, 'EvaluationResultsTable', {
      tableName: `${applicationName}-evaluation-results-${environment}`,
      partitionKey: {
        name: 'claimId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'strategyKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Export Evaluation Results Table name
    new cdk.CfnOutput(this, 'EvaluationResultsTableName', {
      value: evaluationResultsTable.tableName,
      description: 'Evaluation Results DynamoDB Table Name',
      exportName: `${applicationName}-${environment}-evaluation-results-table`,
    });

    // ============================================================
    // Graph RAG Infrastructure — Neptune Analytics + Bedrock KB
    // ============================================================

    // Neptune Analytics Graph (L1 — no L2 construct available)
    const neptuneGraph = new cdk.CfnResource(this, 'NeptuneAnalyticsGraph', {
      type: 'AWS::NeptuneGraph::Graph',
      properties: {
        GraphName: `${applicationName}-graph-${environment}`,
        ProvisionedMemory: 32,
        VectorSearchConfiguration: {
          VectorSearchDimension: 1024,
        },
        PublicConnectivity: false,
        ReplicaCount: 0,
        DeletionProtection: environment === 'prod',
      },
    });

    // KB service role for Bedrock to access S3, Neptune, and embedding models
    const graphRagKbRole = new iam.Role(this, 'GraphRagKbRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockKbPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                documentsBucket.bucketArn,
                `${documentsBucket.bucketArn}/*`,
              ],
            }),
            new iam.PolicyStatement({
              actions: [
                'neptune-graph:GetGraph',
                'neptune-graph:ReadDataViaQuery',
                'neptune-graph:WriteDataViaQuery',
                'neptune-graph:DeleteDataViaQuery',
              ],
              resources: [neptuneGraph.getAtt('GraphArn').toString()],
            }),
            new iam.PolicyStatement({
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-micro-v1:0`,
              ],
            }),
          ],
        }),
      },
    });

    // Bedrock Knowledge Base backed by Neptune Analytics
    // Using CfnResource because the typed L1 construct doesn't support
    // NEPTUNE_ANALYTICS storage type or contextEnrichmentConfiguration yet
    const graphRagKb = new cdk.CfnResource(this, 'GraphRagKnowledgeBase', {
      type: 'AWS::Bedrock::KnowledgeBase',
      properties: {
        Name: `${applicationName}-graphrag-kb-${environment}`,
        RoleArn: graphRagKbRole.roleArn,
        KnowledgeBaseConfiguration: {
          Type: 'VECTOR',
          VectorKnowledgeBaseConfiguration: {
            EmbeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          },
        },
        StorageConfiguration: {
          Type: 'NEPTUNE_ANALYTICS',
          NeptuneAnalyticsConfiguration: {
            GraphArn: neptuneGraph.getAtt('GraphArn').toString(),
            FieldMapping: {
              MetadataField: 'metadata',
              TextField: 'text',
            },
          },
        },
      },
    });
    graphRagKb.node.addDependency(neptuneGraph);

    // S3 data source with CHUNK_ENTITY_EXTRACTION enrichment
    // Using AwsCustomResource because CloudFormation AWS::Bedrock::DataSource
    // doesn't support ContextEnrichmentConfiguration in this region yet, but the
    // Bedrock API requires it when using Neptune Analytics storage.
    // NOTE: Bedrock KB automatically recognizes <filename>.metadata.json sidecar files
    // co-located with source documents in S3. No explicit parsingConfiguration is needed.
    // The claim-loader Lambda writes sidecars with { metadataAttributes: { claimId, patientId, ... } }
    // which Bedrock indexes during ingestion for metadata-filtered retrieval.
    const graphRagDataSource = new cr.AwsCustomResource(this, 'GraphRagDataSource', {
      onCreate: {
        service: 'BedrockAgent',
        action: 'createDataSource',
        parameters: {
          knowledgeBaseId: graphRagKb.getAtt('KnowledgeBaseId').toString(),
          name: `${applicationName}-graphrag-ds-${environment}`,
          dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
              bucketArn: documentsBucket.bucketArn,
              inclusionPrefixes: ['uploads/'],
            },
          },
          vectorIngestionConfiguration: {
            contextEnrichmentConfiguration: {
              type: 'BEDROCK_FOUNDATION_MODEL',
              bedrockFoundationModelConfiguration: {
                enrichmentStrategyConfiguration: {
                  method: 'CHUNK_ENTITY_EXTRACTION',
                },
                modelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-micro-v1:0`,
              },
            },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('dataSource.dataSourceId'),
        outputPaths: ['dataSource.dataSourceId'],
      },
      onDelete: {
        service: 'BedrockAgent',
        action: 'deleteDataSource',
        parameters: {
          knowledgeBaseId: graphRagKb.getAtt('KnowledgeBaseId').toString(),
          dataSourceId: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            'bedrock:CreateDataSource',
            'bedrock:DeleteDataSource',
            'bedrock:GetDataSource',
          ],
          resources: ['*'],
        }),
      ]),
      installLatestAwsSdk: false,
    });
    graphRagDataSource.node.addDependency(graphRagKb);

    // Export Neptune graph ARN
    new cdk.CfnOutput(this, 'NeptuneGraphArn', {
      value: neptuneGraph.getAtt('GraphArn').toString(),
      description: 'Neptune Analytics Graph ARN',
    });

    new cdk.CfnOutput(this, 'GraphRagKnowledgeBaseId', {
      value: graphRagKb.getAtt('KnowledgeBaseId').toString(),
      description: 'GraphRAG Knowledge Base ID',
    });

    // ============================================================
    // Claim Summary Orchestrator Lambda
    // ============================================================

    // Import Documents Table reference for granting read permissions
    const documentsTableRef = dynamodb.Table.fromTableName(
      this,
      'DocumentsTableRef',
      documentsTableName
    );

    // Claim Summary Orchestrator Lambda function
    const claimSummaryOrchestratorFunction = createLambdaFunction(
      'ClaimSummaryOrchestratorFunction',
      'dist/src/lambda/claim-summary-orchestrator.handler',
      {
        DOCUMENTS_TABLE: documentsTableName,
        SUMMARY_CACHE_TABLE: summaryCacheTable.tableName,
        SUMMARY_CONTENT_BUCKET: summaryContentBucket.bucketName,
        EVALUATION_RESULTS_TABLE: evaluationResultsTable.tableName,
        BEDROCK_REGION: 'us-east-1',
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        GRAPH_RAG_KNOWLEDGE_BASE_ID: graphRagKb.getAtt('KnowledgeBaseId').toString(),
        REGION: this.region,
      },
      cdk.Duration.seconds(120),
      512
    );

    // Grant DynamoDB permissions
    documentsTableRef.grantReadData(claimSummaryOrchestratorFunction);
    summaryCacheTable.grantReadWriteData(claimSummaryOrchestratorFunction);
    evaluationResultsTable.grantReadWriteData(claimSummaryOrchestratorFunction);

    // Grant S3 permissions
    summaryContentBucket.grantReadWrite(claimSummaryOrchestratorFunction);

    // Grant Bedrock and AgentCore permissions
    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));

    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeAgent',
        'bedrock:Retrieve',
        'bedrock:RetrieveAndGenerate',
        'bedrock-agentcore:*',
      ],
      resources: ['*'],
    }));

    // Grant OpenSearch Serverless access for Knowledge Base vector search
    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aoss:APIAccessAll',
      ],
      resources: ['*'],
    }));

    // Grant GraphRAG KB retrieval permissions
    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:Retrieve', 'bedrock:RetrieveAndGenerate'],
      resources: [graphRagKb.getAtt('KnowledgeBaseArn').toString()],
    }));

    // Grant Neptune Analytics read access for GraphRAG queries
    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['neptune-graph:ReadDataViaQuery', 'neptune-graph:GetQueryResults'],
      resources: [neptuneGraph.getAtt('GraphArn').toString()],
    }));

    // Grant Cohere Rerank 3.5 model access for optional reranking
    claimSummaryOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/cohere.rerank-v3-5:0`],
    }));

    // Export Claim Summary Orchestrator Lambda function name
    new cdk.CfnOutput(this, 'ClaimSummaryOrchestratorFunctionName', {
      value: claimSummaryOrchestratorFunction.functionName,
      description: 'Claim Summary Orchestrator Lambda Function Name',
    });

    new cdk.CfnOutput(this, 'ClaimSummaryOrchestratorFunctionArn', {
      value: claimSummaryOrchestratorFunction.functionArn,
      description: 'Claim Summary Orchestrator Lambda Function ARN',
    });

    // ============================================================
    // Evaluation Results Writer Lambda
    // ============================================================

    const evaluationResultsWriterFunction = createLambdaFunction(
      'EvaluationResultsWriterFunction',
      'dist/src/lambda/evaluation-results-writer.handler',
      {
        EVALUATION_RESULTS_TABLE: evaluationResultsTable.tableName,
        BEDROCK_REGION: this.region,
      },
      cdk.Duration.seconds(30),
      256
    );

    // Grant DynamoDB write access to the evaluation results table
    evaluationResultsTable.grantWriteData(evaluationResultsWriterFunction);

    // IAM policy for AgentCore Evaluations actions
    const agentCoreEvaluationsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-agentcore:CreateEvaluator',
        'bedrock-agentcore:GetEvaluator',
        'bedrock-agentcore:CreateEvaluationConfig',
        'bedrock-agentcore:StartEvaluation',
      ],
      resources: ['*'],
    });

    evaluationResultsWriterFunction.addToRolePolicy(agentCoreEvaluationsPolicy);

    // Grant the orchestrator Lambda the same AgentCore Evaluations permissions
    // so it can trigger on-demand evaluations
    claimSummaryOrchestratorFunction.addToRolePolicy(agentCoreEvaluationsPolicy);

    // Export Evaluation Results Writer Lambda function ARN
    new cdk.CfnOutput(this, 'EvaluationResultsWriterFunctionArn', {
      value: evaluationResultsWriterFunction.functionArn,
      description: 'Evaluation Results Writer Lambda Function ARN',
    });

    // ============================================================
    // Evaluation Trigger Lambda (Python)
    // ============================================================

    const evaluationTriggerFunction = new lambda.Function(this, 'EvaluationTriggerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('.', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c', [
              'cp -r src/lambda/evaluation_trigger/* /asset-output/',
              'cp -r evaluators /asset-output/evaluators',
              'pip install strands-agents-evals -t /asset-output/ 2>/dev/null || true',
            ].join(' && '),
          ],
          local: {
            tryBundle(outputDir: string) {
              try {
                const { execSync } = require('child_process');
                execSync(`cp -r src/lambda/evaluation_trigger/* ${outputDir}/`, { stdio: 'inherit' });
                execSync(`cp -r evaluators ${outputDir}/evaluators`, { stdio: 'inherit' });
                try {
                  execSync(`pip install strands-agents-evals -t ${outputDir}/ 2>/dev/null`, { stdio: 'inherit' });
                } catch { /* optional dependency */ }
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        EVALUATION_RESULTS_TABLE: evaluationResultsTable.tableName,
        BEDROCK_REGION: 'us-east-1',
      },
    });

    // Grant DynamoDB write access to evaluation results table
    evaluationResultsTable.grantWriteData(evaluationTriggerFunction);

    // Grant Bedrock InvokeModel permission (for the evaluators)
    evaluationTriggerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));

    // Grant the orchestrator Lambda permission to invoke the trigger Lambda
    evaluationTriggerFunction.grantInvoke(claimSummaryOrchestratorFunction);

    // Set EVALUATION_TRIGGER_FUNCTION env var on the orchestrator Lambda
    claimSummaryOrchestratorFunction.addEnvironment(
      'EVALUATION_TRIGGER_FUNCTION',
      evaluationTriggerFunction.functionName,
    );

    // Export Evaluation Trigger Lambda function ARN
    new cdk.CfnOutput(this, 'EvaluationTriggerFunctionArn', {
      value: evaluationTriggerFunction.functionArn,
      description: 'Evaluation Trigger Lambda Function ARN',
    });

    // ============================================================
    // Enriched Agent Lambda (Python)
    // ============================================================

    const enrichedAgentFunction = new lambda.Function(this, 'EnrichedAgentFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'agent.handler',
      code: lambda.Code.fromAsset('.', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c', [
              'cp agents/enriched_agent/agent.py /asset-output/',
              'pip install boto3 -t /asset-output/ 2>/dev/null || true',
            ].join(' && '),
          ],
          local: {
            tryBundle(outputDir: string) {
              try {
                const { execSync } = require('child_process');
                execSync(`cp agents/enriched_agent/agent.py ${outputDir}/`, { stdio: 'inherit' });
                try {
                  execSync(`pip install boto3 -t ${outputDir}/ 2>/dev/null`, { stdio: 'inherit' });
                } catch { /* boto3 available in Lambda runtime */ }
                return true;
              } catch {
                return false;
              }
            },
          },
        },
      }),
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        DOCUMENTS_TABLE: documentsTableName,
        KNOWLEDGE_BASE_ID: knowledgeBaseIdParam.valueAsString,
        GRAPH_RAG_KNOWLEDGE_BASE_ID: graphRagKb.getAtt('KnowledgeBaseId').toString(),
        BEDROCK_REGION: 'us-east-1',
        BEDROCK_MODEL_ID: 'amazon.nova-pro-v1:0',
      },
    });

    // Grant DynamoDB read on Documents table
    documentsTableRef.grantReadData(enrichedAgentFunction);

    // Grant Bedrock KB Retrieve permission
    enrichedAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:Retrieve'],
      resources: ['*'],
    }));

    // Grant Bedrock InvokeModel permission for Nova Pro
    enrichedAgentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));

    // Grant the orchestrator Lambda permission to invoke the enriched agent
    enrichedAgentFunction.grantInvoke(claimSummaryOrchestratorFunction);

    // Set ENRICHED_AGENT_FUNCTION env var on the orchestrator Lambda
    claimSummaryOrchestratorFunction.addEnvironment(
      'ENRICHED_AGENT_FUNCTION',
      enrichedAgentFunction.functionName,
    );

    // Export Enriched Agent Lambda function ARN
    new cdk.CfnOutput(this, 'EnrichedAgentFunctionArn', {
      value: enrichedAgentFunction.functionArn,
      description: 'Enriched Agent Lambda Function ARN',
    });

    // ============================================================
    // Claim Summary API Gateway Endpoints
    // ============================================================

    // POST /claims/{claimId}/summary - Generate or retrieve cached claim summary
    const claimSummaryResource = claimResource.addResource('summary');
    addCorsOptions(claimSummaryResource);
    claimSummaryResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(claimSummaryOrchestratorFunction, { proxy: true }),
      methodOptions
    );

    // GET /claims/{claimId}/evaluations - Retrieve evaluation scores for all strategies
    const claimEvaluationsResource = claimResource.addResource('evaluations');
    addCorsOptions(claimEvaluationsResource);
    claimEvaluationsResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(claimSummaryOrchestratorFunction, { proxy: true }),
      methodOptions
    );

    // Ensure deployment depends on new claim summary resources
    deployment.node.addDependency(claimSummaryResource);
    deployment.node.addDependency(claimEvaluationsResource);
  }
}
