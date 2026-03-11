# API Gateway "Missing Authentication Token" - Troubleshooting Guide

## Issue Summary

**Error**: "Missing Authentication Token" when accessing API endpoints  
**Environment**: Development (`dev`)  
**API Gateway ID**: `wvbm6ooz1j`  
**Date**: 2026-03-11

---

## Root Causes Identified

### 1. API Path Mismatch ✅ FIXED

**Problem**: Frontend was calling `/api/patients` but CDK stack creates `/patients`

**Frontend Code (Before)**:
```typescript
apiRequest<PatientListResponse>(`/api/patients?${params.toString()}`)
```

**CDK Stack**:
```typescript
const patientsResource = api.root.addResource('patients');
// Creates: /patients (not /api/patients)
```

**Fix Applied**:
- Updated `frontend/src/services/claimApi.ts` to remove `/api` prefix
- Changed `/api/patients` → `/patients`
- Changed `/api/claims` → `/claims`

### 2. Missing API Gateway Permissions ⚠️ REQUIRES PLATFORM TEAM

**Problem**: Lambda execution role lacks API Gateway permissions

**Impact**:
- API Gateway methods may not be properly registered during deployment
- CDK deployment cannot verify API Gateway configuration
- Runtime issues with API Gateway integrations

**Required Action**: Platform team needs to add API Gateway permissions to `rag-app-rag-role-dev`

See: `docs/platform-team-api-gateway-permissions.md` for detailed request

### 3. Environment Variable Name Mismatch ✅ FIXED

**Problem**: Frontend code expects `REACT_APP_API_GATEWAY_URL` but `.env` had `REACT_APP_API_URL`

**Fix Applied**:
- Updated `frontend/.env` to use correct variable name
- Changed `REACT_APP_API_URL` → `REACT_APP_API_GATEWAY_URL`

---

## Understanding "Missing Authentication Token" Error

This error from API Gateway can mean several things:

### Scenario 1: Route Doesn't Exist ❌

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/nonexistent
{"message":"Missing Authentication Token"}
```

**Cause**: The API Gateway route `/nonexistent` doesn't exist

**Solution**: Verify the route exists in API Gateway console or CDK stack

### Scenario 2: Wrong HTTP Method ❌

```bash
$ curl -X POST https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Missing Authentication Token"}
```

**Cause**: The route `/patients` exists but only supports GET, not POST

**Solution**: Use the correct HTTP method

### Scenario 3: Missing Authorization Header (Expected) ✅

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Unauthorized"}
```

**Cause**: The route exists and requires Cognito authentication

**Solution**: This is the EXPECTED behavior - add Authorization header with JWT token

### Scenario 4: Stage Not Deployed ❌

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Missing Authentication Token"}
```

**Cause**: The API Gateway stage `dev` doesn't have the latest deployment

**Solution**: Create a new deployment and associate it with the stage

---

## Current Status

### ✅ Fixed Issues

1. **API Path Mismatch**: Frontend now calls correct paths (`/patients`, `/claims`)
2. **Environment Variable**: Frontend now uses correct variable name
3. **CDK Stack**: Creates API Gateway Deployment to register methods

### ⚠️ Pending Issues

1. **API Gateway Permissions**: Waiting for platform team to add permissions
2. **Cognito Authentication**: Not yet implemented in frontend (next step)

### 🔍 Diagnostic Steps

To verify the current state:

```bash
# 1. Check if routes exist in API Gateway
aws apigateway get-resources --rest-api-id wvbm6ooz1j

# 2. Check if deployment exists
aws apigateway get-deployments --rest-api-id wvbm6ooz1j

# 3. Check if stage is configured
aws apigateway get-stage --rest-api-id wvbm6ooz1j --stage-name dev

# 4. Test endpoint (should return 401 Unauthorized, not "Missing Authentication Token")
curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
```

---

## Expected Behavior After All Fixes

### Without Authentication Token

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Unauthorized"}
```

This indicates:
- ✅ Route exists
- ✅ API Gateway is working
- ✅ Cognito authorization is configured
- ❌ Request lacks authentication token (expected)

### With Authentication Token

```bash
$ curl -H "Authorization: Bearer <jwt-token>" \
  https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{
  "patients": [...],
  "nextToken": "..."
}
```

This indicates:
- ✅ Route exists
- ✅ API Gateway is working
- ✅ Cognito authorization is configured
- ✅ Authentication token is valid
- ✅ Lambda function executed successfully

---

## Next Steps

### 1. Platform Team Action Required

Add API Gateway permissions to Lambda execution role:

See: `docs/platform-team-api-gateway-permissions.md`

### 2. Redeploy Application

After platform team adds permissions:

```bash
# Trigger redeployment
git push origin main

# Pipeline will automatically:
# - Build application
# - Deploy CDK stack
# - Register API Gateway methods
# - Create deployment
```

### 3. Verify API Gateway

```bash
# Test endpoint (should return 401 Unauthorized)
curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients

# Expected response:
# {"message":"Unauthorized"}
```

### 4. Implement Cognito Authentication

Add AWS Amplify to frontend:

```bash
cd frontend
npm install aws-amplify @aws-amplify/ui-react
```

Configure Amplify in `frontend/src/index.tsx`:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_WcelaDusa',
    userPoolWebClientId: '[client-id]',
  }
});
```

Update `frontend/src/services/claimApi.ts` to get token from Amplify:

```typescript
import { Auth } from 'aws-amplify';

const getAuthToken = async (): Promise<string | null> => {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error) {
    return null;
  }
};
```

### 5. Test End-to-End

1. Sign in with Cognito user
2. Make API request with authentication token
3. Verify data is returned correctly

---

## Troubleshooting Commands

### Check API Gateway Resources

```bash
# List all resources
aws apigateway get-resources --rest-api-id wvbm6ooz1j

# Expected output should include:
# - /patients
# - /patients/{patientId}
# - /claims
# - /claims/load
# - /claims/{claimId}/status
```

### Check API Gateway Deployments

```bash
# List deployments
aws apigateway get-deployments --rest-api-id wvbm6ooz1j

# Should show recent deployment with description:
# "Deployment for dev environment - 2026-03-11T..."
```

### Check API Gateway Stage

```bash
# Get stage configuration
aws apigateway get-stage --rest-api-id wvbm6ooz1j --stage-name dev

# Should show:
# - stageName: "dev"
# - deploymentId: "[deployment-id]"
# - methodSettings: {...}
```

### Check Lambda Function Permissions

```bash
# Get Lambda execution role
aws iam get-role --role-name rag-app-rag-role-dev

# Get role policies
aws iam list-role-policies --role-name rag-app-rag-role-dev

# Get inline policy
aws iam get-role-policy \
  --role-name rag-app-rag-role-dev \
  --policy-name rag-app-policy-dev
```

### Test API Endpoints

```bash
# Test patients endpoint (should return 401)
curl -v https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients

# Test with invalid token (should return 401)
curl -v -H "Authorization: Bearer invalid-token" \
  https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients

# Test with valid token (should return 200)
curl -v -H "Authorization: Bearer <valid-jwt-token>" \
  https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
```

---

## Related Documentation

- `docs/platform-team-api-gateway-permissions.md` - API Gateway permissions request
- `docs/platform-team-response.md` - Platform deployment process
- `docs/rag-app-team-guide.md` - Integration guide
- `infrastructure/rag-application-stack.ts` - CDK stack configuration

---

**Last Updated**: 2026-03-11  
**Status**: Waiting for platform team to add API Gateway permissions  
**Next Action**: Platform team adds permissions, then application team redeploys
