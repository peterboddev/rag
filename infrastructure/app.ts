#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RAGApplicationStack } from './rag-application-stack';

const app = new cdk.App();

// Get environment from context
// Platform team passes this via: npx cdk deploy rag-app-{environment} -c environment={environment}
// Example: npx cdk deploy rag-app-staging -c environment=staging
const environment = app.node.tryGetContext('environment') || 'dev';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Stack name must match what platform pipeline expects
// Platform deploys with: npx cdk deploy rag-app-{environment}
// Examples: rag-app-development, rag-app-staging, rag-app-production
// Note: 'development' is used instead of 'dev' for consistency with platform naming
const environmentName = environment === 'dev' ? 'development' : environment;
const stackName = `rag-app-${environmentName}`;

new RAGApplicationStack(app, stackName, {
  env,
  description: 'RAG Application - Multi-tenant document management',
  
  // Stack tags
  tags: {
    Project: 'RAG-Platform',
    Component: 'Application',
    Environment: environment
  }
});