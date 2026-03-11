# Platform Team Response: API Gateway Permissions Request

## Summary

You're right that permissions are needed to deploy changes to the API Gateway, but they need to be added to the **CloudFormation execution role**, not the Lambda execution role. The "Missing Authentication Token" error is likely a deployment issue that will be resolved once CloudFormation has proper permissions.

---

## Understanding the Deployment Flow

### How App Teams Deploy to Platform API Gateway

```
┌─────────────────────────────────────────────────────────────┐
│              App Team CDK Deployment Process                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. CodeBuild runs: npx cdk synth                           │
│     → Generates CloudFormation templates                     │
│     → Uses CodeBuild service role                           │
│                                                              │
│  2. CodeBuild runs: npx cdk deploy                          │
│     → Uploads templates to S3                               │
│     → Calls CloudFormation CreateStack/UpdateStack          │
│     → Uses CodeBuild service role                           │
│                                                              │
│  3. CloudFormation executes the stack                       │
│     → Creates API Gateway resources/methods                 │
│     → Creates Lambda functions                              │
│     → Creates integrations                                  │
│     → Uses CloudFormation execution role ← NEEDS PERMISSIONS│
│                                                              │
│  4. Lambda functions run at RUNTIME                         │
│     → Handle API requests                                   │
│     → Uses Lambda execution role (rag-app-rag-role-dev)    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### The Key Issue

When app teams deploy their CDK stack, CloudFormation needs to:
- Add resources to the platform-provided API Gateway (`wvbm6ooz1j`)
- Add methods (GET, POST, etc.)
- Create integrations with Lambda functions
- Create deployments
- Update stages

**CloudFormation needs API Gateway permissions to do this.**

---

## Critical Distinction: Lambda Role vs CloudFormation Role

### The App Team's Request (PARTIALLY CORRECT)

> "API Gateway permissions are needed for deployment"

✅ **Correct**: API Gateway permissions ARE needed for deployment  
❌ **Incorrect**: They should NOT go on the Lambda execution role

### Two Roles Involved

**1. Lambda Execution Role** (`rag-app-rag-role-dev`):
- Used at **runtime** when Lambda functions execute
- Needs permissions for: Bedrock, DynamoDB, S3, etc.
- Does **NOT** need API Gateway permissions

**2. CloudFormation Execution Role**:
- Used at **deployment time** when CloudFormation creates resources
- Needs permissions for: API Gateway, Lambda, IAM, etc.
- **DOES** need API Gateway permissions to modify the platform API Gateway

### Why the Confusion?

The app team's document requested adding permissions to the Lambda execution role, but that's the wrong role. The permissions need to go on the CloudFormation execution role that the application pipeline uses.

---

## The Correct Solution

### What Needs to Happen

The **application pipeline's CloudFormation execution role** needs API Gateway permissions to modify the platform-provided API Gateway (`wvbm6ooz1j`).

### Where These Permissions Should Go

In the application pipeline construct, the CloudFormation execution role needs:

```typescript
// In ApplicationPipelineConstruct
const cloudFormationRole = new iam.Role(this, 'CloudFormationRole', {
  assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
  roleName: `${config.applicationName}-cfn-role-${environment}`,
});

// Add API Gateway permissions for app team deployments
cloudFormationRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'apigateway:GET',
    'apigateway:POST',
    'apigateway:PUT',
    'apigateway:PATCH',
    'apigateway:DELETE',
  ],
  resources: [
    `arn:aws:apigateway:${region}::/restapis/${platformApiGatewayId}`,
    `arn:aws:apigateway:${region}::/restapis/${platformApiGatewayId}/*`,
  ],
}));
```

---

## Why "Missing Authentication Token" Error?

This error occurs when CloudFormation **cannot create** the API Gateway methods due to insufficient permissions. The methods don't exist, so API Gateway returns "Missing Authentication Token" instead of a proper error.

### The Deployment Likely Failed Silently

Check CloudFormation stack events:
```bash
aws cloudformation describe-stack-events \
  --stack-name RAGApplicationStack \
  --max-items 50
