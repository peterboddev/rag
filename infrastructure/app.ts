#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultiTenantDocumentManagerStack } from './multi-tenant-document-manager-stack';

const app = new cdk.App();

// Get environment from context or use defaults for local development
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

new MultiTenantDocumentManagerStack(app, 'MultiTenantDocumentManagerStack', {
  env,
  description: 'Multi-tenant RAG document management system',
  
  // Stack tags
  tags: {
    Project: 'RAG-Platform',
    Component: 'DocumentManager',
    Environment: 'dev'
  }
});