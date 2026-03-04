# Design Document: AWS Security Agent Integration

## Overview

This design document describes the integration of AWS Security Agent into the multi-tenant document manager application to enable proactive security reviews and shift-left security practices. The integration focuses on early detection of security issues through automated design/spec reviews and code security analysis, while coordinating with the platform team for CI/CD integration, dependency scanning, and penetration testing.

AWS Security Agent is an AI-powered service that understands application context (design, code, security requirements) and provides automated security validation throughout the development lifecycle. This integration will catch security issues before they reach production, reducing the cost and risk of vulnerabilities.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Development Workflow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Spec/Design Phase                                           │
│     ├─ Create requirements.md                                   │
│     ├─ Create design.md                                         │
│     └─ Upload to AWS Security Agent ──────────┐                │
│                                                 │                │
│  2. Code Development Phase                     │                │
│     ├─ Write code                              │                │
│     ├─ Push to GitHub                          │                │
│     └─ AWS Security Agent reviews code ────────┤                │
│                                                 │                │
│  3. Platform Team Handoff                      │                │
│     ├─ CI/CD pipeline integration              │                │
│     ├─ Dependency scanning (SCA)               │                │
│     └─ Penetration testing                     │                │
│                                                 │                │
│                                                 ▼                │
│                        ┌────────────────────────────────┐       │
│                        │   AWS Security Agent           │       │
│                        │   (us-east-1)                  │       │
│                        ├────────────────────────────────┤       │
│                        │ - Agent Space                  │       │
│                        │ - Security Requirements        │       │
│                        │ - Design Review Engine         │       │
│                        │ - Code Review Engine           │       │
│                        │ - GitHub Integration           │       │
│                        │ - Findings Dashboard           │       │
│                        └────────────────────────────────┘       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Integration

```
┌──────────────────┐         ┌──────────────────┐
│  .kiro/specs/    │────────▶│  AWS Security    │
│  requirements.md │  Upload │  Agent           │
│  design.md       │         │  Design Review   │
└──────────────────┘         └──────────────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Security        │
                             │  Findings        │
                             └──────────────────┘

┌──────────────────┐         ┌──────────────────┐
│  GitHub          │────────▶│  AWS Security    │
│  Repository      │  Webhook│  Agent           │
│  (Code Push)     │         │  Code Review     │
└──────────────────┘         └──────────────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Pull Request    │
                             │  Comments        │
                             └──────────────────┘
```

## Components and Interfaces

### 1. AWS Security Agent Setup

**Component**: Agent Space Configuration

**Purpose**: Create and configure the AWS Security Agent environment for the application.

**Configuration**:
```typescript
// Agent Space Configuration
{
  agentSpaceName: "rag-document-manager-dev",
  description: "Security agent for RAG multi-tenant document manager",
  region: "us-east-1",
  authentication: "IAM-only", // For quick setup without SSO
  iamRole: "SecurityAgentExecutionRole"
}
```

**IAM Role Policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "securityagent:*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudtrail:LookupEvents",
        "cloudtrail:GetTrailStatus"
      ],
      "Resource": "*"
    }
  ]
}
```

### 2. Security Requirements Definition

**Component**: Organizational Security Requirements

**Purpose**: Define the security standards that all designs and code must comply with.

**Requirements Structure**:
```yaml
security_requirements:
  - id: SEC-001
    category: IAM
    title: Least Privilege Access
    description: All IAM roles must follow least privilege principle
    severity: Critical
    validation:
      - No wildcard (*) in IAM actions unless explicitly justified
      - Resource ARNs must be specific, not "*"
      - Time-bound credentials where applicable
  
  - id: SEC-002
    category: Encryption
    title: Data Encryption
    description: All data must be encrypted at rest and in transit
    severity: Critical
    validation:
      - DynamoDB tables use AWS_MANAGED encryption
      - S3 buckets use S3_MANAGED or KMS encryption
      - API Gateway uses TLS 1.2 or higher
      - No plaintext sensitive data in logs
  
  - id: SEC-003
    category: Input Validation
    title: Input Sanitization
    description: All user inputs must be validated and sanitized
    severity: High
    validation:
      - SQL injection prevention
      - XSS prevention
      - Command injection prevention
      - Path traversal prevention
  
  - id: SEC-004
    category: Authentication
    title: Authentication and Authorization
    description: All API endpoints must have proper authentication
    severity: Critical
    validation:
      - Cognito authorizer on API Gateway
      - JWT token validation
      - Multi-tenant isolation enforced
  
  - id: SEC-005
    category: Logging
    title: Security Logging
    description: Security-relevant events must be logged
    severity: Medium
    validation:
      - Authentication attempts logged
      - Authorization failures logged
      - Data access logged
      - CloudTrail enabled
  
  - id: SEC-006
    category: Multi-Tenancy
    title: Tenant Isolation
    description: Customer data must be isolated
    severity: Critical
    validation:
      - Tenant ID in all data access queries
      - No cross-tenant data leakage
      - Tenant-specific encryption keys where applicable
  
  - id: SEC-007
    category: API Security
    title: API Protection
    description: APIs must be protected against common attacks
    severity: High
    validation:
      - CORS properly configured
      - Rate limiting implemented
      - Request size limits enforced
      - API keys rotated regularly
  
  - id: SEC-008
    category: Secrets
    title: Secrets Management
    description: No hardcoded credentials or secrets
    severity: Critical
    validation:
      - No credentials in code
      - Use AWS Secrets Manager or Parameter Store
      - Environment variables for configuration
      - No secrets in logs or error messages
