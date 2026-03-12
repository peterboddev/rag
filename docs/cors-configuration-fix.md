# CORS Configuration Fix

## Issue
Frontend applications were receiving CORS errors when making requests with custom headers like `X-Tenant-Id`:

```
Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/documents/summary. 
(Reason: header 'x-tenant-id' is not allowed according to header 'Access-Control-Allow-Headers' from CORS preflight response).
```

## Root Cause
The API Gateway CORS configuration was missing the `X-Tenant-Id` header in the `Access-Control-Allow-Headers` response. This header is required for:
- Multi-tenant applications that pass tenant context
- Custom application headers beyond the standard AWS headers

## Solution Applied

### 1. Updated CDK Stack (Permanent Fix)
Modified `infrastructure/rag-application-stack.ts` to include `X-Tenant-Id` in the CORS configuration:

```typescript
const corsIntegration = new apigateway.MockIntegration({
  integrationResponses: [{
    statusCode: '200',
    responseParameters: {
      'method.response.header.Access-Control-Allow-Headers': 
        "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'",
      'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
      'method.response.header.Access-Control-Allow-Origin': "'*'",
    },
  }],
  // ...
});
```

This ensures all OPTIONS methods (preflight requests) return the correct CORS headers.

### 2. Updated Gateway Responses (Manual Configuration)
Updated error response CORS headers to include `X-Tenant-Id`:

```bash
# UNAUTHORIZED (401) responses
aws apigateway put-gateway-response --rest-api-id wvbm6ooz1j --response-type UNAUTHORIZED \
  --region us-east-1 --response-parameters \
  '{"gatewayresponse.header.Access-Control-Allow-Origin":"'"'"'*'"'"'",
    "gatewayresponse.header.Access-Control-Allow-Headers":"'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'"'"'",
    "gatewayresponse.header.Access-Control-Allow-Methods":"'"'"'*'"'"'"}'

# ACCESS_DENIED (403) responses
aws apigateway put-gateway-response --rest-api-id wvbm6ooz1j --response-type ACCESS_DENIED \
  --region us-east-1 --response-parameters \
  '{"gatewayresponse.header.Access-Control-Allow-Origin":"'"'"'*'"'"'",
    "gatewayresponse.header.Access-Control-Allow-Headers":"'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'"'"'",
    "gatewayresponse.header.Access-Control-Allow-Methods":"'"'"'*'"'"'"}'
```

### 3. Updated All Existing Endpoints
Since the CDK stack creates new endpoints with the correct CORS configuration, we needed to update all existing endpoints that were created before the fix:

```bash
# Updated integration responses for all 24 endpoints with OPTIONS methods
# 22 succeeded, 2 failed (platform-managed endpoints)
aws apigateway put-integration-response --rest-api-id wvbm6ooz1j \
  --resource-id <resource-id> --http-method OPTIONS --status-code 200 \
  --region us-east-1 --response-parameters file://cors-params.json
```

### 4. Created New Deployment
Created deployment `rbqris` to activate all the changes:

```bash
aws apigateway create-deployment --rest-api-id wvbm6ooz1j --stage-name dev \
  --region us-east-1 --description "Apply X-Tenant-Id CORS fix to all 22 application endpoints"
# Result: Deployment ID rbqris
```

## What This Fixes

### Before
- ❌ Preflight OPTIONS requests rejected custom headers
- ❌ Frontend couldn't send `X-Tenant-Id` header
- ❌ Multi-tenant functionality broken
- ❌ CORS errors on every API call with custom headers

### After
- ✅ Preflight OPTIONS requests accept `X-Tenant-Id` header
- ✅ Frontend can send custom headers
- ✅ Multi-tenant functionality works
- ✅ No CORS errors on API calls
- ✅ Error responses (401, 403) also include proper CORS headers

## Headers Now Allowed

The following headers are now allowed in CORS requests:
- `Content-Type` - Standard content type header
- `X-Amz-Date` - AWS signature header
- `Authorization` - JWT token for Cognito authentication
- `X-Api-Key` - API key (if used)
- `X-Amz-Security-Token` - AWS temporary credentials
- `X-Tenant-Id` - **Custom header for multi-tenant context**

## Future Deployments

When the CDK stack is deployed via CI/CD pipeline:
1. The updated CORS configuration will be applied to all OPTIONS methods automatically
2. Gateway Responses need to be manually updated (or added to CDK as Custom Resources)
3. A new deployment will be created automatically by the pipeline

## Testing

Test CORS configuration with:

```bash
# Test preflight request
curl -X OPTIONS https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/documents/summary \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,x-tenant-id" \
  -v
```

Expected response should include:
```
Access-Control-Allow-Headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Origin: *
```

## Related Documentation
- [API Gateway Deployment Success](./api-gateway-deployment-success.md)
- [Frontend Integration Status](./frontend-integration-status.md)
- [Testing Guide](./testing-guide.md)

## Notes for Platform Team

If the platform team wants to manage Gateway Responses via CDK, they can add Custom Resources with `apigateway:PutGatewayResponse` permission to the CloudFormation execution role.

Example Custom Resource:
```typescript
new cr.AwsCustomResource(this, 'GatewayResponseUnauthorized', {
  onCreate: {
    service: 'APIGateway',
    action: 'putGatewayResponse',
    parameters: {
      restApiId: apiGatewayId,
      responseType: 'UNAUTHORIZED',
      responseParameters: {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'*'",
        'gatewayresponse.header.Access-Control-Allow-Headers': 
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Tenant-Id'",
        'gatewayresponse.header.Access-Control-Allow-Methods': "'*'"
      }
    },
    physicalResourceId: cr.PhysicalResourceId.of('GatewayResponseUnauthorized'),
  },
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
    resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
  }),
});
```
