# Next Steps After Platform Team Update

## Summary

The platform team has clarified the API Gateway permissions issue and updated their code. The permissions were correctly added to the **CloudFormation execution role** (not the Lambda execution role). We're now waiting for them to deploy the updated platform pipeline.

---

## What the Platform Team Did

### ✅ Identified the Correct Issue

The platform team explained that:
- **Lambda execution role** (`rag-app-rag-role-dev`) is used at RUNTIME - doesn't need API Gateway permissions
- **CloudFormation execution role** is used at DEPLOYMENT - DOES need API Gateway permissions
- Our request was correct about needing permissions, but targeted the wrong role

### ✅ Updated Platform Pipeline Code

The platform team added API Gateway permissions to the CDK deployment role:

```typescript
cdkDeployProject.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'apigateway:GET',
    'apigateway:POST',
    'apigateway:PUT',
    'apigateway:PATCH',
    'apigateway:DELETE',
  ],
  resources: [
    `arn:aws:apigateway:${target.region}::/restapis/*`,
  ],
}));
```

### ⏳ Pending: Deploy Platform Pipeline

The platform team needs to deploy their updated platform pipeline:

```bash
cdk deploy PlatformPipelineStack
```

This will update all application pipelines with the new API Gateway permissions.

---

## What We've Already Done

### ✅ Fixed Frontend API Paths

Updated `frontend/src/services/claimApi.ts`:
- Changed `/api/patients` → `/patients`
- Changed `/api/claims` → `/claims`
- Fixed environment variable name: `REACT_APP_API_URL` → `REACT_APP_API_GATEWAY_URL`

### ✅ Correct CDK Stack Structure

Our CDK stack (`infrastructure/rag-application-stack.ts`) already follows the correct pattern:
- ✅ Imports platform-provided API Gateway (doesn't create new one)
- ✅ Uses platform-provided IAM role for Lambda functions
- ✅ Creates API Gateway Deployment (registers methods)
- ✅ Does NOT create Stage (platform team manages this)
- ✅ Uses Cognito authorizer on all methods

### ✅ Documentation Created

Created comprehensive documentation:
- `docs/platform-team-api-gateway-permissions.md` - Original request
- `docs/api-gateway-troubleshooting.md` - Troubleshooting guide
- `docs/platform-team-api-gateway-permissions-response.md` - Platform team's response

---

## What We Need to Do Next

### Step 1: Wait for Platform Team Deployment ⏳

**Status**: Waiting for platform team to deploy updated platform pipeline

**What they're deploying**:
- Updated application pipeline with API Gateway permissions
- CloudFormation execution role with proper permissions

**How we'll know it's done**:
- Platform team will notify us
- Or we can check if our next deployment succeeds

### Step 2: Trigger Redeployment 🚀

Once platform team confirms deployment:

```bash
# Option 1: Empty commit to trigger pipeline
git commit --allow-empty -m "Redeploy with API Gateway permissions"
git push origin main

# Option 2: Make a small change and push
# (e.g., update a comment in the CDK stack)
```

### Step 3: Monitor CloudFormation Deployment 👀

Watch the CloudFormation stack deployment:

```bash
# Check stack status
aws cloudformation describe-stacks --stack-name rag-app-development

# Watch stack events in real-time
aws cloudformation describe-stack-events \
  --stack-name rag-app-development \
  --max-items 20 \
  --query 'StackEvents[*].[Timestamp,ResourceStatus,ResourceType,LogicalResourceId,ResourceStatusReason]' \
  --output table
```

**What to look for**:
- ✅ API Gateway resources created successfully
- ✅ Lambda integrations configured
- ✅ Deployment created
- ✅ Stack status: `UPDATE_COMPLETE` or `CREATE_COMPLETE`

### Step 4: Verify API Gateway Methods 🔍

After successful deployment:

```bash
# List all resources in API Gateway
aws apigateway get-resources --rest-api-id wvbm6ooz1j

# Should show:
# - /patients
# - /patients/{patientId}
# - /claims
# - /claims/load
# - /claims/{claimId}/status
# - /customers
# - /documents
# - etc.
```

### Step 5: Test API Endpoints 🧪

Test that endpoints are accessible:

```bash
# Test patients endpoint (should return 401 Unauthorized, NOT "Missing Authentication Token")
curl -v https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients

# Expected response:
# HTTP/1.1 401 Unauthorized
# {"message":"Unauthorized"}

# This confirms:
# ✅ Route exists
# ✅ API Gateway is working
# ✅ Cognito authorization is configured
# ❌ Request lacks authentication token (expected)
```

**If you still see "Missing Authentication Token"**:
- Check CloudFormation stack events for errors
- Verify API Gateway resources were created
- Check if deployment was associated with the stage

### Step 6: Implement Cognito Authentication 🔐

Once API endpoints are accessible (returning 401), implement authentication:

#### 6.1 Install AWS Amplify

```bash
cd frontend
npm install aws-amplify @aws-amplify/ui-react
```

#### 6.2 Configure Amplify

Update `frontend/src/index.tsx`:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_WcelaDusa',
    userPoolWebClientId: '[get-from-platform-team]', // Need to get this
  }
});
```

#### 6.3 Update API Client

Update `frontend/src/services/claimApi.ts`:

```typescript
import { Auth } from 'aws-amplify';

// Replace getAuthToken function
const getAuthToken = async (): Promise<string | null> => {
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error) {
    console.error('Error getting auth token:', error);
    return null;
  }
};

// Update apiRequest to be async
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken(); // Now async
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // ... rest of the function
}
```

#### 6.4 Add Authentication UI

Add Amplify Authenticator to your app:

```typescript
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <h1>Hello {user?.username}</h1>
          <button onClick={signOut}>Sign out</button>
          {/* Your app components */}
        </main>
      )}
    </Authenticator>
  );
}
```

### Step 7: Test End-to-End 🎉

1. **Sign in** with Cognito user credentials
2. **Make API request** from frontend
3. **Verify** data is returned correctly
4. **Test** all API endpoints (patients, claims, etc.)

---

## Expected Timeline

| Step | Estimated Time | Status |
|------|---------------|--------|
| Platform team deploys pipeline | 15 minutes | ⏳ Waiting |
| App team triggers redeployment | 2 minutes | ⏳ Pending |
| Pipeline builds and deploys | 15 minutes | ⏳ Pending |
| Verify API Gateway methods | 5 minutes | ⏳ Pending |
| Test API endpoints | 5 minutes | ⏳ Pending |
| Implement Cognito auth | 30 minutes | ⏳ Pending |
| Test end-to-end | 15 minutes | ⏳ Pending |
| **Total** | **~1.5 hours** | |

---

## Troubleshooting

### If Deployment Still Fails

1. **Check CloudFormation events**:
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name rag-app-development \
     --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`]'
   ```

2. **Look for permission errors**:
   - `User is not authorized to perform: apigateway:POST`
   - `Access Denied` on API Gateway operations

3. **Verify platform team deployed**:
   - Ask platform team to confirm deployment
   - Check if other app teams can deploy successfully

### If API Still Returns "Missing Authentication Token"

1. **Check if methods exist**:
   ```bash
   aws apigateway get-resources --rest-api-id wvbm6ooz1j
   ```

2. **Check if deployment exists**:
   ```bash
   aws apigateway get-deployments --rest-api-id wvbm6ooz1j
   ```

3. **Check if stage is configured**:
   ```bash
   aws apigateway get-stage --rest-api-id wvbm6ooz1j --stage-name dev
   ```

4. **Verify deployment is associated with stage**:
   - The stage should reference the latest deployment ID
   - If not, platform team may need to update the stage

### If Authentication Fails

1. **Verify Cognito User Pool ID**:
   ```bash
   aws ssm get-parameter --name "/rag-app/dev/cognito/user-pool-id"
   ```

2. **Get Cognito Client ID**:
   ```bash
   aws ssm get-parameter --name "/rag-app/dev/cognito/client-id"
   ```

3. **Test with AWS CLI**:
   ```bash
   # Get JWT token
   aws cognito-idp initiate-auth \
     --auth-flow USER_PASSWORD_AUTH \
     --client-id [client-id] \
     --auth-parameters USERNAME=[username],PASSWORD=[password]

   # Use token to test API
   curl -H "Authorization: Bearer [jwt-token]" \
     https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
   ```

---

## Success Criteria

### ✅ Deployment Successful

- CloudFormation stack status: `UPDATE_COMPLETE`
- No errors in CloudFormation events
- All API Gateway resources created

### ✅ API Gateway Working

- API endpoints return `401 Unauthorized` (not "Missing Authentication Token")
- Methods are visible in API Gateway console
- Lambda integrations are configured

### ✅ Authentication Working

- Users can sign in with Cognito
- JWT tokens are generated
- API requests with tokens return `200 OK`
- Data is returned correctly

### ✅ End-to-End Working

- Frontend can fetch patient list
- Frontend can view patient details
- Frontend can load claims
- Frontend can check claim status

---

## Questions for Platform Team

Before we proceed, we need to clarify:

1. **Cognito Client ID**: What is the Cognito User Pool Client ID for the frontend?
   - We have the User Pool ID: `us-east-1_WcelaDusa`
   - Need the Client ID for Amplify configuration

2. **Stage Management**: Should we create a Stage resource in our CDK stack, or do you manage it?
   - Your example shows creating a Stage
   - Our current approach: Create Deployment only, you manage Stage
   - Which is correct?

3. **Deployment Confirmation**: How will you notify us when the platform pipeline is deployed?
   - Email notification?
   - Slack message?
   - Should we just try redeploying?

---

## Related Documentation

- `docs/platform-team-api-gateway-permissions-response.md` - Platform team's response
- `docs/api-gateway-troubleshooting.md` - Troubleshooting guide
- `infrastructure/rag-application-stack.ts` - Our CDK stack
- `frontend/src/services/claimApi.ts` - Frontend API client

---

**Last Updated**: 2026-03-11  
**Status**: Waiting for platform team to deploy updated platform pipeline  
**Next Action**: Platform team deploys, then we redeploy
