// Utility functions for document display

export const formatDate = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
};

export const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'completed':
      return '#28a745';
    case 'processing':
      return '#ffc107';
    case 'queued':
      return '#17a2b8';
    case 'failed':
      return '#dc3545';
    default:
      return '#6c757d';
  }
};

export const getStatusIcon = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'completed':
      return '✅';
    case 'processing':
      return '⏳';
    case 'queued':
      return '⏸️';
    case 'failed':
      return '❌';
    default:
      return '❓';
  }
};
