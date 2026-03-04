"""
Unit tests for S3Uploader class.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from botocore.exceptions import ClientError, NoCredentialsError

from medical_claims_generator.s3_uploader import S3Uploader, S3UploadError


class TestS3Uploader:
    """Test suite for S3Uploader class."""
    
    def test_init(self):
        """Test S3Uploader initialization."""
        uploader = S3Uploader(bucket_name="test-bucket")
        assert uploader.bucket_name == "test-bucket"
        assert uploader._s3_client is None
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_s3_client_lazy_initialization(self, mock_boto3):
        """Test that S3 client is lazily initialized."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        
        uploader = S3Uploader(bucket_name="test-bucket")
        assert uploader._s3_client is None
        
        # Access the client property
        client = uploader.s3_client
        assert client == mock_client
        mock_boto3.client.assert_called_once_with('s3')
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_s3_client_no_credentials(self, mock_boto3):
        """Test error handling when AWS credentials are not available."""
        mock_boto3.client.side_effect = NoCredentialsError()
        
        uploader = S3Uploader(bucket_name="test-bucket")
        
        with pytest.raises(S3UploadError) as exc_info:
            _ = uploader.s3_client
        
        assert "AWS credentials not found" in str(exc_info.value)
    
    def test_upload_directory_nonexistent(self):
        """Test error when directory doesn't exist."""
        uploader = S3Uploader(bucket_name="test-bucket")
        nonexistent_path = Path("/nonexistent/directory")
        
        with pytest.raises(S3UploadError) as exc_info:
            uploader.upload_directory(nonexistent_path)
        
        assert "Directory does not exist" in str(exc_info.value)
    
    def test_upload_directory_not_a_directory(self, tmp_path):
        """Test error when path is not a directory."""
        # Create a file instead of a directory
        file_path = tmp_path / "test_file.txt"
        file_path.write_text("test content")
        
        uploader = S3Uploader(bucket_name="test-bucket")
        
        with pytest.raises(S3UploadError) as exc_info:
            uploader.upload_directory(file_path)
        
        assert "Path is not a directory" in str(exc_info.value)
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_bucket_not_found(self, mock_boto3, tmp_path):
        """Test error when S3 bucket doesn't exist."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        
        # Simulate bucket not found error
        error_response = {'Error': {'Code': '404'}}
        mock_client.head_bucket.side_effect = ClientError(error_response, 'HeadBucket')
        
        uploader = S3Uploader(bucket_name="test-bucket")
        
        with pytest.raises(S3UploadError) as exc_info:
            uploader.upload_directory(tmp_path)
        
        assert "Bucket does not exist" in str(exc_info.value)
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_access_denied(self, mock_boto3, tmp_path):
        """Test error when access to S3 bucket is denied."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        
        # Simulate access denied error
        error_response = {'Error': {'Code': '403'}}
        mock_client.head_bucket.side_effect = ClientError(error_response, 'HeadBucket')
        
        uploader = S3Uploader(bucket_name="test-bucket")
        
        with pytest.raises(S3UploadError) as exc_info:
            uploader.upload_directory(tmp_path)
        
        assert "Access denied to bucket" in str(exc_info.value)
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_success(self, mock_boto3, tmp_path):
        """Test successful directory upload."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        mock_client.head_bucket.return_value = {}
        
        # Create test directory structure
        (tmp_path / "subdir1").mkdir()
        (tmp_path / "subdir2").mkdir()
        
        file1 = tmp_path / "file1.txt"
        file1.write_text("content1")
        
        file2 = tmp_path / "subdir1" / "file2.txt"
        file2.write_text("content2")
        
        file3 = tmp_path / "subdir2" / "file3.txt"
        file3.write_text("content3")
        
        uploader = S3Uploader(bucket_name="test-bucket")
        summary = uploader.upload_directory(tmp_path)
        
        # Verify summary
        assert summary['success'] is True
        assert summary['file_count'] == 3
        assert summary['total_bytes'] == len("content1") + len("content2") + len("content3")
        assert summary['failed_files'] == []
        assert summary['error_message'] is None
        
        # Verify upload_file was called correctly
        assert mock_client.upload_file.call_count == 3
        
        # Check that S3 keys preserve directory structure
        uploaded_keys = [call[0][2] for call in mock_client.upload_file.call_args_list]
        assert "file1.txt" in uploaded_keys
        assert "subdir1/file2.txt" in uploaded_keys
        assert "subdir2/file3.txt" in uploaded_keys
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_partial_failure(self, mock_boto3, tmp_path):
        """Test handling of partial upload failures."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        mock_client.head_bucket.return_value = {}
        
        # Create test files
        file1 = tmp_path / "file1.txt"
        file1.write_text("content1")
        
        file2 = tmp_path / "file2.txt"
        file2.write_text("content2")
        
        # Simulate failure on second file
        error_response = {'Error': {'Code': '500', 'Message': 'Internal Server Error'}}
        mock_client.upload_file.side_effect = [
            None,  # First upload succeeds
            ClientError(error_response, 'PutObject')  # Second upload fails
        ]
        
        uploader = S3Uploader(bucket_name="test-bucket")
        summary = uploader.upload_directory(tmp_path)
        
        # Verify summary
        assert summary['success'] is False
        assert summary['file_count'] == 1  # Only one succeeded
        assert summary['total_bytes'] == len("content1")
        assert len(summary['failed_files']) == 1
        assert "file2.txt" in summary['failed_files'][0]
        assert summary['error_message'] == "1 file(s) failed to upload"
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_preserves_structure(self, mock_boto3, tmp_path):
        """Test that directory structure is preserved in S3 keys."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        mock_client.head_bucket.return_value = {}
        
        # Create nested directory structure
        patients_dir = tmp_path / "patients"
        patient1_dir = patients_dir / "TCIA-001"
        claims_dir = patient1_dir / "claims"
        notes_dir = patient1_dir / "clinical-notes"
        
        claims_dir.mkdir(parents=True)
        notes_dir.mkdir(parents=True)
        
        (claims_dir / "cms1500_001.pdf").write_text("claim data")
        (notes_dir / "note_001.pdf").write_text("note data")
        
        uploader = S3Uploader(bucket_name="test-bucket")
        summary = uploader.upload_directory(tmp_path)
        
        # Verify structure is preserved
        uploaded_keys = [call[0][2] for call in mock_client.upload_file.call_args_list]
        assert "patients/TCIA-001/claims/cms1500_001.pdf" in uploaded_keys
        assert "patients/TCIA-001/clinical-notes/note_001.pdf" in uploaded_keys
    
    @patch('medical_claims_generator.s3_uploader.boto3')
    def test_upload_directory_empty_directory(self, mock_boto3, tmp_path):
        """Test uploading an empty directory."""
        mock_client = Mock()
        mock_boto3.client.return_value = mock_client
        mock_client.head_bucket.return_value = {}
        
        uploader = S3Uploader(bucket_name="test-bucket")
        summary = uploader.upload_directory(tmp_path)
        
        # Verify summary for empty directory
        assert summary['success'] is True
        assert summary['file_count'] == 0
        assert summary['total_bytes'] == 0
        assert summary['failed_files'] == []
        assert summary['error_message'] is None
        
        # Verify no uploads were attempted
        mock_client.upload_file.assert_not_called()
