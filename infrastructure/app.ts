#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { RAGApplicationStack } from './rag-application-stack';

const app = new cdk.App();

// Get environment from context or use defaults for local development
const environment = app.node.tryGetContext('environment') || 'dev';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

new RAGApplicationStack(app, 'RAGApplicationStack', {
  env,
  description: 'RAG Application - Multi-tenant document management',
  
  // Stack tags
  tags: {
    Project: 'RAG-Platform',
    Component: 'Application',
    Environment: environment
  }
});