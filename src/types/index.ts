// Core domain types for multi-tenant document management

export interface CustomerRecord {
  uuid: string; // Customer UUID (partition key for DynamoDB)
  tenantId: string; // For ABAC enforcement
  customerId: string; // Unique within tenant
  email: string;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
  
  // NEW: Chunking configuration fields
  chunkingMethod?: ChunkingMethod;
  chunkingConfigVersion?: number;
  lastChunkingUpdate?: string;
  chunkingCleanupStatus?: 'none' | 'in_progress' | 'completed' | 'failed';
  lastCleanupAt?: string;
}

export interface DocumentRecord {
  id: string; // Document ID (partition key)
  customerUuid: string; // Sort key for DynamoDB
  tenantId: string; // For ABAC enforcement
  fileName: string;
  s3Key: string;
  contentType: string;
  processingStatus: ProcessingStatus;
  extractedText?: string;
  textLength?: number;
  processingMetadata?: ProcessingMetadata;
  retryCount?: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
  processingStartedAt?: string;
  processingCompletedAt?: string;
  errorMessage?: string;
  
  // NEW: Chunking-related fields
  chunkingMethod?: ChunkingMethod;
  embeddingIds?: string[];    // References to embeddings in knowledge base
  lastEmbeddingUpdate?: string;
  embeddingStatus?: 'none' | 'pending' | 'completed' | 'failed';
  
  // NEW: Claim-related fields (optional, for insurance claim portal)
  claimMetadata?: ClaimMetadata;
}

export interface ClaimMetadata {
  patientId: string;           // TCIA patient ID
  patientName: string;         // From mapping.json
  tciaCollectionId: string;    // TCIA imaging collection
  claimId: string;             // Claim identifier
  documentType: 'CMS1500' | 'EOB' | 'Clinical Note' | 'Radiology Report';
  filingDate?: string;
  primaryDiagnosis?: string;
  claimedAmount?: number;
  approvedAmount?: number;
}

export type ProcessingStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface TenantInfo {
  tenantId: string;
  companyName: string;
  createdAt: string;
}

// API Request/Response types
export interface CustomerManagerRequest {
  tenantId: string;
  customerEmail: string;
}

export interface CustomerManagerResponse {
  customerUUID: string;
  customerId: string;
  isNewCustomer: boolean;
}

export interface DocumentUploadRequest {
  tenantId: string;
  customerUUID: string;
  fileName: string;
  contentType: string;
  fileData: string; // base64 encoded
}

export interface DocumentUploadResponse {
  documentId: string;
  s3Key: string;
  processingStatus: ProcessingStatus;
  message: string;
}

export interface DocumentProcessingEvent {
  s3Bucket: string;
  s3Key: string;
  customerUUID: string;
  tenantId: string;
  documentType: string;
  fileName: string;
}

export interface DocumentProcessingResponse {
  extractedText: string;
  processingStatus: ProcessingStatus;
  errorMessage?: string;
}

export interface DocumentSummaryRequest {
  customerEmail: string;
}

export interface DocumentSummaryResponse {
  customerUUID: string;
  customerEmail: string;
  documentCount: number;
  summary: string;
  documents: DocumentSummaryItem[];
}

// Token-aware summarization types
export interface TokenAwareSummaryResponse extends DocumentSummaryResponse {
  tokenUsage: TokenUsageInfo;
  truncationInfo: TruncationInfo;
  chunkingMethod: ChunkingMethod;
  processingMetadata: SummaryProcessingMetadata;
}

export interface TokenUsageInfo {
  maxTokensAllowed: number;
  tokensUsed: number;
  promptOverhead: number;
  contentTokens: number;
  utilizationPercentage: number;
}

export interface TruncationInfo {
  documentsProcessed: number;
  documentsTruncated: number;
  totalOriginalTokens: number;
  totalProcessedTokens: number;
  truncationStrategy: TruncationStrategy;
  truncationDetails: DocumentTruncationDetail[];
}

