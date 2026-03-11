# Platform Team: Identity Pool Configuration Issue

## Issue

The Cognito Identity Pool is returning a 400 error: "Invalid identity pool configuration. Check assigned IAM roles for this pool."

**Identity Pool ID**: `us-east-1:d24b75c1-241d-4438-aba7-30277e1bcfe3`

## Root Cause

The Identity Pool exists but doesn't have IAM roles attached (or they're misconfigured). When users sign in, Amplify tries to exchange the User Pool JWT for temporary AWS credentials, but the Identity Pool can't provide them without knowing what permissions to grant.

## Impact

- **Console Error**: Users see a 400 error in browser console when signing in
- **Functionality**: API calls still work because we use JWT tokens directly (not AWS credentials)
- **User Experience**: No visible impact, but error logs are confusing

## Solution

The Identity Pool needs IAM roles attached. Here's what's required:

### Option 1: Configure Identity Pool Roles (Recommended if users need AWS service access)

```typescript
// Create authenticated role for Identity Pool
const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
  assumedBy: new iam.FederatedPrincipal(
    'cognito-identity.amazonaws.com',
    {
      StringEquals: {
        'cognito-identity.amazonaws.com:aud': identityPoolId,
      },
      'ForAnyValue:StringLike': {
        'cognito-identity.amazonaws.com:amr': 'authenticated',
      },
    },
    'sts:AssumeRoleWithWebIdentity'
  ),
  description: 'Role for authenticated Cognito users',
});

// Add minimal permissions (adjust based on needs)
authenticatedRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.Allow,
  actions: [
    // Add any AWS service permissions users need
    // For example, if users need to upload to S3:
    // 's3:PutObject',
    // 's3:GetObject',
  ],
  resources: [
    // Specify resources users can access
  ],
}));

// Attach role to Identity Pool
new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoles', {
  identityPoolId: identityPoolId,
  roles: {
    authenticated: authenticatedRole.roleArn,
  },
});
```

### Option 2: Remove Identity Pool (If not needed)

If users don't need direct AWS service access (they only use API Gateway), you can:

1. Remove the Identity Pool entirely
2. Update application to not configure `identityPoolId` in Amplify

**Note**: Our application only needs User Pool JWT tokens for API Gateway authentication, so the Identity Pool is optional.

## Current Workaround

The application continues to work because:
- We use Cognito User Pool JWT tokens for API Gateway authentication
- API Gateway doesn't require AWS credentials from Identity Pool
- The error is caught and doesn't break functionality

## Recommendation

**Option 1** if you plan to give users direct AWS service access in the future.
**Option 2** if users will only access AWS services through API Gateway.

## References

- [AWS Cognito Identity Pool Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools.html)
- [IAM Roles for Identity Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html)
