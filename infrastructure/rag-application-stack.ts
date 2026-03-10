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
import { Construct } from 'constructs';

export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Retrieve environment from context
    const environment = this.node.tryGetContext('environment') || 'dev';
    const applicationName = 'rag-app';

    // Parameters for platform integration with fallback for local development
    const userPoolIdParam = new cdk.CfnParameter(this, 'UserPoolId', {
      type: 'String',
      description: 'Cognito User Pool ID',
      default: 'us-east-1_XXXXXXXXX' // Placeholder for local dev
    });

    const knowledgeBaseIdParam = new cdk.CfnParameter(this, 'KnowledgeBaseId', {
      type: 'String',
      description: 'Bedrock Knowledge Base ID',
      default: `${applicationName}-kb-${environment}`
    });

    const vectorDbEndpointParam = new cdk.CfnParameter(this, 'VectorDbEndpoint', {
      type: 'String',
      description: 'OpenSearch Serverless endpoint',
      default: 'https://placeholder.us-east-1.aoss.amazonaws.com'
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
    
    // Documents Table GSI names
    const documentsCustomerIndexName = 'customer-documents-index';
    const documentsTenantIndexName = 'tenant-documents-index';
    
    // Create first GSI (idempotent - ignores if already exists)
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
        ignoreErrorCodesMatching: 'ResourceInUseException', // Ignore if GSI already exists
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    // Create second GSI - depends on first GSI to ensure sequential creation (idempotent - ignores if already exists)
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
        ignoreErrorCodesMatching: 'ResourceInUseException', // Ignore if GSI already exists
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
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

    const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
      // queueName removed - let CDK auto-generate to avoid conflicts
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
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
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        REGION: this.region,
      }
    );

    const patientDetailFunction = createLambdaFunction(
      'PatientDetailFunction',
      'dist/src/lambda/patient-detail.handler',
      {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        REGION: this.region,
      }
    );

    const claimLoaderFunction = createLambdaFunction(
      'ClaimLoaderFunction',
      'dist/src/lambda/claim-loader.handler',
      {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      },
      cdk.Duration.minutes(5),
      512
    );

    const claimStatusFunction = createLambdaFunction(
      'ClaimStatusFunction',
      'dist/src/lambda/claim-status.handler',
      {
        DOCUMENTS_TABLE_NAME: documentsTable.tableName,
        REGION: this.region,
      }
    );

    // 6. Add API routes to imported API Gateway
    // Create resource hierarchy
    const customersResource = api.root.addResource('customers');
    customersResource.addMethod('POST', new apigateway.LambdaIntegration(customerManagerFunction));

    const customerResource = customersResource.addResource('{customerUUID}');
    const chunkingConfigResource = customerResource.addResource('chunking-config');
    chunkingConfigResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingConfigGetFunction));
    chunkingConfigResource.addMethod('PUT', new apigateway.LambdaIntegration(chunkingConfigUpdateFunction));

    const chunkingCleanupResource = chunkingConfigResource.addResource('cleanup');
    chunkingCleanupResource.addMethod('POST', new apigateway.LambdaIntegration(chunkingCleanupTriggerFunction));

    const cleanupStatusResource = chunkingCleanupResource.addResource('{jobId}');
    cleanupStatusResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingCleanupStatusFunction));

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

    const chunksResource = documentsResource.addResource('chunks');
    const visualizationResource = chunksResource.addResource('visualization');
    visualizationResource.addMethod('POST', new apigateway.LambdaIntegration(chunkVisualizationFunction, {
      proxy: true,
    }));

    const embeddingsResource = documentsResource.addResource('embeddings');
    const generateResource = embeddingsResource.addResource('generate');
    generateResource.addMethod('POST', new apigateway.LambdaIntegration(embeddingsGenerateFunction, {
      proxy: true,
    }));

    // Insurance Claim Portal endpoints
    const patientsResource = api.root.addResource('patients');
    patientsResource.addMethod('GET', new apigateway.LambdaIntegration(patientListFunction));

    const patientResource = patientsResource.addResource('{patientId}');
    patientResource.addMethod('GET', new apigateway.LambdaIntegration(patientDetailFunction));

    const claimsResource = api.root.addResource('claims');
    const claimLoadResource = claimsResource.addResource('load');
    claimLoadResource.addMethod('POST', new apigateway.LambdaIntegration(claimLoaderFunction));

    const claimResource = claimsResource.addResource('{claimId}');
    const claimStatusResource = claimResource.addResource('status');
    claimStatusResource.addMethod('GET', new apigateway.LambdaIntegration(claimStatusFunction));

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
  }
}
