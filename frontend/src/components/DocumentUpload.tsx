import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  DocumentUploadRequest, 
  DocumentUploadResponse, 
  CustomerManagerRequest, 
  CustomerManagerResponse,
  UploadStatus,
  validateFileType 
} from '../types';

const DocumentUpload: React.FC = () => {
  const { tenantId } = useAuth();
  const [customerEmail, setCustomerEmail] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    progress: 0,
    message: '',
    type: 'info'
  });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE_URL = process.env.REACT_APP_API_URL || '/api';

  const handleFileSelect = (file: File) => {
    const validation = validateFileType(file.name, file.type);
    if (!validation.isValid) {
      setUploadStatus({
        isUploading: false,
        progress: 0,
        message: validation.error || 'Invalid file type',
        type: 'error'
      });
      return;
    }

    setSelectedFile(file);
    setUploadStatus({
      isUploading: false,
      progress: 0,
      message: `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
      type: 'info'
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerEmail.trim() || !selectedFile || !tenantId) {
      setUploadStatus({
        isUploading: false,
        progress: 0,
        message: 'Please fill in all fields and select a file',
        type: 'error'
      });
      return;
    }

    try {
      setUploadStatus({
        isUploading: true,
        progress: 10,
        message: 'Creating customer record...',
        type: 'info'
      });

      // Step 1: Create/get customer
      const customerRequest: CustomerManagerRequest = {
        customerEmail: customerEmail.trim()
      };

      const customerResponse = await fetch(`${API_BASE_URL}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify(customerRequest)
      });

      if (!customerResponse.ok) {
        throw new Error(`Customer creation failed: ${customerResponse.statusText}`);
      }

      const customerData: CustomerManagerResponse = await customerResponse.json();

      setUploadStatus({
        isUploading: true,
        progress: 30,
        message: 'Converting file...',
        type: 'info'
      });

      // Step 2: Convert file to base64
      const fileData = await convertFileToBase64(selectedFile);

      setUploadStatus({
        isUploading: true,
        progress: 50,
        message: 'Uploading document...',
        type: 'info'
      });

      // Step 3: Upload document
      const uploadRequest: DocumentUploadRequest = {
        customerUUID: customerData.customerUUID,
        fileName: selectedFile.name,
        contentType: selectedFile.type,
        fileData
      };

      const uploadResponse = await fetch(`${API_BASE_URL}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify(uploadRequest)
      });

      if (!uploadResponse.ok) {
        throw new Error(`Document upload failed: ${uploadResponse.statusText}`);
      }

      const uploadData: DocumentUploadResponse = await uploadResponse.json();

      setUploadStatus({
        isUploading: false,
        progress: 100,
        message: `✅ Document uploaded successfully! Document ID: ${uploadData.documentId}`,
        type: 'success'
      });

      // Reset form
      setCustomerEmail('');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus({
        isUploading: false,
        progress: 0,
        message: `❌ Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error'
      });
    }
  };

  return (
    <div>
      <form onSubmit={handleUpload} className="upload-form">
        <div className="form-group">
          <label htmlFor="customerEmail">Customer Email:</label>
          <input
            type="email"
            id="customerEmail"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="Enter customer email address"
            required
            disabled={uploadStatus.isUploading}
          />
        </div>

        <div className="form-group">
          <label>Document File:</label>
          <div
            className={`file-drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {selectedFile ? (
              <div>
                <p><strong>Selected:</strong> {selectedFile.name}</p>
                <p>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                <p>Type: {selectedFile.type}</p>
              </div>
            ) : (
              <div>
                <p>Drag and drop a file here, or click to select</p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  Supported: PDF, DOC, DOCX, TXT, JPG, PNG, TIFF
                </p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInputChange}
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.tiff,.tif"
            style={{ display: 'none' }}
            disabled={uploadStatus.isUploading}
          />
        </div>

        {uploadStatus.message && (
          <div className={`alert alert-${uploadStatus.type === 'error' ? 'error' : 'success'}`}>
            {uploadStatus.message}
            {uploadStatus.isUploading && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ 
                  width: '100%', 
                  height: '10px', 
                  backgroundColor: '#e0e0e0', 
                  borderRadius: '5px',
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: `${uploadStatus.progress}%`, 
                    height: '100%', 
                    backgroundColor: '#007bff',
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={uploadStatus.isUploading || !customerEmail.trim() || !selectedFile}
        >
          {uploadStatus.isUploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </form>
    </div>
  );
};

export default DocumentUpload;