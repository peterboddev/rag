# Bugfix Requirements Document

## Introduction

The claim-loader Lambda function is failing to process documents with "Service failure" errors, and the error logs show empty error objects `{}`, making it impossible to diagnose the root cause. This bug affects the document processing pipeline, preventing medical claim documents from being loaded into the system. The issue stems from improper error serialization when AWS SDK errors occur during S3 copy operations or DynamoDB record creation.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an AWS SDK error occurs during document processing (S3 CopyObject or DynamoDB PutItem) THEN the system logs an empty error object `{}` in CloudWatch

1.2 WHEN Promise.allSettled catches a rejected promise from processDocument() THEN the system logs `result.reason` directly without serializing the Error object properties

1.3 WHEN developers review CloudWatch logs for failed document processing THEN the system provides no error message, error code, or stack trace information

1.4 WHEN the withRetry function catches and re-throws errors THEN the system loses error context because Error objects don't serialize to JSON properly

### Expected Behavior (Correct)

2.1 WHEN an AWS SDK error occurs during document processing THEN the system SHALL log the error with message, name, code, stack trace, and AWS-specific error details

2.2 WHEN Promise.allSettled catches a rejected promise from processDocument() THEN the system SHALL serialize the Error object to extract message, name, code, and stack properties before logging

2.3 WHEN developers review CloudWatch logs for failed document processing THEN the system SHALL provide complete error information including error type, message, and stack trace

2.4 WHEN the withRetry function catches and re-throws errors THEN the system SHALL preserve error context through proper error serialization in all log statements

### Unchanged Behavior (Regression Prevention)

3.1 WHEN document processing succeeds for valid documents THEN the system SHALL CONTINUE TO copy documents to the platform bucket and create DynamoDB records

3.2 WHEN retryable errors occur (throttling, network errors) THEN the system SHALL CONTINUE TO retry with exponential backoff

3.3 WHEN non-retryable errors occur THEN the system SHALL CONTINUE TO fail fast without retrying

3.4 WHEN processing documents in batches THEN the system SHALL CONTINUE TO use Promise.allSettled to process all documents even if some fail

3.5 WHEN the Lambda handler completes THEN the system SHALL CONTINUE TO return the correct HTTP status codes and response format
