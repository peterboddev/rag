// Frontend types for the document management system

export interface CustomerManagerRequest {
  customerEmail: string;
}

export interface CustomerManagerResponse {
  customerUUID: string;
  customerId: string;
  isNewCustomer: boolean;
}

export interface DocumentUploadRequest {
  customerUUID: string;
  fileName: string;
  contentType: string;
  fileData: string; // base64 encoded
}

export interface DocumentUploadResponse {
  documentId: string;
  s3Key: string;
  processingStatus: string;
  message: string;
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

export interface DocumentSummaryItem {
  documentId: string;
  fileName: string;
  contentType: string;
  createdAt: string;
  processingStatus: string;
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
];

export interface AuthContextType {
  tenantId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  createTenant: (companyName: string) => Promise<string>;
  joinTenant: (tenantId: string) => Promise<void>;
  signOut: () => void;
}

export interface UploadStatus {
  isUploading: boolean;
  progress: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

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
// Chunk Visualization Types
export interface DocumentChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  tokenCount: number;
  characterCount: number;
  sourceDocument: {
    documentId: string;
    fileName: string;
    pageNumber?: number;
    sectionTitle?: string;
  };
}

export interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  chunkingMethod: string;
  overlapStart?: number;
  overlapEnd?: number;
  confidence?: number;
  semanticBoundary?: boolean;
}

export interface ChunkVisualizationRequest {
  customerUUID: string;
  documentIds: string[];
  chunkingMethod?: ChunkingMethod;
}

export interface ChunkVisualizationResponse {
  chunks: DocumentChunk[];
  totalChunks: number;
  chunkingMethod: ChunkingMethod;
  processingTime: number;
  generatedAt: string;
}

export interface ChunkVisualizationError {
  documentId: string;
  fileName: string;
  errorMessage: string;
  errorType: 'chunking' | 'processing' | 'network';
  isRetryable: boolean;
}

// Component Props Interfaces
export interface ChunkVisualizationPanelProps {
  selectedDocuments: Set<string>;
  documents: DocumentSummaryItem[];
  chunkingMethod?: ChunkingMethod;
  customerUUID: string;
  tenantId: string;
  isLoading: boolean;
  onChunkSelect?: (chunkId: string) => void;
}

export interface ChunkItemProps {
  chunk: DocumentChunk;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: (chunkId: string) => void;
  onToggleExpand: (chunkId: string) => void;
}

export interface ChunkMetadataProps {
  chunk: DocumentChunk;
  showDetailed: boolean;
}

// State Interfaces
export interface ChunkVisualizationState {
  chunks: DocumentChunk[];
  isLoadingChunks: boolean;
  chunkError: string | null;
  selectedChunks: Set<string>;
  expandedChunks: Set<string>;
}


// Insurance Claim Portal Types
export interface PatientSummary {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claimCount: number;
}

export interface PatientListResponse {
  patients: PatientSummary[];
  nextToken?: string;
}

export interface ClaimSummary {
  claimId: string;
  documentCount: number;
  filingDate?: string;
  status?: string;
}

export interface PatientDetail {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claims: ClaimSummary[];
}

export interface LoadClaimResponse {
  jobId: string;
  status: string;
  message: string;
}

export interface ClaimStatusResponse {
  status: string;
  documentsProcessed: number;
  totalDocuments: number;
  errors?: string[];
}
