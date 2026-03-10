# Platform Team Action Required

## URGENT: Two Critical Issues Blocking Deployment

### Issue 1: CloudFormation Stack Stuck in ROLLBACK_COMPLETE State

**Stack Name**: `rag-app-development`  
**Status**: ROLLBACK_COMPLETE  
**Problem**: Cannot delete stack due to missing/invalid IAM role

#### Error Details

When attempting to delete the stack:
```
Role arn:aws:iam::450683699755:role/ApplicationPipelines-Appl-ragappPipelineDeployDevel-hFHWGvHEqaKk 
is invalid or cannot be assumed
```

**Current State:**
- All resources in the stack show `DELETE_COMPLETE` status
- Stack itself cannot be deleted
- User has `AWSAdministratorAccess` but CloudFormation enforces role-based deletion
- The pipeline role that created the stack no longer exists or cannot be assumed

#### Required Action

**Only the platform team can delete this stack** because:
1. The stack was created by a pipeline role
2. CloudFormation requires the same role (or service role) to delete it
3. Even administrator access cannot override this requirement

**Steps to resolve:**
1. Identify the correct service role or pipeline role that has permissions
2. Delete the stack using that role:
   ```bash
   aws cloudformation delete-stack --stack-name rag-app-development --role-arn <correct-role-arn>
   ```
3. Or manually delete via Console using the correct role
4. Verify stack is fully deleted before next deployment

#### Impact

- Deploy stage shows: `No stacks match the name(s) rag-app-development`
- Cannot proceed with deployment until stack is removed
- Blocking entire platform infrastructure migration

---

## Issue 2: CodeBuild Still Using Old Platform-Managed Buildspec

### Background

As part of the platform infrastructure migration, **buildspec ownership has transferred from platform team to application team**. The application team now maintains `buildspec.yml` in their repository.

### Problem

The CodeBuild project for `rag-app-build` is still configured to use the old platform-managed buildspec instead of the repository's `buildspec.yml`.

**Evidence:**
- Repository `buildspec.yml` has 13 commands in `post_build` phase
- CodeBuild logs show: `POST_BUILD: 1 commands` (old platform buildspec)
- Artifacts collection fails with: `Skipping invalid file path template.yaml`

### Root Cause

The CodeBuild project configuration still has the old buildspec override from when platform team controlled the build process. This override needs to be removed to allow the application team's buildspec to be used.

### Required Action

The platform team needs to **remove the buildspec override** from the CodeBuild project configuration:

#### Steps to Remove Buildspec Override

1. Go to AWS Console → CodeBuild → Projects → `rag-app-build`
2. Click "Edit" → "Buildspec"
3. Change from "Insert build commands" or custom buildspec to: **"Use a buildspec file"**
4. Set buildspec name to: `buildspec.yml` (default)
5. Remove any inline buildspec commands
6. Save changes

This will allow CodeBuild to use the `buildspec.yml` from the application repository.

#### Verification Command

```bash
# Check CodeBuild project configuration
aws codebuild batch-get-projects --names rag-app-build \
  --query 'projects[0].source.buildspec' --output text

# Should return empty string (uses repo buildspec.yml)
# If it returns YAML content, the override is still active
```

### Why This Change Was Made

As part of the platform infrastructure migration:
- **Before**: Platform team controlled buildspec, managed build/test/deploy process
- **After**: Application team controls buildspec, manages their own build/test/artifact generation
- **Platform team still manages**: Pipeline infrastructure, deployment stages, integration testing

This change gives application teams more flexibility to:
1. Customize build steps for their specific needs
2. Update dependencies and build tools independently
3. Control artifact generation format
4. Iterate faster without platform team coordination

### What Application Team Now Controls

The application team's `buildspec.yml` defines:
- Dependency installation (`npm ci`)
- Unit test execution (`npm run test`)
- TypeScript compilation (`npm run build`)
- CDK synthesis (`cdk synth`)
- Artifact generation (`template.yaml` creation)

### What Platform Team Still Controls

- CodeBuild project configuration (environment variables, IAM roles, VPC settings)
- Deployment stages (CloudFormation deployment, integration testing)
- Pipeline orchestration (triggering, stage transitions)
- Production release management

### Verification

After making changes, verify the buildspec is being used:

```bash
# Check CodeBuild project configuration
aws codebuild batch-get-projects --names rag-app-build \
  --query 'projects[0].source.buildspec' --output text

# Should return empty (uses repo buildspec) or show the override
```

### Current Impact

- ✅ Build phase completes successfully
- ✅ Unit tests pass
- ✅ CDK synthesis succeeds
- ❌ Deployment stage fails: `File [template.yaml] does not exist in artifact [BuildOutput]`

### Timeline

This is blocking application deployment as part of the platform infrastructure migration. Please prioritize removing the buildspec override.

### Migration Checklist for Platform Team

- [ ] Remove buildspec override from CodeBuild project
- [ ] Verify CodeBuild uses repository's `buildspec.yml`
- [ ] Confirm `template.yaml` is created in artifacts
- [ ] Verify deployment stage can find `template.yaml`
- [ ] Update any platform documentation referencing old buildspec management

### Contact

For questions about the application team's build requirements or the migration, contact the development team.

## Related Documentation

- [Project Guidelines](./.kiro/steering/project-guidelines.md) - Clarifies buildspec ownership
- [Pipeline Configuration](./pipeline-configuration.md) - Expected pipeline behavior
- [Deployment Guide](./deployment.md) - Full deployment process
