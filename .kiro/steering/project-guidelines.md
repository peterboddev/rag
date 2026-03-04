# Project Guidelines

## Project Overview

This application is part of a larger system that uses an external CI/CD pipeline for building, testing, and releasing. The application leverages AWS CDK to build infrastructure components and integrates with platform-managed services.

## Development Workflow

### Repository and Pipeline
- Developers push code to this repository
- External pipeline automatically triggers on code push
- CodeBuild handles building, testing, and integration testing
- Platform team manages the overall deployment pipeline

### Testing Strategy
- **Unit Tests**: Owned by this project, stored in `unit_tests/` directory
- **Integration Tests**: Owned and managed by platform team
- All unit tests must pass before code can be merged
- Focus on testing individual components and functions in isolation

## Infrastructure and Architecture

### CDK Usage
- Use AWS CDK to define infrastructure components
- Supported components include:
  - Lambda functions
  - API Gateway methods
  - RAG (Retrieval-Augmented Generation) systems
  - AI agents
  - Other AWS services as needed

### API Gateway Integration
- **Platform Responsibility**: API Gateway deployment and management
- **Developer Responsibility**: Adding and modifying API Gateway methods
- **Required**: API Gateway ID must be parameterized (received from platform team)
- **Pattern**: Use CDK parameters or environment variables for API Gateway ID

```typescript
// Example parameterization
const apiGatewayId = new CfnParameter(this, 'ApiGatewayId', {
  type: 'String',
  description: 'API Gateway ID provided by platform team'
});
```

## File Organization

### Documentation Structure
- **Root Level**: Only `README.md` allowed
- **Documentation**: All other `.md` files must be in `docs/` directory
- **Examples**:
  - ✅ `README.md` (root)
  - ✅ `docs/architecture.md`
  - ✅ `docs/deployment.md`
  - ❌ `CONTRIBUTING.md` (root) - should be `docs/CONTRIBUTING.md`

### Directory Structure
```
project-root/
├── README.md                 # Only md file in root
├── docs/                     # All other documentation
│   ├── architecture.md
│   ├── api-design.md
│   └── deployment.md
├── unit_tests/               # All unit tests
│   ├── test_lambda.py
│   └── test_api_methods.py
├── src/                      # Application source code
├── infrastructure/           # CDK infrastructure code
└── .kiro/
    └── steering/
        └── project-guidelines.md
```

## Development Environment Standards

### Runtime Requirements
- **Node.js Version**: 20.x LTS (required for all development and deployment)
- **npm Version**: 11.x (package manager)
- **TypeScript**: Latest stable version for type safety
- **AWS Lambda Runtime**: nodejs20.x (standardized across all functions)

### Version Compatibility
- All Lambda functions must use Node.js 20.x runtime
- Development environment should match production runtime
- Package.json engines field must specify Node.js 20.x minimum
- CDK constructs should specify nodejs20.x runtime explicitly

## Development Best Practices

### Code Quality
- Write comprehensive unit tests for all new functionality
- Follow CDK best practices for infrastructure as code
- Use TypeScript for CDK when possible for better type safety
- Implement proper error handling and logging
- Ensure all Lambda functions use Node.js 20.x runtime

### API Gateway Development
- Always parameterize API Gateway ID - never hardcode
- Document new API methods in `docs/api-design.md`
- Follow RESTful conventions for new endpoints
- Ensure proper authentication and authorization

### CDK Guidelines
- Use constructs appropriately (L1, L2, L3)
- Implement proper resource naming conventions
- Tag all resources appropriately
- Use environment-specific configurations

## Integration with Platform Team

### Responsibilities
- **Platform Team**: API Gateway deployment, integration testing, production deployment
- **Development Team**: Unit testing, CDK infrastructure definition, API method implementation
- **Shared**: API Gateway method definitions and configurations

### Communication
- API Gateway ID will be provided by platform team
- Coordinate with platform team for any breaking changes to API structure
- Platform team handles all integration test failures
- Report any infrastructure deployment issues to platform team

## Testing Requirements

### Unit Test Standards
- All tests in `unit_tests/` directory
- Test coverage should be comprehensive for business logic
- Mock external dependencies appropriately
- Use appropriate testing frameworks for your language choice
- Tests must be fast and reliable

### What NOT to Test
- Integration between services (platform team responsibility)
- End-to-end workflows (platform team responsibility)
- Infrastructure deployment (handled by pipeline)

## Deployment Process

1. Developer pushes code to repository
2. External pipeline triggers automatically
3. CodeBuild runs unit tests from `unit_tests/` directory
4. If unit tests pass, CDK infrastructure is synthesized
5. Platform team handles deployment and integration testing
6. Platform team manages production release

## Environment Configuration

- Use environment variables or CDK parameters for configuration
- Never hardcode environment-specific values
- API Gateway ID must be configurable
- Follow 12-factor app principles where applicable