export interface DocumentTruncationDetail {
  documentId: string;
  fileName: string;
  originalTokens: number;
  processedTokens: number;
  truncationPercentage: number;
  contentPreserved: string[];
}

export interface SummaryProcessingMetadata {
  chunkingConfigRetrievalTime: number;
  tokenEstimationTime: number;
  textProcessingTime: number;
  summaryGenerationTime: number;
  totalProcessingTime: number;
  fallbacksUsed: string[];
  cacheHits: number;
}

export enum TruncationStrategy {
  BEGINNING_AND_END = 'beginning_and_end',
  BEGINNING_ONLY = 'beginning_only',
  SMART_EXCERPT = 'smart_excerpt',
  PROPORTIONAL = 'proportional'
}

export interface DocumentSummaryItem {
  documentId: string;
  fileName: string;
  contentType: string;
  createdAt: string;
  processingStatus: ProcessingStatus;
  extractedText?: string;
  textLength?: number;
  confidence?: number;
  pageCount?: number;
  textPreview?: string;
  errorMessage?: string;
  errorDetails?: string;
  retryCount?: number;
  maxRetries?: number;
  processingDurationMs?: number;
}

// Enhanced types for document selection and summary interface
export interface SelectiveSummaryRequest {
  customerEmail: string;
  documentIds: string[];
}

export interface SelectiveSummaryResponse {
  summary: string;
  includedDocuments: DocumentReference[];
  documentCount: number;
  totalTextLength: number;
  processingTime: number;
  generatedAt: string;
}

export interface DocumentReference {
  documentId: string;
  fileName: string;
  textLength: number;
}

// Knowledge Base Chunking Configuration Types
export interface ChunkingMethod {
  id: string;
  name: string;
  description: string;
  parameters: ChunkingParameters;
}

export interface ChunkingParameters {
  chunkSize?: number;
  chunkOverlap?: number;
  strategy: 'fixed_size' | 'semantic' | 'hierarchical' | 'default';
  maxTokens?: number;
}

export interface CleanupJobInfo {
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string;
  progress: number;           // 0-100
  embeddingsToRemove: number;
  embeddingsRemoved: number;
  errors: string[];
}

export interface ChunkingConfigurationRequest {
  customerUUID: string;
  chunkingMethod: ChunkingMethod;
}

export interface ChunkingConfigurationResponse {
  customerUUID: string;
  currentMethod: ChunkingMethod;
  availableMethods: ChunkingMethod[];
  cleanupRequired: boolean;
  lastUpdated?: string;
}

export interface EmbeddingCleanupRequest {
  customerUUID: string;
  force?: boolean;
}

export interface EmbeddingCleanupResponse {
  jobId: string;
  status: string;
  embeddingsToRemove: number;
  estimatedDuration: number;
  message: string;
  diagnostics?: {
    vectorDbConfigured: boolean;
    vectorDbIssue?: string;
    totalDocuments: number;
    documentsWithEmbeddings: number;
    documentsWithFailedEmbeddings: number;
    documentsWithoutEmbeddings: number;
    totalEmbeddingIds: number;
  };
}

export interface CleanupStatusResponse {
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  embeddingsRemoved: number;
  embeddingsToRemove: number;
  documentsReprocessed: number;
  errors: string[];
  startedAt: string;
  completedAt?: string;
}