```

### 3. Design Security Review Integration

**Component**: Spec Document Review Workflow

**Purpose**: Automatically review design and requirements documents for security compliance.

**Workflow**:
1. Developer creates/updates spec documents in `.kiro/specs/`
2. Developer uploads design.md to AWS Security Agent Web Application
3. AWS Security Agent analyzes design against security requirements
4. Security findings are generated with severity and remediation guidance
5. Developer addresses findings before proceeding to implementation

**Upload Process**:
```typescript
// Manual upload via AWS Security Agent Web Application
// 1. Navigate to https://[agent-space-id].securityagent.aws.amazon.com
// 2. Select "Design Review" tab
// 3. Upload design.md file
// 4. Select security requirements to validate against
// 5. Click "Run Review"
// 6. Review findings and remediation guidance
```

**Example Design Review Finding**:
```json
{
  "findingId": "DR-2025-001",
  "severity": "High",
  "requirement": "SEC-001",
  "title": "IAM Role Uses Wildcard Actions",
  "description": "The Lambda execution role grants wildcard permissions to DynamoDB",
  "location": "design.md:145-152",
  "recommendation": "Specify exact DynamoDB actions needed: GetItem, PutItem, Query, Scan",
  "codeExample": "Replace 'dynamodb:*' with specific actions like 'dynamodb:GetItem', 'dynamodb:PutItem'"
}
```

### 4. Code Security Review Integration

**Component**: GitHub Integration for Automated Code Review

**Purpose**: Automatically scan code changes for security vulnerabilities when pushed to GitHub.

**GitHub Integration Setup**:
```typescript
// AWS Security Agent GitHub App Configuration
{
  githubOrg: "your-org",
  repository: "rag-document-manager",
  branch: "main",
  scanTriggers: ["push", "pull_request"],
  commentOnPR: true,
  blockMergeOnCritical: false, // Platform team handles blocking
  scanPaths: [
    "src/**/*.ts",
    "infrastructure/**/*.ts",
    "frontend/src/**/*.tsx"
  ],
  excludePaths: [
    "node_modules/**",
    "dist/**",
    "cdk.out/**",
    "tests_ongoing/**"
  ]
}
```

**Code Review Process**:
1. Developer pushes code to GitHub
2. GitHub webhook triggers AWS Security Agent
3. AWS Security Agent clones repository and scans code
4. Security findings are posted as PR comments
5. Developer addresses findings before merge

**Example Code Review Finding**:
```json
{
  "findingId": "CR-2025-042",
  "severity": "Critical",
  "requirement": "SEC-008",
  "title": "Hardcoded AWS Credentials Detected",
  "file": "src/lambda/document-processing.ts",
  "line": 23,
  "code": "const accessKey = 'AKIAIOSFODNN7EXAMPLE';",
  "recommendation": "Remove hardcoded credentials. Use IAM roles for Lambda functions.",
  "remediation": "Delete this line. Lambda functions automatically use their execution role credentials."
}
```

### 5. Security Findings Management

**Component**: Findings Dashboard and Tracking

**Purpose**: Centralize and track all security findings from design and code reviews.

**Findings Data Model**:
```typescript
interface SecurityFinding {
  findingId: string;
  type: 'design' | 'code';
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Informational';
  requirement: string; // SEC-XXX
  title: string;
  description: string;
  location: string; // File:line or design section
  status: 'Open' | 'In Progress' | 'Resolved' | 'Accepted Risk';
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  remediationGuidance: string;
  codeExample?: string;
}
```

**Findings Dashboard Access**:
- AWS Security Agent Web Application provides built-in dashboard
- Filter by severity, status, requirement, type
- Export findings to CSV for reporting
- Integration with GitHub Issues (optional)

### 6. Platform Team Coordination

**Component**: Handoff Documentation and Configuration

**Purpose**: Provide platform team with necessary information for CI/CD integration.

**Handoff Package**:
```yaml
# security-agent-config.yaml
agent_space:
  id: "rag-document-manager-dev"
  region: "us-east-1"
  
iam_role:
  arn: "arn:aws:iam::450683699755:role/SecurityAgentExecutionRole"
  
security_requirements:
  blocking_severities: ["Critical", "High"]
  allow_accepted_risks: true
  
code_review:
  github_app_installed: true
  scan_on_push: true
  comment_on_pr: true
  
ci_cd_integration:
  # Platform team implements
  pipeline_stage: "security-scan"
  fail_on_critical: true
  fail_on_high: false # Warning only
  
dependency_scanning:
  # Platform team implements
  tool: "AWS Inspector" # or AWS Security Agent SCA
  scan_package_json: true
  scan_package_lock_json: true
  block_critical_cves: true
  
