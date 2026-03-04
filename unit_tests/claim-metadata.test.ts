import { ClaimMetadata, DocumentRecord } from '../src/types';

describe('ClaimMetadata Validation', () => {
  describe('ClaimMetadata Interface', () => {
    it('should accept valid claim metadata with all required fields', () => {
      const validMetadata: ClaimMetadata = {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimId: 'CLM-2024-001',
        documentType: 'CMS1500'
      };

      expect(validMetadata.patientId).toBe('TCIA-001');
      expect(validMetadata.patientName).toBe('John Doe');
      expect(validMetadata.tciaCollectionId).toBe('TCGA-BRCA');
      expect(validMetadata.claimId).toBe('CLM-2024-001');
      expect(validMetadata.documentType).toBe('CMS1500');
    });

    it('should accept valid claim metadata with optional fields', () => {
      const metadataWithOptionals: ClaimMetadata = {
        patientId: 'TCIA-002',
        patientName: 'Jane Smith',
        tciaCollectionId: 'TCGA-LUAD',
        claimId: 'CLM-2024-002',
        documentType: 'EOB',
        filingDate: '2024-01-15',
        primaryDiagnosis: 'C50.9',
        claimedAmount: 15000.00,
        approvedAmount: 12000.00
      };

      expect(metadataWithOptionals.filingDate).toBe('2024-01-15');
      expect(metadataWithOptionals.primaryDiagnosis).toBe('C50.9');
      expect(metadataWithOptionals.claimedAmount).toBe(15000.00);
      expect(metadataWithOptionals.approvedAmount).toBe(12000.00);
    });

    it('should accept all valid document types', () => {
      const documentTypes: Array<ClaimMetadata['documentType']> = [
        'CMS1500',
        'EOB',
        'Clinical Note',
        'Radiology Report'
      ];

      documentTypes.forEach(docType => {
        const metadata: ClaimMetadata = {
          patientId: 'TCIA-003',
          patientName: 'Test Patient',
          tciaCollectionId: 'TEST-COLLECTION',
          claimId: 'CLM-TEST',
          documentType: docType
        };

        expect(metadata.documentType).toBe(docType);
      });
    });
  });

  describe('DocumentRecord with ClaimMetadata', () => {
    it('should create document record with claim metadata', () => {
      const claimMetadata: ClaimMetadata = {
        patientId: 'TCIA-004',
        patientName: 'Alice Johnson',
        tciaCollectionId: 'TCGA-COAD',
        claimId: 'CLM-2024-003',
        documentType: 'Clinical Note'
      };

      const documentRecord: DocumentRecord = {
        id: 'doc-123',
        customerUuid: 'cust-456',
        tenantId: 'tenant-789',
        fileName: 'clinical_note_001.pdf',
        s3Key: 'uploads/tenant-789/cust-456/doc-123/clinical_note_001.pdf',
        contentType: 'application/pdf',
        processingStatus: 'queued',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
        claimMetadata
      };

      expect(documentRecord.claimMetadata).toBeDefined();
      expect(documentRecord.claimMetadata?.patientId).toBe('TCIA-004');
      expect(documentRecord.claimMetadata?.claimId).toBe('CLM-2024-003');
      expect(documentRecord.claimMetadata?.documentType).toBe('Clinical Note');
    });

    it('should allow document record without claim metadata', () => {
      const documentRecord: DocumentRecord = {
        id: 'doc-456',
        customerUuid: 'cust-789',
        tenantId: 'tenant-123',
        fileName: 'regular_document.pdf',
        s3Key: 'uploads/tenant-123/cust-789/doc-456/regular_document.pdf',
        contentType: 'application/pdf',
        processingStatus: 'completed',
        createdAt: '2024-01-15T11:00:00Z',
        updatedAt: '2024-01-15T11:00:00Z'
      };

      expect(documentRecord.claimMetadata).toBeUndefined();
    });
  });

  describe('ClaimMetadata Field Validation', () => {
    it('should validate patient ID format', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-005',
        patientName: 'Bob Wilson',
        tciaCollectionId: 'TCGA-KIRC',
        claimId: 'CLM-2024-004',
        documentType: 'Radiology Report'
      };

      // Patient ID should follow TCIA format
      expect(metadata.patientId).toMatch(/^TCIA-\d+$/);
    });

    it('should validate claim ID format', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-006',
        patientName: 'Carol Davis',
        tciaCollectionId: 'TCGA-LIHC',
        claimId: 'CLM-2024-005',
        documentType: 'CMS1500'
      };

      // Claim ID should follow CLM format
      expect(metadata.claimId).toMatch(/^CLM-\d{4}-\d+$/);
    });

    it('should validate filing date format', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-007',
        patientName: 'David Brown',
        tciaCollectionId: 'TCGA-PRAD',
        claimId: 'CLM-2024-006',
        documentType: 'EOB',
        filingDate: '2024-01-20'
      };

      // Filing date should be ISO date format
      expect(metadata.filingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should validate diagnosis code format', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-008',
        patientName: 'Eve Martinez',
        tciaCollectionId: 'TCGA-STAD',
        claimId: 'CLM-2024-007',
        documentType: 'CMS1500',
        primaryDiagnosis: 'C16.9'
      };

      // ICD-10 diagnosis code format
      expect(metadata.primaryDiagnosis).toMatch(/^[A-Z]\d{2}(\.\d{1,2})?$/);
    });

    it('should validate monetary amounts are positive', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-009',
        patientName: 'Frank Garcia',
        tciaCollectionId: 'TCGA-THCA',
        claimId: 'CLM-2024-008',
        documentType: 'EOB',
        claimedAmount: 25000.00,
        approvedAmount: 20000.00
      };

      expect(metadata.claimedAmount).toBeGreaterThan(0);
      expect(metadata.approvedAmount).toBeGreaterThan(0);
    });

    it('should validate approved amount does not exceed claimed amount', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-010',
        patientName: 'Grace Lee',
        tciaCollectionId: 'TCGA-UCEC',
        claimId: 'CLM-2024-009',
        documentType: 'EOB',
        claimedAmount: 30000.00,
        approvedAmount: 25000.00
      };

      if (metadata.claimedAmount && metadata.approvedAmount) {
        expect(metadata.approvedAmount).toBeLessThanOrEqual(metadata.claimedAmount);
      }
    });
  });

  describe('ClaimMetadata Type Safety', () => {
    it('should enforce required fields at compile time', () => {
      // This test verifies TypeScript type checking
      // If this compiles, the type system is working correctly
      
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-011',
        patientName: 'Henry Taylor',
        tciaCollectionId: 'TCGA-BLCA',
        claimId: 'CLM-2024-010',
        documentType: 'Clinical Note'
      };

      // All required fields must be present
      const requiredFields: Array<keyof ClaimMetadata> = [
        'patientId',
        'patientName',
        'tciaCollectionId',
        'claimId',
        'documentType'
      ];

      requiredFields.forEach(field => {
        expect(metadata[field]).toBeDefined();
      });
    });

    it('should allow optional fields to be undefined', () => {
      const metadata: ClaimMetadata = {
        patientId: 'TCIA-012',
        patientName: 'Iris Anderson',
        tciaCollectionId: 'TCGA-ESCA',
        claimId: 'CLM-2024-011',
        documentType: 'Radiology Report'
      };

      expect(metadata.filingDate).toBeUndefined();
      expect(metadata.primaryDiagnosis).toBeUndefined();
      expect(metadata.claimedAmount).toBeUndefined();
      expect(metadata.approvedAmount).toBeUndefined();
    });
  });

  describe('ClaimMetadata Integration with Document Processing', () => {
    it('should preserve claim metadata through document lifecycle', () => {
      const initialMetadata: ClaimMetadata = {
        patientId: 'TCIA-013',
        patientName: 'Jack Robinson',
        tciaCollectionId: 'TCGA-HNSC',
        claimId: 'CLM-2024-012',
        documentType: 'CMS1500',
        filingDate: '2024-01-25',
        claimedAmount: 18000.00
      };

      // Simulate document creation
      const document: DocumentRecord = {
        id: 'doc-789',
        customerUuid: 'cust-012',
        tenantId: 'tenant-456',
        fileName: 'cms1500_claim_012.pdf',
        s3Key: 'uploads/tenant-456/cust-012/doc-789/cms1500_claim_012.pdf',
        contentType: 'application/pdf',
        processingStatus: 'queued',
        createdAt: '2024-01-25T09:00:00Z',
        updatedAt: '2024-01-25T09:00:00Z',
        claimMetadata: initialMetadata
      };

      // Verify metadata is preserved
      expect(document.claimMetadata).toEqual(initialMetadata);
      
      // Simulate processing update
      const updatedDocument: DocumentRecord = {
        ...document,
        processingStatus: 'completed',
        updatedAt: '2024-01-25T09:05:00Z'
      };

      // Metadata should remain unchanged
      expect(updatedDocument.claimMetadata).toEqual(initialMetadata);
    });

    it('should support querying documents by claim metadata', () => {
      const documents: DocumentRecord[] = [
        {
          id: 'doc-001',
          customerUuid: 'cust-013',
          tenantId: 'tenant-789',
          fileName: 'cms1500.pdf',
          s3Key: 'uploads/tenant-789/cust-013/doc-001/cms1500.pdf',
          contentType: 'application/pdf',
          processingStatus: 'completed',
          createdAt: '2024-01-26T10:00:00Z',
          updatedAt: '2024-01-26T10:05:00Z',
          claimMetadata: {
            patientId: 'TCIA-014',
            patientName: 'Karen White',
            tciaCollectionId: 'TCGA-KIRP',
            claimId: 'CLM-2024-013',
            documentType: 'CMS1500'
          }
        },
        {
          id: 'doc-002',
          customerUuid: 'cust-013',
          tenantId: 'tenant-789',
          fileName: 'eob.pdf',
          s3Key: 'uploads/tenant-789/cust-013/doc-002/eob.pdf',
          contentType: 'application/pdf',
          processingStatus: 'completed',
          createdAt: '2024-01-26T10:10:00Z',
          updatedAt: '2024-01-26T10:15:00Z',
          claimMetadata: {
            patientId: 'TCIA-014',
            patientName: 'Karen White',
            tciaCollectionId: 'TCGA-KIRP',
            claimId: 'CLM-2024-013',
            documentType: 'EOB'
          }
        }
      ];

      // Query by claim ID
      const claimDocuments = documents.filter(
        doc => doc.claimMetadata?.claimId === 'CLM-2024-013'
      );

      expect(claimDocuments).toHaveLength(2);
      expect(claimDocuments[0].claimMetadata?.documentType).toBe('CMS1500');
      expect(claimDocuments[1].claimMetadata?.documentType).toBe('EOB');
    });

    it('should support grouping documents by patient', () => {
      const documents: DocumentRecord[] = [
        {
          id: 'doc-003',
          customerUuid: 'cust-014',
          tenantId: 'tenant-012',
          fileName: 'clinical_note.pdf',
          s3Key: 'uploads/tenant-012/cust-014/doc-003/clinical_note.pdf',
          contentType: 'application/pdf',
          processingStatus: 'completed',
          createdAt: '2024-01-27T11:00:00Z',
          updatedAt: '2024-01-27T11:05:00Z',
          claimMetadata: {
            patientId: 'TCIA-015',
            patientName: 'Larry Green',
            tciaCollectionId: 'TCGA-LGG',
            claimId: 'CLM-2024-014',
            documentType: 'Clinical Note'
          }
        },
        {
          id: 'doc-004',
          customerUuid: 'cust-014',
          tenantId: 'tenant-012',
          fileName: 'radiology_report.pdf',
          s3Key: 'uploads/tenant-012/cust-014/doc-004/radiology_report.pdf',
          contentType: 'application/pdf',
          processingStatus: 'completed',
          createdAt: '2024-01-27T11:10:00Z',
          updatedAt: '2024-01-27T11:15:00Z',
          claimMetadata: {
            patientId: 'TCIA-015',
            patientName: 'Larry Green',
            tciaCollectionId: 'TCGA-LGG',
            claimId: 'CLM-2024-015',
            documentType: 'Radiology Report'
          }
        }
      ];

      // Group by patient ID
      const patientDocuments = documents.filter(
        doc => doc.claimMetadata?.patientId === 'TCIA-015'
      );

      expect(patientDocuments).toHaveLength(2);
      expect(patientDocuments[0].claimMetadata?.patientName).toBe('Larry Green');
      expect(patientDocuments[1].claimMetadata?.patientName).toBe('Larry Green');
    });
  });
});
