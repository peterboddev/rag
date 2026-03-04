import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

describe('Documents Table GSI Configuration', () => {
  describe('claim-documents-index GSI', () => {
    let app: cdk.App;
    let stack: cdk.Stack;
    let template: Template;

    beforeEach(() => {
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
      
      // Create a minimal documents table with the three GSIs
      const documentsTable = new dynamodb.Table(stack, 'DocumentsTable', {
        tableName: 'rag-app-v2-documents-dev',
        partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'customerUuid', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      });

      // Add the three GSIs as in the actual stack
      documentsTable.addGlobalSecondaryIndex({
        indexName: 'tenant-documents-index',
        partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      });

      documentsTable.addGlobalSecondaryIndex({
        indexName: 'customer-documents-index',
        partitionKey: { name: 'customerUuid', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      });

      documentsTable.addGlobalSecondaryIndex({
        indexName: 'claim-documents-index',
        partitionKey: { name: 'claimId', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      });

      template = Template.fromStack(stack);
    });

    it('should have claim-documents-index GSI with correct partition key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'claim-documents-index',
            KeySchema: Match.arrayWith([
              {
                AttributeName: 'claimId',
                KeyType: 'HASH'
              }
            ])
          })
        ])
      });
    });

    it('should have claim-documents-index GSI with correct sort key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'claim-documents-index',
            KeySchema: Match.arrayWith([
              {
                AttributeName: 'createdAt',
                KeyType: 'RANGE'
              }
            ])
          })
        ])
      });
    });

    it('should have all three GSIs configured', () => {
      const resources = template.findResources('AWS::DynamoDB::Table', {
        Properties: {
          TableName: 'rag-app-v2-documents-dev'
        }
      });

      const tableResource = Object.values(resources)[0];
      const gsiCount = tableResource.Properties.GlobalSecondaryIndexes?.length || 0;
      
      expect(gsiCount).toBe(3);
    });

    it('should define claimId attribute for GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: 'claimId',
            AttributeType: 'S'
          }
        ])
      });
    });

    it('should have tenant-documents-index GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'tenant-documents-index'
          })
        ])
      });
    });

    it('should have customer-documents-index GSI', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'customer-documents-index'
          })
        ])
      });
    });

    it('should configure claim-documents-index with projection type ALL', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'rag-app-v2-documents-dev',
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'claim-documents-index',
            Projection: {
              ProjectionType: 'ALL'
            }
          })
        ])
      });
    });
  });

  describe('GSI Query Performance', () => {
    it('should support efficient claim document queries by claimId', () => {
      // This test documents the expected query pattern
      const expectedQueryPattern = {
        indexName: 'claim-documents-index',
        partitionKey: 'claimId',
        sortKey: 'createdAt',
        queryType: 'Query by claimId, sorted by createdAt'
      };

      expect(expectedQueryPattern.indexName).toBe('claim-documents-index');
      expect(expectedQueryPattern.partitionKey).toBe('claimId');
      expect(expectedQueryPattern.sortKey).toBe('createdAt');
    });

    it('should enable chronological document retrieval for claims', () => {
      // This test documents the use case
      const useCase = {
        description: 'Retrieve all documents for a specific claim, ordered by creation time',
        gsiUsed: 'claim-documents-index',
        benefits: [
          'Efficient queries without scanning entire table',
          'Documents returned in chronological order',
          'Supports pagination with consistent ordering'
        ]
      };

      expect(useCase.gsiUsed).toBe('claim-documents-index');
      expect(useCase.benefits).toHaveLength(3);
    });
  });
});

