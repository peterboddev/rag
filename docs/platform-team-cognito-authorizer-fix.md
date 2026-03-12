# Platform Team: Cognito Authorizer Configuration Issue

## Issue

The API Gateway Cognito authorizer is configured with the wrong User Pool ARN, causing all authenticated requests to return "Unauthorized".

## Current Configuration

**Authorizer ID**: `b2d9uj`
**Authorizer Name**: `CognitoAuthorizer`
**Current User Pool ARN**: `arn:aws:cognito-idp:us-east-1:450683699755:userpool/us-east-1_XXXXXXXXX`

## Required Configuration

**Correct User Pool ID**: `us-east-1_WcelaDusa`
**Correct User Pool ARN**: `arn:aws:cognito-idp:us-east-1:450683699755:userpool/us-east-1_WcelaDusa`

## Impact

- All API requests with valid JWT tokens from the correct User Pool are being rejected
- Frontend cannot access any authenticated endpoints
- Users can sign in successfully but cannot make API calls

## Solution

Update the Cognito authorizer to use the correct User Pool:

```bash
aws apigateway update-authorizer \
  --rest-api-id wvbm6ooz1j \
  --authorizer-id b2d9uj \
  --region us-east-1 \
  --patch-operations \
    op=replace,path=/providerARNs/0,value=arn:aws:cognito-idp:us-east-1:450683699755:userpool/us-east-1_WcelaDusa
```

After updating, create a new deployment:

```bash
aws apigateway create-deployment \
  --rest-api-id wvbm6ooz1j \
  --stage-name dev \
  --region us-east-1 \
  --description "Updated Cognito authorizer to correct User Pool"
```

## Verification

After the fix, test with a valid JWT token:

```bash
# Get a token by signing in at http://localhost:3000
# Then test:
curl -H "Authorization: Bearer <token>" \
  https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients?limit=50
```

Should return patient list instead of "Unauthorized".

## Root Cause

The authorizer was created with a placeholder or incorrect User Pool ARN. The application team is using User Pool `us-east-1_WcelaDusa` which was provided by the platform team, but the API Gateway authorizer wasn't updated to match.

## Priority

**HIGH** - Blocks all frontend functionality that requires authentication.
