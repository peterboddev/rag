# Platform Team: API Gateway Permissions Required

## Summary

The RAG application Lambda execution role needs API Gateway permissions to enable seamless deployments. Currently, the role has comprehensive permissions for AWS services (Bedrock, DynamoDB, S3, etc.) but is missing API Gateway permissions.

---

## Current Issue

**Symptom**: "Missing Authentication Token" error when accessing API endpoints

**Root Cause**: The Lambda execution role (`rag-app-rag-role-dev`) lacks permissions to interact with API Gateway resources during deployment and runtime.

**Impact**: 
- API Gateway methods may not be properly registered
- Deployment process cannot verify API Gateway configuration
- Runtime issues with API Gateway integrations

---

## Current Role Permissions

The Lambda execution role currently has permissions for:

✅ **Bedrock** (InvokeModel, Retrieve)  
✅ **Textract** (AnalyzeDocument, DetectDocumentText)  
✅ **Cognito** (AdminCreateUser, AdminGetUser, etc.)  
✅ **DynamoDB** (full CRUD + UpdateTable for GSIs)  
✅ **OpenSearch Serverless** (full access)  
✅ **S3** (full access for rag-app-* buckets)  
✅ **SQS** (full access for rag-app-* queues)  
✅ **EventBridge** (full access for rag-app-* rules)  
✅ **Step Functions** (full access for rag-app-* state machines)  
✅ **Lambda** (full access for rag-app-* functions)  
✅ **IAM PassRole** (for Lambda, Step Functions, EventBridge)

❌ **API Gateway** (MISSING)

---

## Required API Gateway Permissions