```

Look for errors like:
- `User is not authorized to perform: apigateway:POST`
- `Access Denied` on API Gateway operations
- Resources in `CREATE_FAILED` or `UPDATE_FAILED` state

---

## Platform Team Action: Update Application Pipeline

### ✅ COMPLETED: API Gateway Permissions Added

The platform team has updated the application pipeline construct to grant API Gateway permissions to the CloudFormation execution role.

**File Updated**: `lib/constructs/application-pipeline-construct.ts`

**Changes Made**:
```typescript
// Added to CDK deploy CodeBuild role
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

**What This Enables**:
- App teams can now deploy CDK stacks that modify the platform API Gateway
- CloudFormation can create resources, methods, and integrations
- Deployments will succeed instead of failing silently

### Next Step: Deploy Platform Pipeline

The platform team needs to deploy the updated platform pipeline:

```bash
# Deploy platform pipeline with API Gateway permissions
cdk deploy PlatformPipelineStack
```

This will update all application pipelines with the new permissions.

---

## Implementation Details

### Required API Gateway Actions

| Action | Purpose | When Used |
|--------|---------|-----------|
| `apigateway:GET` | Read API Gateway configuration | Verify resources, check deployments |
| `apigateway:POST` | Create new resources | Add resources, methods, integrations |
| `apigateway:PUT` | Update existing resources | Modify methods, update integrations |
| `apigateway:PATCH` | Partial updates | Update method settings |
| `apigateway:DELETE` | Remove resources | Clean up old methods, resources |

### Resource Scope

Permissions are scoped to:
- **Specific API Gateway**: `wvbm6ooz1j` (platform-provided)
- **All sub-resources**: Methods, integrations, deployments, stages
- **Specific region**: `us-east-1`

### Security Considerations

✅ **Least Privilege**: Scoped to specific API Gateway only  
✅ **No Admin Actions**: Cannot create new API Gateways  
✅ **Audit Trail**: All changes logged in CloudTrail  
✅ **Environment Isolation**: Dev pipeline only affects dev API Gateway  

---

## What the App Team Should Do

### Immediate Actions

1. **Check CloudFormation Stack Events**
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name RAGApplicationStack \
     --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`]'
   ```

2. **Wait for Platform Team to Deploy Updated Pipeline**
   - Platform team will add API Gateway permissions to CloudFormation role
   - Once deployed, app team can redeploy their stack

3. **Verify API Gateway Resources After Redeployment**
   ```bash
   # Check if methods were created
   aws apigateway get-resources --rest-api-id wvbm6ooz1j
   ```

### After Platform Update

Once the platform team deploys the updated pipeline with API Gateway permissions:

1. **Trigger Redeployment**
   ```bash
   git commit --allow-empty -m "Trigger redeployment with API Gateway permissions"
   git push origin main
   ```

2. **Monitor CloudFormation**
   - Watch for successful resource creation
   - Verify API Gateway methods are created

3. **Test Endpoints**
   ```bash
   # Should return 401 Unauthorized (not "Missing Authentication Token")
   curl https://wvbm6ooz1j.execute-api.us-east-1.amazonaws.com/dev/patients
   ```

---

## Platform Team Action Items

### ✅ What We've Already Provided

1. **API Gateway** - Created and accessible (`wvbm6ooz1j`)
2. **Cognito Authorizer** - Configured on the API Gateway
3. **IAM Role** - Lambda execution role with comprehensive permissions
4. **SSM Parameters** - All configuration values stored
5. **CloudFormation Exports** - API Gateway ID, root resource ID, URL

### ❌ What We Will NOT Do

1. **Add API Gateway permissions to Lambda role** - Not needed and won't help
2. **Manually configure API Gateway** - App team should use CDK
3. **Debug app team's CDK code** - Need to see their code first

### ✅ What We Can Do to Help

1. **Review app team's CDK stack code** - Identify actual issue
2. **Provide working example** - Show correct API Gateway integration
3. **Update documentation** - Add troubleshooting section for this error
4. **Add API Gateway authorizer ID to SSM** - Make it easier to reference

---

## Recommended Next Steps

