/**
 * Bug Condition Exploration Test - Infrastructure Parameterization
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**
 *
 * Property 1: Fault Condition - Parameterized Resource Naming
 *
 * This test is EXPECTED TO FAIL on unfixed code. Failure confirms the bug exists:
 * - applicationName is hardcoded to 'rag-app' and not configurable via CDK context
 * - SOURCE_BUCKET Lambda env var is hardcoded with '-dev' suffix
 * - IAM policies reference hardcoded bucket names
 * - Stack name prefix is not derived from configurable applicationName
 *
 * Approach: We analyze the CDK source files directly because full CDK synthesis
 * triggers esbuild bundling which is too slow for unit tests. Source analysis
 * is a valid approach to confirm hardcoded values exist.
 *
 * DO NOT fix the test or the code when it fails.
 */
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

// Read the CDK source files once for all tests
const stackSource = fs.readFileSync(
  path.join(__dirname, '..', 'infrastructure', 'rag-application-stack.ts'),
  'utf-8',
);
const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'infrastructure', 'app.ts'),
  'utf-8',
);

describe('Bug Condition Exploration: Infrastructure Parameterization', () => {

  /**
   * Property 1a: applicationName MUST be read from CDK context, not hardcoded.
   *
   * For any custom applicationName provided via context, the stack should use it.
   * Current bug: `const applicationName = 'rag-app';` is hardcoded.
   *
   * EXPECTED: FAIL - applicationName is hardcoded, not read from context.
   */
  it('should read applicationName from CDK context (not hardcode it)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('medical-rag', 'claims-app', 'doc-manager'),
        (customAppName: string) => {
          // The stack source should read applicationName from context
          // Expected pattern: this.node.tryGetContext('applicationName') or similar
          const readsAppNameFromContext =
            stackSource.includes("tryGetContext('applicationName')") ||
            stackSource.includes('tryGetContext("applicationName")');

          // The stack should NOT have a hardcoded applicationName assignment
          const hasHardcodedAppName =
            /const\s+applicationName\s*=\s*['"][^'"]*['"]\s*;/.test(stackSource) &&
            !stackSource.includes("tryGetContext('applicationName')");

          if (!readsAppNameFromContext || hasHardcodedAppName) {
            throw new Error(
              `applicationName is hardcoded in the stack. ` +
              `Custom applicationName '${customAppName}' would be ignored. ` +
              `Found hardcoded: ${hasHardcodedAppName}, reads from context: ${readsAppNameFromContext}`,
            );
          }
        },
      ),
      { numRuns: 3 },
    );
  });

  /**
   * Property 1b: SOURCE_BUCKET Lambda env var MUST NOT be hardcoded with '-dev'.
   *
   * For any non-dev environment, SOURCE_BUCKET should adapt.
   * Current bug: SOURCE_BUCKET: 'medical-claims-synthetic-data-dev' is hardcoded.
   *
   * EXPECTED: FAIL - SOURCE_BUCKET contains hardcoded '-dev' suffix.
   */
  it('should not hardcode SOURCE_BUCKET with dev suffix in Lambda environment variables', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('staging', 'prod', 'test'),
        (targetEnv: string) => {
          // The stack should NOT have hardcoded 'medical-claims-synthetic-data-dev'
          // in Lambda environment variable assignments
          const hardcodedSourceBucket = stackSource.includes(
            "SOURCE_BUCKET: 'medical-claims-synthetic-data-dev'",
          );

          if (hardcodedSourceBucket) {
            throw new Error(
              `SOURCE_BUCKET is hardcoded to 'medical-claims-synthetic-data-dev'. ` +
              `Deploying to '${targetEnv}' would use the wrong bucket. ` +
              `SOURCE_BUCKET should be parameterized or derived from environment.`,
            );
          }
        },
      ),
      { numRuns: 3 },
    );
  });

  /**
   * Property 1c: Stack name in app.ts MUST derive prefix from configurable applicationName.
   *
   * Current bug: stackName uses hardcoded 'rag-app-' prefix, not from context.
   *
   * EXPECTED: FAIL - stack name prefix is hardcoded.
   */
  it('should derive stack name prefix from applicationName context variable', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('medical-rag', 'claims-app'),
        (customAppName: string) => {
          // app.ts should read applicationName from context
          const readsAppNameFromContext =
            appSource.includes("tryGetContext('applicationName')") ||
            appSource.includes('tryGetContext("applicationName")');

          // app.ts should NOT have hardcoded 'rag-app-' in stack name construction
          const hasHardcodedStackPrefix = appSource.includes('`rag-app-${');

          if (!readsAppNameFromContext || hasHardcodedStackPrefix) {
            throw new Error(
              `Stack name prefix is hardcoded to 'rag-app-' in app.ts. ` +
              `Custom applicationName '${customAppName}' would not change the stack name. ` +
              `Reads applicationName from context: ${readsAppNameFromContext}, ` +
              `has hardcoded prefix: ${hasHardcodedStackPrefix}`,
            );
          }
        },
      ),
      { numRuns: 2 },
    );
  });

  /**
   * Property 1d: IAM policy ARNs MUST NOT contain hardcoded bucket names.
   *
   * The sourceBucket import uses hardcoded 'medical-claims-synthetic-data-dev',
   * which means IAM policies generated via grantRead() will contain hardcoded ARNs.
   *
   * EXPECTED: FAIL - sourceBucket is imported with hardcoded name.
   */
  it('should not import source S3 bucket with hardcoded dev name for IAM policies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('staging', 'prod'),
        (targetEnv: string) => {
          // The stack should NOT import a bucket with hardcoded 'medical-claims-synthetic-data-dev'
          const hardcodedBucketImport = stackSource.includes(
            "fromBucketName(this, 'SourceBucket', 'medical-claims-synthetic-data-dev')",
          );

          if (hardcodedBucketImport) {
            throw new Error(
              `S3 bucket 'medical-claims-synthetic-data-dev' is imported with hardcoded name. ` +
              `IAM policies will reference 'arn:aws:s3:::medical-claims-synthetic-data-dev/*' ` +
              `even when deploying to '${targetEnv}'. ` +
              `Bucket name should be parameterized.`,
            );
          }
        },
      ),
      { numRuns: 2 },
    );
  });

  /**
   * Property 1e: Resource names with explicit bucketName/tableName MUST use
   * configurable applicationName, not hardcoded 'rag-app'.
   *
   * Resources like summary-content bucket and evaluation-results table
   * use `${applicationName}-...` but applicationName is hardcoded.
   *
   * EXPECTED: FAIL - applicationName is hardcoded so all derived names are too.
   */
  it('should allow custom applicationName to propagate to all resource names', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('medical-rag', 'doc-manager'),
        (customAppName: string) => {
          // If applicationName is hardcoded, then resources using it are also hardcoded
          const appNameMatch = stackSource.match(
            /const\s+applicationName\s*=\s*['"]([^'"]*)['"]/,
          );

          if (appNameMatch) {
            const hardcodedValue = appNameMatch[1];

            // Check that applicationName is derived from context, not a literal
            const isFromContext =
              stackSource.includes("tryGetContext('applicationName')") ||
              stackSource.includes('tryGetContext("applicationName")');

            if (!isFromContext) {
              throw new Error(
                `applicationName is hardcoded to '${hardcodedValue}'. ` +
                `Resources like '${hardcodedValue}-summary-cache-dev' and ` +
                `'${hardcodedValue}-evaluation-results-dev' cannot adapt to ` +
                `custom applicationName '${customAppName}'.`,
              );
            }
          }
        },
      ),
      { numRuns: 2 },
    );
  });

  /**
   * Property 1f: CfnOutput export names MUST use configurable applicationName.
   *
   * Exports like `${applicationName}-${environment}-documents-bucket` use
   * the hardcoded applicationName, making them non-configurable.
   *
   * EXPECTED: FAIL - applicationName is hardcoded.
   */
  it('should use configurable applicationName in CfnOutput export names', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('medical-rag', 'claims-app'),
        (customAppName: string) => {
          // Export names use `${applicationName}-${environment}-...`
          // If applicationName is hardcoded, exports are hardcoded too
          const appNameIsConfigurable =
            stackSource.includes("tryGetContext('applicationName')") ||
            stackSource.includes('tryGetContext("applicationName")') ||
            stackSource.includes('props.applicationName');

          if (!appNameIsConfigurable) {
            throw new Error(
              `CfnOutput export names use hardcoded applicationName. ` +
              `Exports will always use 'rag-app-' prefix regardless of ` +
              `custom applicationName '${customAppName}' being provided.`,
            );
          }
        },
      ),
      { numRuns: 2 },
    );
  });
});
