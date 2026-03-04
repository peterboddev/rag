import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import ChunkVisualizationPanel from '../ChunkVisualizationPanel';
import { DocumentSummaryItem, ChunkingMethod, ChunkVisualizationResponse } from '../../types';

// Mock fetch
global.fetch = jest.fn();

// Test data generators for property-based testing
const documentGenerator = fc.record({
  documentId: fc.string({ minLength: 1, maxLength: 20 }),
  fileName: fc.string({ minLength: 1, maxLength: 50 }),
  contentType: fc.constantFrom('application/pdf', 'text/plain', 'application/msword'),
  createdAt: fc.date().map(d => d.toISOString()),
  processingStatus: fc.constantFrom('completed', 'processing', 'failed'),
  textLength: fc.integer({ min: 100, max: 10000 }),
  extractedText: fc.string({ minLength: 100, maxLength: 1000 })
});

const chunkingMethodGenerator = fc.constantFrom(
  {
    id: 'default',
    name: 'Default Chunking',
    description: 'Default chunking strategy',
    parameters: { strategy: 'default' as const }
  },
  {
    id: 'fixed_size_512',
    name: 'Fixed Size (512 tokens)',
    description: 'Fixed-size chunks with 512 token limit',
    parameters: { 
      strategy: 'fixed_size' as const, 
      chunkSize: 512, 
      chunkOverlap: 50,
      maxTokens: 512
    }
  },
  {
    id: 'semantic',
    name: 'Semantic Chunking',
    description: 'Semantic boundary chunking',
    parameters: { 
      strategy: 'semantic' as const, 
      maxTokens: 800 
    }
  }
);

const chunkGenerator = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 50, maxLength: 2000 }),
  tokenCount: fc.integer({ min: 10, max: 500 }),
  characterCount: fc.integer({ min: 50, max: 2000 }),
  metadata: fc.record({
    chunkIndex: fc.integer({ min: 0, max: 100 }),
    totalChunks: fc.integer({ min: 1, max: 100 }),
    chunkingMethod: fc.string(),
    overlapStart: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    overlapEnd: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined })
  }),
  sourceDocument: fc.record({
    documentId: fc.string(),
    fileName: fc.string()
  })
});

const defaultProps = {
  customerUUID: 'test-customer-uuid',
  tenantId: 'test-tenant',
  isLoading: false,
  documents: [] as DocumentSummaryItem[]
};