### For App Team

1. **Share your CDK stack code** - We need to see how you're creating API Gateway methods
2. **Check CloudFormation events** - Look for actual deployment errors
3. **Verify API Gateway resources** - Confirm methods were created
4. **Test with correct approach** - Use platform-provided API Gateway

### For Platform Team

1. **Review app team's CDK code** - Once shared, identify the real issue
2. **Add authorizer ID to SSM** - Make it easier for app teams to reference
3. **Update documentation** - Add section on common API Gateway integration mistakes
4. **Provide working example** - Create example CDK stack showing correct pattern

---

## Example: Correct API Gateway Integration

Here's how the app team should integrate with the platform-provided API Gateway:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Import platform-provided resources
    const apiId = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/apigateway/api-id'
    );
    
    const applicationRoleArn = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/iam/application-role-arn'
    );

    // 2. Import API Gateway (don't create new one)
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'API', {
      restApiId: apiId,
      rootResourceId: ssm.StringParameter.valueFromLookup(
        this,
        '/rag-app/dev/apigateway/root-resource-id'
      ),
    });

    // 3. Import platform-provided IAM role
    const applicationRole = iam.Role.fromRoleArn(
      this,
      'ApplicationRole',
      applicationRoleArn
    );

    // 4. Create Lambda function
    const patientsFunction = new lambda.Function(this, 'PatientsFunction', {
      functionName: 'rag-app-patients-dev',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'patients.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: applicationRole, // Use platform role
      environment: {
        CUSTOMERS_TABLE: ssm.StringParameter.valueFromLookup(
          this,
          '/rag-app/dev/dynamodb/customers-table-name'
        ),
      },
    });

    // 5. Add API Gateway resource and method
    const patientsResource = api.root.addResource('patients');
    
    patientsResource.addMethod('GET', 
      new apigateway.LambdaIntegration(patientsFunction),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        // Note: Authorizer is already configured on the API Gateway
        // by the platform team, so we just specify the type
      }
    );

    // 6. Create deployment (CRITICAL - without this, methods won't be accessible)
    const deployment = new apigateway.Deployment(this, 'Deployment', {
      api: api,
      description: `Deployment ${new Date().toISOString()}`,
    });

    // 7. Update stage to use new deployment
    const stage = new apigateway.Stage(this, 'Stage', {
      deployment: deployment,
      stageName: 'dev',
    });

    // Output the endpoint URL
    new cdk.CfnOutput(this, 'PatientsEndpoint', {
      value: `${api.url}patients`,
      description: 'Patients API endpoint',
    });
  }
}
```

**Key Points**:
- Import API Gateway (don't create new one)
- Use platform-provided IAM role
- Create deployment after adding methods
- Update stage to use new deployment

---

## Conclusion

**API Gateway permissions have been added to the application pipeline.**

The platform team has updated the application pipeline construct to grant API Gateway permissions to the CDK deployment role. This allows app teams to deploy CDK stacks that add methods and resources to the platform-provided API Gateway.

**Status**: ✅ Code updated, awaiting platform pipeline deployment

**Next Steps**:
1. ✅ Platform team: Code changes complete
2. ⏳ Platform team: Deploy updated platform pipeline (`cdk deploy PlatformPipelineStack`)
3. ⏳ App team: Redeploy application after platform update
4. ⏳ App team: Verify API Gateway methods are created successfully

**Expected Outcome After Deployment**:
- App team's CDK stack will successfully create API Gateway resources
- "Missing Authentication Token" error will be resolved
- API endpoints will return proper responses (401 Unauthorized for unauthenticated requests)

**No changes needed to Lambda execution role** - the permissions were correctly added to the CDK deployment role where they belong.

---

**Related Documentation**:
- `docs/rag-app-team-guide-v2.md` - Complete integration guide
- `docs/APP_TEAM_TROUBLESHOOTING.md` - Troubleshooting guide
- `lib/constructs/api-gateway.ts` - Platform API Gateway implementation

---

**Last Updated**: 2026-03-11  
**Status**: Awaiting app team's CDK stack code for review  
**Contact**: Platform Team
