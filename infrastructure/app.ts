#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RAGApplicationStack, RAGApplicationStackProps } from './rag-application-stack';

const app = new cdk.App();

// Get environment and applicationName from context
// Platform team passes this via: npx cdk deploy {applicationName}-{environment} -c environment={environment} -c applicationName={applicationName}
// Example: npx cdk deploy rag-app-staging -c environment=staging -c applicationName=rag-app
const environment = app.node.tryGetContext('environment') || 'dev';
const applicationName = app.node.tryGetContext('applicationName') || 'rag-app';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Stack name must match what platform pipeline expects
// Platform deploys with: npx cdk deploy {applicationName}-{environment}
// Examples: rag-app-development, rag-app-staging, medical-rag-production
// Note: 'development' is used instead of 'dev' for consistency with platform naming
const environmentName = environment === 'dev' ? 'development' : environment;
const stackName = `${applicationName}-${environmentName}`;

new RAGApplicationStack(app, stackName, {
  env,
  description: 'RAG Application - Multi-tenant document management',
  applicationName,
  
  // Stack tags
  tags: {
    Project: 'RAG-Platform',
    Component: 'Application',
    Environment: environment
  }
});