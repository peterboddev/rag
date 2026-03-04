import {
  listPatients,
  getPatientDetail,
  loadClaim,
  getClaimStatus
} from '../claimApi';

// Mock fetch
global.fetch = jest.fn();

describe('claimApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('listPatients', () => {
    it('should fetch patients list successfully', async () => {
      const mockResponse = {
        patients: [
          {
            patientId: 'TCIA-001',
            patientName: 'John Doe',
            tciaCollectionId: 'TCGA-BRCA',
            claimCount: 2
          }
        ],
        nextToken: undefined
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await listPatients();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/patients?limit=50'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it('should include nextToken in query params when provided', async () => {
      const mockResponse = {
        patients: [],
        nextToken: undefined
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      await listPatients(50, 'next-page-token');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('nextToken=next-page-token'),
        expect.any(Object)
      );
    });

    it('should include auth token in headers when available', async () => {
      localStorage.setItem('authToken', 'test-token');

      const mockResponse = {
        patients: [],
        nextToken: undefined
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      await listPatients();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should throw error when API returns error status', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Server error' })
      });

      await expect(listPatients()).rejects.toThrow('Server error');
    });

    it('should retry on transient failures', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ patients: [], nextToken: undefined })
        });

      const result = await listPatients();

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ patients: [], nextToken: undefined });
    });

    it('should not retry on authentication errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: '401 Unauthorized' })
      });

      await expect(listPatients()).rejects.toThrow('401 Unauthorized');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should timeout after 30 seconds', async () => {
      (global.fetch as jest.Mock).mockImplementation(() => 
        new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: true,
            json: async () => ({ patients: [], nextToken: undefined })
          }), 35000);
        })
      );

      const promise = listPatients();
      
      jest.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow('Request timeout');
    });
  });

  describe('getPatientDetail', () => {
    it('should fetch patient detail successfully', async () => {
      const mockResponse = {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claims: []
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await getPatientDetail('TCIA-001');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/patients/TCIA-001'),
        expect.any(Object)
      );

      expect(result).toEqual(mockResponse);
    });

    it('should encode patient ID in URL', async () => {
      const mockResponse = {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claims: []
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      await getPatientDetail('TCIA/001');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('TCIA%2F001'),
        expect.any(Object)
      );
    });
  });

  describe('loadClaim', () => {
    it('should load claim successfully', async () => {
      const mockResponse = {
        jobId: 'job-123',
        status: 'processing',
        message: 'Loading claim documents'
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await loadClaim('claim-001');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/claims/claim-001/load'),
        expect.objectContaining({
          method: 'POST'
        })
      );

      expect(result).toEqual(mockResponse);
    });

    it('should encode claim ID in URL', async () => {
      const mockResponse = {
        jobId: 'job-123',
        status: 'processing',
        message: 'Loading claim documents'
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      await loadClaim('claim/001');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('claim%2F001'),
        expect.any(Object)
      );
    });
  });

  describe('getClaimStatus', () => {
    it('should fetch claim status successfully', async () => {
      const mockResponse = {
        status: 'completed',
        documentsProcessed: 5,
        totalDocuments: 5
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await getClaimStatus('claim-001');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/claims/claim-001/status'),
        expect.any(Object)
      );

      expect(result).toEqual(mockResponse);
    });

    it('should handle errors array in response', async () => {
      const mockResponse = {
        status: 'failed',
        documentsProcessed: 3,
        totalDocuments: 5,
        errors: ['Document 1 failed', 'Document 2 failed']
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      const result = await getClaimStatus('claim-001');

      expect(result.errors).toEqual(['Document 1 failed', 'Document 2 failed']);
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(listPatients()).rejects.toThrow();
    });

    it('should handle malformed JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      await expect(listPatients()).rejects.toThrow();
    });

    it('should use default error message when response has no message', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({})
      });

      await expect(listPatients()).rejects.toThrow('API request failed: 500 Internal Server Error');
    });
  });

  describe('retry logic', () => {
    it('should retry up to 3 times on transient failures', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ patients: [], nextToken: undefined })
        });

      await listPatients();

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should throw error after max retries', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(listPatients()).rejects.toThrow('Network error');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff between retries', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ patients: [], nextToken: undefined })
        });

      const promise = listPatients();

      // First retry after 1 second
      jest.advanceTimersByTime(1000);
      
      // Second retry after 2 seconds
      jest.advanceTimersByTime(2000);

      await promise;

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
