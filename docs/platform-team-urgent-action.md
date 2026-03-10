# URGENT: Platform Team Action Required

## Summary

Two critical issues are blocking deployment of the RAG application. Both require platform team intervention.

---

## Issue 1: Delete Stuck CloudFormation Stack ⚠️ BLOCKING

**Stack Name**: `rag-app-development`  
**Current State**: ROLLBACK_COMPLETE  
**Problem**: Cannot be deleted - requires pipeline IAM role

### Error When Attempting Delete

```
Role arn:aws:iam::450683699755:role/ApplicationPipelines-Appl-ragappPipelineDeployDevel-hFHWGvHEqaKk 
is invalid or cannot be assumed
```

### Why Only Platform Team Can Fix This

- Stack was created by pipeline role
- CloudFormation enforces role-based deletion
- Application team has `AWSAdministratorAccess` but cannot override this
- Only platform team has access to the pipeline service role

### Required Action

Delete the stack using the pipeline service role:

```bash
# Option 1: Using service role
aws cloudformation delete-stack \
  --stack-name rag-app-development \
  --role-arn arn:aws:iam::450683699755:role/[correct-pipeline-role]

# Option 2: Via Console
# 1. Log in with pipeline role credentials
# 2. Go to CloudFormation console
# 3. Select rag-app-development stack
# 4. Click Delete
```

### Verification

```bash
# Confirm stack is deleted
aws cloudformation describe-stacks --stack-name rag-app-development
# Should return: "Stack with id rag-app-development does not exist"
```

### Current Impact

- Deploy stage fails: `No stacks match the name(s) rag-app-development`
- Cannot proceed with any deployment
- **BLOCKING entire platform infrastructure migration**

---

## Issue 2: Stack Name Mismatch

**Expected by Pipeline**: `rag-app-development`  
**Created by CDK**: `RAGApplicationStack`

### Required Action

After deleting the stuck stack (Issue 1), please confirm:

1. What stack name should the application use?
   - Option A: `rag-app-development` (matches pipeline expectation)
   - Option B: `rag-app-dev` (matches naming convention)
   - Option C: Something else?

2. Should we update our CDK code to match, or will you update the pipeline configuration?

### Application Team Will Update

Once you confirm the expected stack name, we will update `infrastructure/app.ts`:

```typescript
// Current (line 17)
new RAGApplicationStack(app, 'RAGApplicationStack', {

// Will change to (example)
new RAGApplicationStack(app, 'rag-app-development', {
```

---

## Timeline

**Priority**: URGENT - Blocking all deployments

**Estimated Time to Fix**:
- Issue 1 (Delete stack): 5 minutes
- Issue 2 (Confirm name): 1 minute

**Next Steps After Platform Team Action**:
1. Application team will update stack name in CDK code
2. Application team will push changes (including package-lock.json)
3. Pipeline will trigger automatically
4. Deployment should succeed

---

## Recent Changes (Context)

The application team has made the following changes to support the platform deployment process:

1. ✅ Updated `buildspec.yml` to include all files in artifacts (`**/*`)
2. ✅ Added `package-lock.json` (required for `npm ci` in deploy stage)
3. ✅ Committed changes (ready to push after stack deletion)

These changes align with the platform team's deployment process as documented in `docs/platform-team-response.md`.

---

## Contact

For questions or to confirm stack deletion, please contact the application development team.

**Related Documentation**:
- `docs/platform-team-action-required.md` - Full technical details
- `docs/platform-team-response.md` - Platform deployment process explanation
- `docs/rag-app-team-guide.md` - Integration guide

---

**Last Updated**: 2026-03-10  
**Status**: Awaiting platform team action
