import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PatientListPage from '../PatientListPage';
import * as claimApi from '../../services/claimApi';

// Mock the claim API
jest.mock('../../services/claimApi');

const mockListPatients = claimApi.listPatients as jest.MockedFunction<typeof claimApi.listPatients>;

describe('PatientListPage', () => {
  const mockOnPatientSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should display loading state initially', () => {
    mockListPatients.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);
    
    expect(screen.getByText('Loading patients...')).toBeInTheDocument();
  });

  it('should render patient list when data is loaded', async () => {
    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      },
      {
        patientId: 'TCIA-002',
        patientName: 'Jane Smith',
        tciaCollectionId: 'TCGA-LUAD',
        claimCount: 1
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: undefined
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByText(/TCIA-001/)).toBeInTheDocument();
    expect(screen.getByText(/TCIA-002/)).toBeInTheDocument();
    expect(screen.getByText('2 Claims')).toBeInTheDocument();
    expect(screen.getByText('1 Claim')).toBeInTheDocument();
  });

  it('should filter patients based on search query', async () => {
    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      },
      {
        patientId: 'TCIA-002',
        patientName: 'Jane Smith',
        tciaCollectionId: 'TCGA-LUAD',
        claimCount: 1
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: undefined
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by patient ID/);
    fireEvent.change(searchInput, { target: { value: 'John' } });

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    });
  });

  it('should call onPatientSelect when patient is clicked', async () => {
    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: undefined
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const patientCard = screen.getByText('John Doe').closest('div');
    fireEvent.click(patientCard!);

    expect(mockOnPatientSelect).toHaveBeenCalledWith('TCIA-001');
  });

  it('should display error message when API call fails', async () => {
    mockListPatients.mockRejectedValue(new Error('Failed to load patients'));

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load patients/)).toBeInTheDocument();
    });

    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('should retry loading patients when retry button is clicked', async () => {
    mockListPatients.mockRejectedValueOnce(new Error('Failed to load patients'));

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load patients/)).toBeInTheDocument();
    });

    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: undefined
    });

    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  it('should display "Load More" button when nextToken is present', async () => {
    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: 'next-page-token'
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Load More')).toBeInTheDocument();
    });
  });

  it('should load more patients when "Load More" is clicked', async () => {
    const firstPagePatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      }
    ];

    const secondPagePatients = [
      {
        patientId: 'TCIA-002',
        patientName: 'Jane Smith',
        tciaCollectionId: 'TCGA-LUAD',
        claimCount: 1
      }
    ];

    mockListPatients
      .mockResolvedValueOnce({
        patients: firstPagePatients,
        nextToken: 'next-page-token'
      })
      .mockResolvedValueOnce({
        patients: secondPagePatients,
        nextToken: undefined
      });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    const loadMoreButton = screen.getByText('Load More');
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.queryByText('Load More')).not.toBeInTheDocument();
  });

  it('should display "No patients found" when list is empty', async () => {
    mockListPatients.mockResolvedValue({
      patients: [],
      nextToken: undefined
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('No patients found')).toBeInTheDocument();
    });
  });

  it('should display filtered count when searching', async () => {
    const mockPatients = [
      {
        patientId: 'TCIA-001',
        patientName: 'John Doe',
        tciaCollectionId: 'TCGA-BRCA',
        claimCount: 2
      },
      {
        patientId: 'TCIA-002',
        patientName: 'Jane Smith',
        tciaCollectionId: 'TCGA-LUAD',
        claimCount: 1
      }
    ];

    mockListPatients.mockResolvedValue({
      patients: mockPatients,
      nextToken: undefined
    });

    render(<PatientListPage onPatientSelect={mockOnPatientSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Total patients: 2')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search by patient ID/);
    fireEvent.change(searchInput, { target: { value: 'John' } });

    await waitFor(() => {
      expect(screen.getByText('Showing 1 of 2 patients')).toBeInTheDocument();
    });
  });
});
