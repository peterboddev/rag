"""
S3 Uploader

Optional functionality for uploading generated data to S3.
"""

import os
from pathlib import Path
from typing import Dict, Any
import boto3
from botocore.exceptions import ClientError, NoCredentialsError


class S3UploadError(Exception):
    """Exception raised for S3 upload errors."""
    pass


class S3Uploader:
    """
    Uploads generated medical claims data to an S3 bucket.
    
    This class provides functionality to recursively upload a directory
    to S3 while preserving the directory structure as S3 key prefixes.
    """
    
    def __init__(self, bucket_name: str):
        """
        Initialize the S3 uploader.
        
        Args:
            bucket_name: Name of the S3 bucket to upload to
        """
        self.bucket_name = bucket_name
        self._s3_client = None
    
    @property
    def s3_client(self):
        """Lazy initialization of S3 client."""
        if self._s3_client is None:
            try:
                self._s3_client = boto3.client('s3')
            except NoCredentialsError:
                raise S3UploadError(
                    "AWS credentials not found. Please configure AWS credentials "
                    "using AWS CLI, environment variables, or IAM role."
                )
        return self._s3_client
    
    def upload_directory(self, directory_path: Path) -> Dict[str, Any]:
        """
        Recursively upload all files from a directory to S3.
        
        The directory structure is preserved in S3 keys. For example:
        - local: /path/to/medical_data/patients/TCIA-001/claims/cms1500_001.pdf
        - S3 key: patients/TCIA-001/claims/cms1500_001.pdf
        
        Args:
            directory_path: Path to the directory to upload
            
        Returns:
            Dictionary containing upload summary:
            {
                'success': bool,
                'file_count': int,
                'total_bytes': int,
                'failed_files': List[str],
                'error_message': Optional[str]
            }
            
        Raises:
            S3UploadError: If the directory doesn't exist or bucket is inaccessible
        """
        if not directory_path.exists():
            raise S3UploadError(f"Directory does not exist: {directory_path}")
        
        if not directory_path.is_dir():
            raise S3UploadError(f"Path is not a directory: {directory_path}")
        
        # Verify bucket exists and is accessible
        try:
            self.s3_client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == '404':
                raise S3UploadError(f"Bucket does not exist: {self.bucket_name}")
            elif error_code == '403':
                raise S3UploadError(f"Access denied to bucket: {self.bucket_name}")
            else:
                raise S3UploadError(f"Error accessing bucket: {str(e)}")
        
        # Collect all files to upload
        files_to_upload = []
        for root, dirs, files in os.walk(directory_path):
            for file in files:
                file_path = Path(root) / file
                files_to_upload.append(file_path)
        
        # Upload files
        file_count = 0
        total_bytes = 0
        failed_files = []
        
        for file_path in files_to_upload:
            try:
                # Calculate S3 key by removing the base directory path
                relative_path = file_path.relative_to(directory_path)
                s3_key = str(relative_path).replace('\\', '/')  # Ensure forward slashes
                
                # Get file size
                file_size = file_path.stat().st_size
                
                # Upload file
                self.s3_client.upload_file(
                    str(file_path),
                    self.bucket_name,
                    s3_key
                )
                
                file_count += 1
                total_bytes += file_size
                
            except ClientError as e:
                failed_files.append(f"{relative_path}: {str(e)}")
            except Exception as e:
                failed_files.append(f"{relative_path}: {str(e)}")
        
        # Build summary
        success = len(failed_files) == 0
        summary = {
            'success': success,
            'file_count': file_count,
            'total_bytes': total_bytes,
            'failed_files': failed_files,
            'error_message': None if success else f"{len(failed_files)} file(s) failed to upload"
        }
        
        return summary