// Supported AWS Bedrock Knowledge Base Chunking Methods
export const SUPPORTED_CHUNKING_METHODS: ChunkingMethod[] = [
  {
    id: 'default',
    name: 'Default Chunking',
    description: 'AWS Bedrock default chunking strategy with automatic optimization',
    parameters: { strategy: 'default' }
  },
  {
    id: 'fixed_size_512',
    name: 'Fixed Size (512 tokens)',
    description: 'Fixed-size chunks with 512 token limit and 50 token overlap',
    parameters: { 
      strategy: 'fixed_size', 
      chunkSize: 512, 
      chunkOverlap: 50,
      maxTokens: 512
    }
  },
  {
    id: 'fixed_size_1024',
    name: 'Fixed Size (1024 tokens)',
    description: 'Fixed-size chunks with 1024 token limit and 100 token overlap',
    parameters: { 
      strategy: 'fixed_size', 
      chunkSize: 1024, 
      chunkOverlap: 100,
      maxTokens: 1024
    }
  },
  {
    id: 'semantic',
    name: 'Semantic Chunking',
    description: 'Chunks based on semantic boundaries and document structure',
    parameters: { 
      strategy: 'semantic', 
      maxTokens: 800 
    }
  },
  {
    id: 'hierarchical',
    name: 'Hierarchical Chunking',
    description: 'Multi-level chunking for complex documents with nested structure',
    parameters: { 
      strategy: 'hierarchical', 
      chunkSize: 1024, 
      chunkOverlap: 200,
      maxTokens: 1024
    }
  }
] as const;

// Authentication types
export interface AuthContext {
  user: CognitoUser | null;
  tenantId: string;
  isAuthenticated: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  createTenant: (companyName: string) => Promise<string>;
  joinTenant: (tenantId: string) => Promise<void>;
}

export interface CognitoUser {
  username: string;
  email: string;
  tenantId: string;
}

// Error types
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId: string;
  };
}

// Supported file types
export const SUPPORTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/tiff'
] as const;

export const SUPPORTED_FILE_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif'
] as const;

export type SupportedFileType = typeof SUPPORTED_FILE_TYPES[number];
export type SupportedFileExtension = typeof SUPPORTED_FILE_EXTENSIONS[number];

// Enhanced PDF processing types
export interface ProcessingMetadata {
  pdfVersion?: string;
  pageCount?: number;
  isEncrypted: boolean;
  hasTextContent: boolean;
  textractJobId?: string;
  processingMode: 'sync' | 'async';
  confidence?: number;
  processingDurationMs?: number;
  textPreview?: string;
  errorDetails?: ErrorDetails;
  retryHistory: RetryAttempt[];
}

export interface ErrorDetails {
  errorCode: string;
  errorMessage: string;
  errorType: 'validation' | 'textract' | 'processing' | 'system';
  suggestedAction: string;
  isRetryable: boolean;
}

export interface RetryAttempt {
  attemptNumber: number;
  timestamp: string;
  errorMessage: string;
  nextRetryAt?: string;
}

export interface PDFValidationResult {
  isValid: boolean;
  pdfVersion?: string;
  isEncrypted: boolean;
  hasTextContent: boolean;
  pageCount: number;
  fileSizeBytes: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  suggestedAction?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestedAction?: string;
}

export interface TextractExtractionParams {
  s3Bucket: string;
  s3Key: string;
  documentType: 'simple' | 'forms' | 'tables';
  processingMode: 'sync' | 'async';
  maxPages?: number;
}

export interface TextractResult {
  extractedText: string;
  confidence: number;
  pageCount: number;
  processingTime: number;
  textBlocks: any[];
  forms?: any[];
  tables?: any[];
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

// Utility functions
export const isTextDocument = (contentType: string): boolean => {
  return contentType === 'text/plain';
};

export const requiresTextract = (contentType: string): boolean => {
  return !isTextDocument(contentType) && SUPPORTED_FILE_TYPES.includes(contentType as SupportedFileType);
};

export const validateFileType = (fileName: string, contentType: string): { isValid: boolean; error?: string } => {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  
  if (!SUPPORTED_FILE_EXTENSIONS.includes(extension as SupportedFileExtension)) {
    return {
      isValid: false,
      error: `Unsupported file extension: ${extension}. Supported types: ${SUPPORTED_FILE_EXTENSIONS.join(', ')}`
    };
  }
  
  if (!SUPPORTED_FILE_TYPES.includes(contentType as SupportedFileType)) {
    return {
      isValid: false,
      error: `Unsupported content type: ${contentType}`
    };
  }
  
  return { isValid: true };
};