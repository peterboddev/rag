# Cognito Configuration for RAG Application

## Summary

Complete Cognito configuration details for the RAG application development environment.

---

## Cognito Resources

### User Pool

- **User Pool ID**: `us-east-1_WcelaDusa`
- **User Pool Name**: `rag-app-users-dev`
- **ARN**: `arn:aws:cognito-idp:us-east-1:450683699755:userpool/us-east-1_WcelaDusa`
- **Region**: `us-east-1`

### User Pool Client (Web)

- **Client ID**: `3ttm9u94lgpjqlp8uvmns6a69h`
- **Client Name**: `rag-app-web-client-dev`
- **Auth Flows**: 
  - `ALLOW_USER_PASSWORD_AUTH` (username/password)
  - `ALLOW_USER_SRP_AUTH` (Secure Remote Password)
  - `ALLOW_REFRESH_TOKEN_AUTH` (refresh tokens)

### Identity Pool

- **Identity Pool ID**: `us-east-1:d24b75c1-241d-4438-aba7-30277e1bcfe3`

### OAuth Configuration

- **Callback URLs**: `https://rag-app-website-dev.s3-website-us-east-1.amazonaws.com`
- **Logout URLs**: `https://rag-app-website-dev.s3-website-us-east-1.amazonaws.com`
- **OAuth Flows**: `code` (Authorization Code Grant)
- **OAuth Scopes**: `email`, `openid`, `profile`

---

## User Pool Settings

### Password Policy

- **Minimum Length**: 8 characters
- **Requires**: Uppercase, lowercase, numbers, symbols
- **Temporary Password Validity**: 7 days

### Sign-In Configuration

- **Allowed Attributes**: Email (alias)
- **Auto-Verified Attributes**: Email
- **MFA**: OFF (disabled)

### User Creation

- **Admin Create Only**: Yes (users must be created by admin)
- **Unused Account Validity**: 7 days

### Account Recovery

- **Recovery Method**: Verified email

---

## Frontend Configuration

### Environment Variables

Add these to `frontend/.env`:

```bash
REACT_APP_API_GATEWAY_URL=https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev
REACT_APP_USER_POOL_ID=us-east-1_WcelaDusa
REACT_APP_USER_POOL_CLIENT_ID=3ttm9u94lgpjqlp8uvmns6a69h
REACT_APP_IDENTITY_POOL_ID=us-east-1:d24b75c1-241d-4438-aba7-30277e1bcfe3
REACT_APP_REGION=us-east-1
```

### AWS Amplify Configuration

Configure Amplify in `frontend/src/index.tsx`:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_REGION || 'us-east-1',
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_USER_POOL_CLIENT_ID,
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
    mandatorySignIn: true,
    authenticationFlowType: 'USER_PASSWORD_AUTH',
  },
  API: {
    endpoints: [
      {
        name: 'RAGApi',
        endpoint: process.env.REACT_APP_API_GATEWAY_URL,
        region: process.env.REACT_APP_REGION || 'us-east-1',
      },
    ],
  },
});
```

---

## User Management

### Creating Test Users

Since the user pool is configured for admin-only user creation, you need to create users via AWS CLI or Console:

#### Via AWS CLI

```bash
# Create a user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_WcelaDusa \
  --username testuser@example.com \
  --user-attributes Name=email,Value=testuser@example.com Name=email_verified,Value=true \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_WcelaDusa \
  --username testuser@example.com \
  --password "MySecurePass123!" \
  --permanent
```

#### Via AWS Console

1. Go to Amazon Cognito console
2. Select user pool: `rag-app-users-dev`
3. Click "Create user"
4. Enter email and temporary password
5. User will be prompted to change password on first sign-in

### Listing Users

```bash
# List all users
aws cognito-idp list-users \
  --user-pool-id us-east-1_WcelaDusa

# Get specific user
aws cognito-idp admin-get-user \
  --user-pool-id us-east-1_WcelaDusa \
  --username testuser@example.com
```

### Deleting Users

```bash
aws cognito-idp admin-delete-user \
  --user-pool-id us-east-1_WcelaDusa \
  --username testuser@example.com
```

---

## Authentication Flow

### 1. User Sign-In

```typescript
import { Auth } from 'aws-amplify';