Please add the following permissions to the Lambda execution role (`rag-app-rag-role-dev`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE"
      ],
      "Resource": [
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j",
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j/*",
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j/resources/*",
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j/methods/*",
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j/deployments/*",
        "arn:aws:apigateway:us-east-1::/restapis/wvbm6ooz1j/authorizers/*"
      ]
    }
  ]
}
```

### Explanation of Permissions

- **apigateway:GET** - Read API Gateway configuration (verify deployments)
- **apigateway:POST** - Create new resources (methods, deployments)
- **apigateway:PUT** - Update existing resources
- **apigateway:PATCH** - Partial updates to resources
- **apigateway:DELETE** - Remove resources when needed

### Resource Scope

- **API Gateway ID**: `wvbm6ooz1j` (development environment)
- **Region**: `us-east-1`
- **Scope**: Limited to the specific API Gateway instance used by the RAG application

---

## Why These Permissions Are Needed

### 1. Deployment Process

The CDK stack creates API Gateway resources (methods, integrations, deployments) that need to be registered with the existing API Gateway. The Lambda execution role is used during the CDK deployment process to:

- Create API Gateway methods
- Configure Lambda integrations
- Create API Gateway deployments
- Configure Cognito authorizers

### 2. Runtime Operations

While less common, some runtime scenarios may require API Gateway permissions:

- Custom resource handlers that manage API Gateway configuration
- Lambda functions that dynamically update API Gateway settings
- Monitoring and health check functions

### 3. Seamless Deployments

With these permissions, the application team can:

- Deploy API Gateway changes without manual intervention
- Verify API Gateway configuration programmatically
- Troubleshoot API Gateway issues more effectively

---

## Alternative Approaches Considered

### Option 1: Separate Deployment Role ❌

**Approach**: Create a separate IAM role specifically for CDK deployments

**Pros**: 
- Separates deployment permissions from runtime permissions
- More granular security control

**Cons**:
- Requires pipeline changes
- More complex IAM configuration
- Doesn't solve runtime permission issues

**Decision**: Not recommended - adds complexity without significant security benefit

### Option 2: Manual API Gateway Configuration ❌

**Approach**: Platform team manually configures API Gateway after each deployment

**Pros**:
- No additional IAM permissions needed

**Cons**:
- Manual process is error-prone
- Slows down deployment cycle
- Doesn't scale with multiple applications

**Decision**: Not recommended - defeats purpose of automated deployments

### Option 3: Add API Gateway Permissions to Lambda Role ✅

**Approach**: Add API Gateway permissions to the existing Lambda execution role

**Pros**:
- Simple and straightforward
- Enables seamless deployments
- Follows principle of least privilege (scoped to specific API)
- No pipeline changes required

**Cons**:
- Slightly broader permissions than strictly necessary for runtime

**Decision**: RECOMMENDED - best balance of simplicity and security

---

## Security Considerations

### Principle of Least Privilege

The requested permissions are scoped to:
- **Specific API Gateway**: `wvbm6ooz1j` (not all APIs)
- **Specific Region**: `us-east-1`
- **Specific Actions**: Only CRUD operations (no administrative actions)

### No Elevated Privileges

These permissions do NOT grant:
- Ability to create new API Gateways
- Ability to modify other API Gateways
- Ability to change IAM roles or policies
- Ability to access other AWS accounts

### Audit Trail

All API Gateway operations are logged in CloudTrail, providing:
- Who made the change
- What was changed
- When it was changed
- Source IP address

---

## Implementation Steps

### Step 1: Update IAM Role Policy

Add the API Gateway permissions to the Lambda execution role:

```bash
# Get current role policy
aws iam get-role-policy \
  --role-name rag-app-rag-role-dev \
  --policy-name rag-app-policy-dev

# Update policy with API Gateway permissions
# (Use AWS Console or CLI to add the permissions shown above)
```

### Step 2: Verify Permissions

```bash
# Test that the role has API Gateway permissions
aws apigateway get-rest-api \
  --rest-api-id wvbm6ooz1j \
  --profile [role-profile]
```

### Step 3: Redeploy Application

After permissions are added:

```bash
# Application team will trigger deployment
git push origin main

# Pipeline will automatically:
# 1. Build the application
# 2. Deploy CDK stack (with API Gateway permissions)
# 3. Register API Gateway methods
# 4. Create deployment
```

### Step 4: Verify API Gateway

```bash
# Check that API Gateway methods are registered
aws apigateway get-resources \
  --rest-api-id wvbm6ooz1j

# Test API endpoint (should return 401 Unauthorized, not "Missing Authentication Token")
curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
```

---

## Expected Behavior After Fix

### Before (Current State)

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Missing Authentication Token"}
```

This error indicates the route doesn't exist or isn't properly deployed.

### After (Expected State)

```bash
$ curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
{"message":"Unauthorized"}
```

This error indicates:
- ✅ Route exists and is deployed
- ✅ API Gateway is working
- ✅ Cognito authorization is configured
- ❌ Request lacks authentication token (expected behavior)

---

## Testing Plan

After permissions are added, the application team will:

1. **Verify Deployment**
   - Check CloudFormation stack status
   - Verify API Gateway methods are created
   - Confirm Lambda integrations are configured

2. **Test Unauthenticated Requests**
   - Should return `401 Unauthorized` (not "Missing Authentication Token")
   - Confirms routes are properly deployed

3. **Test Authenticated Requests**
   - Implement Cognito authentication in frontend
   - Test with valid JWT token
   - Should return `200 OK` with data

4. **End-to-End Testing**
   - Test all API endpoints
   - Verify data flows correctly
   - Confirm error handling works

---

## Timeline

**Priority**: HIGH - Blocking frontend integration

**Estimated Time to Fix**:
- Platform team adds permissions: 10 minutes
- Application team redeploys: 15 minutes (automatic)
- Verification and testing: 30 minutes

**Total**: ~1 hour

---

## Next Steps

1. **Platform Team**: Add API Gateway permissions to `rag-app-rag-role-dev`
2. **Platform Team**: Notify application team when permissions are added
3. **Application Team**: Trigger redeployment (git push)
4. **Application Team**: Verify API Gateway routes are accessible
5. **Application Team**: Implement Cognito authentication in frontend
6. **Application Team**: Test end-to-end with authenticated requests

---

## Questions?

If you have any questions or concerns about:
- The requested permissions
- Security implications
- Alternative approaches
- Implementation details

Please reach out to the application development team.

---

**Related Documentation**:
- `docs/platform-team-response.md` - Platform deployment process
- `docs/rag-app-team-guide.md` - Integration guide
- `infrastructure/rag-application-stack.ts` - CDK stack with API Gateway configuration

---

**Last Updated**: 2026-03-11  
**Status**: Awaiting platform team action  
**Contact**: Application Development Team
