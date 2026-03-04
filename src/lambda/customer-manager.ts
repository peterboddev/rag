import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v5 as uuidv5 } from 'uuid';
import { CustomerManagerRequest, CustomerManagerResponse, CustomerRecord } from '../types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME!;

// Namespace UUID for deterministic UUID generation
const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Customer Manager Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path,
      headers: event.headers 
    });

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Extract tenant_id from JWT token (simplified for now)
    const tenantId = extractTenantFromToken(event);
    if (!tenantId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Unauthorized: Missing tenant_id' }),
      };
    }

    const request: CustomerManagerRequest = JSON.parse(event.body || '{}');
    const { customerEmail } = request;

    if (!customerEmail) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing customerEmail' }),
      };
    }

    // Check if customer already exists
    const existingCustomer = await findCustomerByEmail(tenantId, customerEmail);
    
    if (existingCustomer) {
      const response: CustomerManagerResponse = {
        customerUUID: existingCustomer.uuid,
        customerId: existingCustomer.customerId,
        isNewCustomer: false,
      };

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(response),
      };
    }

    // Create new customer
    const customerId = generateCustomerId();
    const customerUUID = generateCustomerUUID(tenantId, customerId);
    
    const newCustomer: CustomerRecord = {
      uuid: customerUUID,
      tenantId,
      customerId,
      email: customerEmail,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    };

    await createCustomer(newCustomer);

    const response: CustomerManagerResponse = {
      customerUUID,
      customerId,
      isNewCustomer: true,
    };

    console.log('Customer created successfully', { customerUUID, customerId, tenantId });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in customer manager:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

function extractTenantFromToken(event: APIGatewayProxyEvent): string | null {
  // In production, this would parse the JWT token from the Authorization header
  // For now, we'll use a header or default for local testing
  const authHeader = event.headers.Authorization || event.headers.authorization;
  
  // For local development, allow tenant_id in headers
  const tenantIdHeader = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }

  // TODO: Implement proper JWT parsing when Cognito is integrated
  // const token = authHeader?.replace('Bearer ', '');
  // const decoded = jwt.decode(token) as any;
  // return decoded['custom:tenant_id'];
  
  return 'local-dev-tenant'; // Default for local development
}

async function findCustomerByEmail(tenantId: string, email: string): Promise<CustomerRecord | null> {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CUSTOMERS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      FilterExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':email': email,
        ':tenantId': tenantId,
      },
    }));

    return result.Items?.[0] as CustomerRecord || null;
  } catch (error) {
    console.error('Error finding customer by email:', error);
    throw error;
  }
}

async function createCustomer(customer: CustomerRecord): Promise<void> {
  try {
    await dynamoClient.send(new PutCommand({
      TableName: CUSTOMERS_TABLE,
      Item: customer,
      ConditionExpression: 'attribute_not_exists(#uuid)',
      ExpressionAttributeNames: {
        '#uuid': 'uuid',
      },
    }));
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

function generateCustomerId(): string {
  // Generate a random customer ID
  return `customer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateCustomerUUID(tenantId: string, customerId: string): string {
  // Generate deterministic UUID from tenant_id + customer_id
  return uuidv5(`${tenantId}:${customerId}`, NAMESPACE_UUID);
}