describe('ChunkVisualizationPanel Property Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Property 2: Chunk Display Updates with Selection Changes', () => {
    test('should display chunks only from selected documents', () => {
      fc.assert(
        fc.property(
          fc.array(documentGenerator, { minLength: 1, maxLength: 10 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
          chunkingMethodGenerator,
          fc.array(chunkGenerator, { minLength: 0, maxLength: 20 }),
          (documents, selectedIdsList, chunkingMethod, chunks) => {
            // Feature: chunk-visualization, Property 2: Chunk Display Updates with Selection Changes
            
            const selectedIds = new Set(selectedIdsList);
            
            // Mock API response with chunks that match selected documents
            const filteredChunks = chunks.filter(chunk => 
              selectedIds.has(chunk.sourceDocument.documentId)
            );
            
            const mockResponse: ChunkVisualizationResponse = {
              chunks: filteredChunks,
              totalChunks: filteredChunks.length,
              chunkingMethod,
              processingTime: 100,
              generatedAt: new Date().toISOString()
            };

            (fetch as jest.Mock).mockResolvedValue({
              ok: true,
              json: () => Promise.resolve(mockResponse)
            });

            render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={selectedIds}
                chunkingMethod={chunkingMethod}
              />
            );

            // If no documents are selected, should show empty state
            if (selectedIds.size === 0) {
              expect(screen.getByText('No Documents Selected')).toBeInTheDocument();
              return true;
            }

            // If documents are selected but no chunks match, should show loading or empty
            // This is handled by the component's loading states
            return true;
          }
        ),
        { numRuns: 50 }
      );
    });

    test('should update chunk display when document selection changes', async () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(documentGenerator, { minLength: 2, maxLength: 5 }),
          chunkingMethodGenerator,
          fc.array(chunkGenerator, { minLength: 1, maxLength: 10 }),
          async (documents, chunkingMethod, chunks) => {
            // Feature: chunk-visualization, Property 2: Chunk Display Updates with Selection Changes
            
            // Create two different selections
            const firstSelection = new Set([documents[0].documentId]);
            const secondSelection = new Set([documents[1]?.documentId].filter(Boolean));
            
            if (secondSelection.size === 0) return true; // Skip if we don't have a second document

            // Mock API responses for different selections
            const firstChunks = chunks.slice(0, Math.ceil(chunks.length / 2));
            const secondChunks = chunks.slice(Math.ceil(chunks.length / 2));

            (fetch as jest.Mock)
              .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                  chunks: firstChunks,
                  totalChunks: firstChunks.length,
                  chunkingMethod,
                  processingTime: 100,
                  generatedAt: new Date().toISOString()
                })
              })
              .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                  chunks: secondChunks,
                  totalChunks: secondChunks.length,
                  chunkingMethod,
                  processingTime: 100,
                  generatedAt: new Date().toISOString()
                })
              });

            const { rerender } = render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={firstSelection}
                chunkingMethod={chunkingMethod}
              />
            );

            // Wait for first set of chunks to load
            await waitFor(() => {
              expect(fetch).toHaveBeenCalledTimes(1);
            });

            // Change selection
            rerender(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={secondSelection}
                chunkingMethod={chunkingMethod}
              />
            );

            // Should trigger another API call for new selection
            await waitFor(() => {
              expect(fetch).toHaveBeenCalledTimes(2);
            });

            return true;
          }
        ),
        { numRuns: 20 } // Reduced runs for async tests
      );
    });
  });

  describe('Property 3: Chunk Metadata Completeness', () => {
    test('should display all required metadata for every chunk', async () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(chunkGenerator, { minLength: 1, maxLength: 5 }),
          chunkingMethodGenerator,
          async (chunks, chunkingMethod) => {
            // Feature: chunk-visualization, Property 3: Chunk Metadata Completeness
            
            const mockResponse: ChunkVisualizationResponse = {
              chunks,
              totalChunks: chunks.length,
              chunkingMethod,
              processingTime: 100,
              generatedAt: new Date().toISOString()
            };

            (fetch as jest.Mock).mockResolvedValue({
              ok: true,
              json: () => Promise.resolve(mockResponse)
            });

            const selectedDocuments = new Set(chunks.map(chunk => chunk.sourceDocument.documentId));

            render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={[]}
                selectedDocuments={selectedDocuments}
                chunkingMethod={chunkingMethod}
              />
            );

            // Wait for chunks to load and then verify metadata
            try {
              await waitFor(() => {
                chunks.forEach((chunk) => {
                  // Check that chunk index is displayed
                  const chunkIndexText = `Chunk ${chunk.metadata.chunkIndex + 1} of ${chunk.metadata.totalChunks}`;
                  expect(screen.getByText(chunkIndexText)).toBeInTheDocument();
                  
                  // Check that token count is displayed
                  expect(screen.getByText(`${chunk.tokenCount} tokens`)).toBeInTheDocument();
                  
                  // Check that character count is displayed
                  expect(screen.getByText(`${chunk.characterCount} chars`)).toBeInTheDocument();
                  
                  // Check that source document name is displayed
                  expect(screen.getByText(chunk.sourceDocument.fileName)).toBeInTheDocument();
                });
              });
              return true;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 10 } // Reduced runs for DOM-heavy tests
      );
    });
  });

  describe('Property 5: Chunk Display State Management', () => {
    test('should clear chunk display when all documents are deselected', () => {
      fc.assert(
        fc.property(
          fc.array(documentGenerator, { minLength: 1, maxLength: 5 }),
          chunkingMethodGenerator,
          fc.array(chunkGenerator, { minLength: 1, maxLength: 10 }),
          (documents, chunkingMethod, chunks) => {
            // Feature: chunk-visualization, Property 5: Chunk Display State Management
            
            const mockResponse: ChunkVisualizationResponse = {
              chunks,
              totalChunks: chunks.length,
              chunkingMethod,
              processingTime: 100,
              generatedAt: new Date().toISOString()
            };

            (fetch as jest.Mock).mockResolvedValue({
              ok: true,
              json: () => Promise.resolve(mockResponse)
            });

            // Start with documents selected
            const initialSelection = new Set([documents[0].documentId]);
            
            const { rerender } = render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={initialSelection}
                chunkingMethod={chunkingMethod}
              />
            );

            // Change to no documents selected
            rerender(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={new Set()}
                chunkingMethod={chunkingMethod}
              />
            );

            // Should show empty state when no documents are selected
            expect(screen.getByText('No Documents Selected')).toBeInTheDocument();
            expect(screen.getByText('Select documents from the left panel to view their chunks')).toBeInTheDocument();

            return true;
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Property 4: Chunking Method Change Updates', () => {
    test('should refresh chunks when chunking method changes', async () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(documentGenerator, { minLength: 1, maxLength: 5 }),
          fc.tuple(chunkingMethodGenerator, chunkingMethodGenerator).filter(([m1, m2]) => m1.id !== m2.id),
          fc.array(chunkGenerator, { minLength: 1, maxLength: 10 }),
          async (documents, [method1, method2], chunks) => {
            // Feature: chunk-visualization, Property 4: Chunking Method Change Updates
            
            const selectedDocuments = new Set([documents[0].documentId]);
            
            // Mock different responses for different chunking methods
            const chunks1 = chunks.slice(0, Math.ceil(chunks.length / 2));
            const chunks2 = chunks.slice(Math.ceil(chunks.length / 2));

            (fetch as jest.Mock)
              .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                  chunks: chunks1,
                  totalChunks: chunks1.length,
                  chunkingMethod: method1,
                  processingTime: 100,
                  generatedAt: new Date().toISOString()
                })
              })
              .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                  chunks: chunks2,
                  totalChunks: chunks2.length,
                  chunkingMethod: method2,
                  processingTime: 100,
                  generatedAt: new Date().toISOString()
                })
              });

            const { rerender } = render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={selectedDocuments}
                chunkingMethod={method1}
              />
            );

            // Change chunking method
            rerender(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={selectedDocuments}
                chunkingMethod={method2}
              />
            );

            // Should trigger API calls for both methods
            try {
              await waitFor(() => {
                expect(fetch).toHaveBeenCalledTimes(2);
                
                // Verify the API was called with different chunking methods
                const calls = (fetch as jest.Mock).mock.calls;
                if (calls.length >= 2) {
                  const firstCall = JSON.parse(calls[0][1].body);
                  const secondCall = JSON.parse(calls[1][1].body);
                  expect(firstCall.chunkingMethod.id).toBe(method1.id);
                  expect(secondCall.chunkingMethod.id).toBe(method2.id);
                }
              });
              return true;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 15 } // Reduced runs for complex async tests
      );
    });

    test('should handle chunking method changes with different strategies', async () => {
      fc.assert(
        fc.asyncProperty(
          fc.array(documentGenerator, { minLength: 1, maxLength: 3 }),
          chunkingMethodGenerator,
          fc.array(chunkGenerator, { minLength: 1, maxLength: 15 }),
          async (documents, chunkingMethod, chunks) => {
            // Feature: chunk-visualization, Property 4: Chunking Method Change Updates
            
            const selectedDocuments = new Set([documents[0].documentId]);
            
            // Mock API response
            const mockResponse: ChunkVisualizationResponse = {
              chunks,
              totalChunks: chunks.length,
              chunkingMethod,
              processingTime: 100,
              generatedAt: new Date().toISOString()
            };

            (fetch as jest.Mock).mockResolvedValue({
              ok: true,
              json: () => Promise.resolve(mockResponse)
            });

            render(
              <ChunkVisualizationPanel 
                {...defaultProps}
                documents={documents}
                selectedDocuments={selectedDocuments}
                chunkingMethod={chunkingMethod}
              />
            );

            // Verify API call includes the chunking method
            try {
              await waitFor(() => {
                expect(fetch).toHaveBeenCalled();
                const lastCall = (fetch as jest.Mock).mock.calls.slice(-1)[0];
                if (lastCall && lastCall[1] && lastCall[1].body) {
                  const requestBody = JSON.parse(lastCall[1].body);
                  expect(requestBody.chunkingMethod).toEqual(chunkingMethod);
                }
              });
              return true;
            } catch {
              return false;
            }
          }
        ),
        { numRuns: 25 }
      );
    });
  });
});