penetration_testing:
  # Platform team implements
  frequency: "pre-production"
  scope:
    - api_gateway_endpoints
    - lambda_functions
    - dynamodb_tables
    - s3_buckets
```

## Data Models

### Agent Space Configuration
```typescript
interface AgentSpaceConfig {
  name: string;
  description: string;
  region: string;
  authentication: 'IAM' | 'SSO';
  iamRoleArn: string;
  createdAt: string;
  webAppUrl: string;
}
```

### Security Requirement
```typescript
interface SecurityRequirement {
  id: string; // SEC-XXX
  category: string;
  title: string;
  description: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  validation: string[];
  examples?: string[];
  references?: string[];
}
```

### Design Review Result
```typescript
interface DesignReviewResult {
  reviewId: string;
  documentName: string;
  uploadedAt: string;
  completedAt: string;
  status: 'Passed' | 'Failed' | 'Warning';
  findings: SecurityFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
  };
}
```

### Code Review Result
```typescript
interface CodeReviewResult {
  reviewId: string;
  commitSha: string;
  branch: string;
  triggeredAt: string;
  completedAt: string;
  status: 'Passed' | 'Failed' | 'Warning';
  findings: SecurityFinding[];
  filesScanned: number;
  linesScanned: number;
}
```

## Error Handling

### Design Review Errors
- **Invalid Document Format**: Return clear error message about expected format
- **Missing Security Requirements**: Prompt user to define requirements first
- **Upload Failure**: Retry with exponential backoff, log to CloudWatch
- **Review Timeout**: Set 5-minute timeout, notify user if exceeded

### Code Review Errors
- **GitHub Webhook Failure**: Log error, send notification to dev team
- **Repository Access Denied**: Verify GitHub App permissions, provide remediation steps
- **Scan Timeout**: Set 10-minute timeout for large repositories
- **False Positives**: Provide mechanism to mark findings as false positives

### General Error Handling
```typescript
class SecurityAgentError extends Error {
  constructor(
    public code: string,
    public message: string,
    public severity: 'Error' | 'Warning',
    public remediation: string
  ) {
    super(message);
  }
}

// Example usage
throw new SecurityAgentError(
  'DESIGN_REVIEW_FAILED',
  'Failed to analyze design document',
  'Error',
  'Verify document format and try again. Contact security team if issue persists.'
);
```

## Testing Strategy

### Manual Testing
- **Design Review Testing**: Upload sample design documents with known security issues
- **Code Review Testing**: Create test PRs with intentional vulnerabilities
- **Findings Management**: Verify findings appear correctly in dashboard
- **GitHub Integration**: Test webhook triggers and PR comments

### Documentation Testing
- **Setup Guide**: Follow setup guide from scratch to verify completeness
- **Security Requirements**: Validate all requirements are clear and testable
- **Remediation Guidance**: Verify remediation steps are actionable

### Integration Testing (Platform Team)
- **CI/CD Integration**: Verify security scans run in pipeline
- **Dependency Scanning**: Verify vulnerable packages are detected
- **Penetration Testing**: Verify pen tests execute successfully

### Compliance Testing
- **Audit Logs**: Verify all AWS Security Agent API calls logged to CloudTrail
- **Findings Retention**: Verify findings retained for compliance period
- **Coverage Reports**: Verify security review coverage metrics accurate

## Deployment Considerations

### Prerequisites
- AWS account with AWS Security Agent enabled (preview access)
- GitHub repository with admin access
- IAM permissions to create roles and policies
- Access to AWS Security Agent console (us-east-1)

### Deployment Steps
1. Create IAM role for AWS Security Agent
2. Create agent space in AWS Security Agent console
3. Define security requirements in agent space
4. Install GitHub App for code review integration
5. Document configuration for platform team
6. Train development team on workflows

### Rollback Plan
- AWS Security Agent is non-blocking during preview
- Can disable GitHub App integration without affecting development
- Can remove agent space if needed
- No infrastructure changes required for rollback

## Security Considerations

### Data Privacy
- Design documents may contain sensitive architecture information
- Code scanned by AWS Security Agent remains private
- AWS does not use customer data to train models
- All data encrypted in transit and at rest

### Access Control
- IAM-only access limits who can view findings
- GitHub App has read-only access to code
- Security findings visible only to authorized users
- Audit logs track all access to security data

### Compliance
- CloudTrail logs all AWS Security Agent API calls
- Findings retained for audit purposes
- Security review coverage tracked for compliance reporting
- Integration with existing compliance frameworks

## Cost Management

### Preview Period Pricing
- AWS Security Agent is free during preview period
- No charges for design reviews, code reviews, or findings storage
- Standard AWS costs apply (CloudTrail, IAM, etc.)

### Post-Preview Pricing (Estimated)
- Design reviews: Pay per review
- Code reviews: Pay per scan or monthly subscription
- Findings storage: Included in service cost
- Monitor usage and set budget alerts

### Cost Optimization
- Limit code scans to main branches and PRs
- Use design reviews for major features only
- Archive old findings to reduce storage
- Coordinate with platform team to avoid duplicate scanning
