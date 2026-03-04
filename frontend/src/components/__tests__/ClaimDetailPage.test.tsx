import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ClaimDetailPage from '../ClaimDetailPage';
import * as claimApi from '../../services/claimApi';

// Mock the claim API
jest.mock('../../services/claimApi');

const mockGetPatientDetail = claimApi.getPatientDetail as jest.MockedFunction<typeof claimApi.getPatientDetail>;
const mockLoadClaim = claimApi.loadClaim as jest.MockedFunction<typeof claimApi.loadClaim>;
const mockGetClaimStatus = claimApi.getClaimStatus as jest.MockedFunction<typeof claimApi.getClaimStatus>;

describe('ClaimDetailPage', () => {
  const mockOnBack = jest.fn();
  const patientId = 'TCIA-001';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should display loading state initially', () => {
    mockGetPatientDetail.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);
    
    expect(screen.getByText('Loading patient details...')).toBeInTheDocument();
  });

  it('should render patient details and claims when data is loaded', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15',
          status: 'pending'
        },
        {
          claimId: 'claim-002',
          documentCount: 3,
          filingDate: '2024-02-20'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockRejectedValue(new Error('Not loaded'));

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    expect(screen.getByText(/TCIA-001/)).toBeInTheDocument();
    expect(screen.getByText(/TCGA-BRCA/)).toBeInTheDocument();
    expect(screen.getByText(/Claims \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('Claim claim-001')).toBeInTheDocument();
    expect(screen.getByText('Claim claim-002')).toBeInTheDocument();
  });

  it('should call onBack when back button is clicked', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: []
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const backButton = screen.getByText('← Back to Patients');
    fireEvent.click(backButton);

    expect(mockOnBack).toHaveBeenCalled();
  });

  it('should display error message when API call fails', async () => {
    mockGetPatientDetail.mockRejectedValue(new Error('Failed to load patient details'));

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load patient details/)).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should load claim when "Load Claim Documents" button is clicked', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockRejectedValue(new Error('Not loaded'));
    mockLoadClaim.mockResolvedValue({
      jobId: 'job-123',
      status: 'processing',
      message: 'Loading claim documents'
    });

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('📥 Load Claim Documents')).toBeInTheDocument();
    });

    const loadButton = screen.getByText('📥 Load Claim Documents');
    fireEvent.click(loadButton);

    await waitFor(() => {
      expect(mockLoadClaim).toHaveBeenCalledWith('claim-001');
    });
  });

  it('should display claim status badge when status is available', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockResolvedValue({
      status: 'completed',
      documentsProcessed: 5,
      totalDocuments: 5
    });

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
    });
  });

  it('should display progress bar for processing claims', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockResolvedValue({
      status: 'processing',
      documentsProcessed: 3,
      totalDocuments: 5
    });

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('Processing: 3 / 5 documents')).toBeInTheDocument();
    });
  });

  it('should display "View Documents & Summary" button for completed claims', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockResolvedValue({
      status: 'completed',
      documentsProcessed: 5,
      totalDocuments: 5
    });

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('📄 View Documents & Summary')).toBeInTheDocument();
    });
  });

  it('should display "No claims found" when patient has no claims', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: []
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText('No claims found for this patient')).toBeInTheDocument();
    });
  });

  it('should format filing date correctly', async () => {
    const mockPatientDetail = {
      patientId: 'TCIA-001',
      patientName: 'John Doe',
      tciaCollectionId: 'TCGA-BRCA',
      claims: [
        {
          claimId: 'claim-001',
          documentCount: 5,
          filingDate: '2024-01-15T10:30:00Z'
        }
      ]
    };

    mockGetPatientDetail.mockResolvedValue(mockPatientDetail);
    mockGetClaimStatus.mockRejectedValue(new Error('Not loaded'));

    render(<ClaimDetailPage patientId={patientId} onBack={mockOnBack} />);

    await waitFor(() => {
      expect(screen.getByText(/Filed:/)).toBeInTheDocument();
    });

    // Check that date is formatted (exact format depends on locale)
    expect(screen.getByText(/1\/15\/2024/)).toBeInTheDocument();
  });
});