async function signIn(username: string, password: string) {
  try {
    const user = await Auth.signIn(username, password);
    console.log('Sign in successful:', user);
    return user;
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  }
}
```

### 2. Get Current Session

```typescript
async function getCurrentSession() {
  try {
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();
    const accessToken = session.getAccessToken().getJwtToken();
    const refreshToken = session.getRefreshToken().getToken();
    
    return { idToken, accessToken, refreshToken };
  } catch (error) {
    console.error('Session error:', error);
    return null;
  }
}
```

### 3. Make Authenticated API Requests

```typescript
async function makeAuthenticatedRequest(endpoint: string) {
  try {
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();
    
    const response = await fetch(
      `${process.env.REACT_APP_API_GATEWAY_URL}${endpoint}`,
      {
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    return await response.json();
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}
```

### 4. Sign Out

```typescript
async function signOut() {
  try {
    await Auth.signOut();
    console.log('Sign out successful');
  } catch (error) {
    console.error('Sign out error:', error);
  }
}
```

---

## Token Information

### ID Token

- **Purpose**: Contains user identity information
- **Use**: Send to API Gateway for authorization
- **Validity**: Configurable (default: 1 hour)
- **Format**: JWT with user attributes (email, sub, etc.)

### Access Token

- **Purpose**: Grants access to resources
- **Use**: Access AWS resources via Identity Pool
- **Validity**: Configurable (default: 1 hour)

### Refresh Token

- **Purpose**: Obtain new ID and Access tokens
- **Validity**: 30 days (configured)
- **Use**: Automatically handled by Amplify

---

## Testing Authentication

### 1. Create Test User

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_WcelaDusa \
  --username test@example.com \
  --user-attributes Name=email,Value=test@example.com Name=email_verified,Value=true \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_WcelaDusa \
  --username test@example.com \
  --password "TestPass123!" \
  --permanent
```

### 2. Get JWT Token via CLI

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 3ttm9u94lgpjqlp8uvmns6a69h \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TestPass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text
```

### 3. Test API with Token

```bash
# Get token
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 3ttm9u94lgpjqlp8uvmns6a69h \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TestPass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# Test API endpoint
curl -H "Authorization: Bearer $TOKEN" \
  https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
```

Expected response: `200 OK` with patient data (or empty array if no data)

---

## Troubleshooting

### "User does not exist" Error

**Cause**: User hasn't been created in the user pool

**Solution**: Create user via AWS CLI or Console (see User Management section)

### "Incorrect username or password" Error

**Cause**: Wrong credentials or user status issue

**Solution**:
1. Verify user exists: `aws cognito-idp admin-get-user --user-pool-id us-east-1_WcelaDusa --username [email]`
2. Check user status (should be `CONFIRMED`)
3. Reset password if needed

### "User is not confirmed" Error

**Cause**: User hasn't verified email or completed sign-up

**Solution**:
```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_WcelaDusa \
  --username [email]
```

### "Invalid session" Error

**Cause**: Token expired or invalid

**Solution**: Sign in again to get new tokens

### API Returns 401 with Valid Token

**Possible causes**:
1. Token from wrong user pool
2. API Gateway authorizer misconfigured
3. Token expired

**Solution**:
1. Verify token is from correct user pool: `us-east-1_WcelaDusa`
2. Check token expiration
3. Verify API Gateway authorizer configuration

---

## Security Best Practices

### 1. Never Commit Credentials

- Add `.env` to `.gitignore`
- Never commit user passwords
- Use environment variables for configuration

### 2. Use HTTPS Only

- All API requests must use HTTPS
- Cognito hosted UI uses HTTPS by default

### 3. Implement Token Refresh

- Amplify handles this automatically
- Refresh tokens before expiration
- Handle token refresh failures gracefully

### 4. Secure Token Storage

- Amplify stores tokens securely in browser
- Don't store tokens in localStorage manually
- Use Amplify's built-in token management

### 5. Implement Sign-Out

- Always provide sign-out functionality
- Clear all tokens on sign-out
- Redirect to sign-in page after sign-out

---

## Related Documentation

- `docs/api-gateway-deployment-success.md` - API Gateway configuration
- `frontend/.env` - Environment variables (not committed)
- AWS Amplify Documentation: https://docs.amplify.aws/

---

**Last Updated**: 2026-03-11  
**Environment**: Development (`dev`)  
**Status**: ✅ Configuration complete, ready for implementation
