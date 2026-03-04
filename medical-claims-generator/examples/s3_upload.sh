#!/bin/bash

################################################################################
# S3 Upload Example
#
# This script demonstrates how to generate medical claims data and automatically
# upload it to an Amazon S3 bucket for cloud storage and sharing.
#
# Prerequisites:
# - Synthea installed in ./synthea directory
# - TCIA metadata CSV file named tcia_metadata.csv in current directory
# - Python 3.10+ with medical-claims-generator package installed
# - AWS credentials configured (via ~/.aws/credentials or environment variables)
# - S3 bucket created and accessible
# - boto3 Python package installed
#
# AWS Credentials Setup:
# Option 1: AWS CLI configuration
#   aws configure
#
# Option 2: Environment variables
#   export AWS_ACCESS_KEY_ID=your_access_key
#   export AWS_SECRET_ACCESS_KEY=your_secret_key
#   export AWS_DEFAULT_REGION=us-east-1
#
# Option 3: IAM role (if running on EC2/Lambda)
#   No configuration needed, uses instance role
################################################################################

echo "=========================================="
echo "Medical Claims Generator - S3 Upload"
echo "=========================================="
echo ""

# Configuration
S3_BUCKET="my-medical-claims-data"  # CHANGE THIS to your bucket name
OUTPUT_DIR="./medical_data_s3"
PATIENT_COUNT=20  # Smaller dataset for faster upload

echo "Configuration:"
echo "  S3 Bucket:       $S3_BUCKET"
echo "  Output Dir:      $OUTPUT_DIR"
echo "  Patient Count:   $PATIENT_COUNT"
echo ""

# Verify AWS credentials are configured
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "✗ Error: AWS credentials not configured or invalid"
    echo ""
    echo "Please configure AWS credentials using one of these methods:"
    echo "  1. Run: aws configure"
    echo "  2. Set environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
    echo "  3. Use IAM role (if running on EC2)"
    echo ""
    exit 1
fi

echo "✓ AWS credentials verified"
echo ""

# Verify S3 bucket exists and is accessible
echo "Checking S3 bucket access..."
if ! aws s3 ls "s3://$S3_BUCKET" &> /dev/null; then
    echo "✗ Error: Cannot access S3 bucket: $S3_BUCKET"
    echo ""
    echo "Please ensure:"
    echo "  1. Bucket exists: aws s3 mb s3://$S3_BUCKET"
    echo "  2. You have permissions to write to the bucket"
    echo "  3. Bucket name is correct"
    echo ""
    exit 1
fi

echo "✓ S3 bucket accessible"
echo ""

# Run the generator with S3 upload
# This will:
# - Generate 20 patients (smaller dataset for faster upload)
# - Create local files in ./medical_data_s3
# - Automatically upload all files to S3 bucket
# - Preserve directory structure in S3

echo "Starting generation and upload..."
echo ""

python -m medical_claims_generator.main \
    --output-dir "$OUTPUT_DIR" \
    --patient-count $PATIENT_COUNT \
    --s3-bucket "$S3_BUCKET"

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Generation and upload completed successfully!"
    echo ""
    echo "S3 Upload Details:"
    echo "  Bucket:     s3://$S3_BUCKET"
    echo "  Location:   https://s3.console.aws.amazon.com/s3/buckets/$S3_BUCKET"
    echo ""
    echo "S3 Directory Structure:"
    echo "  s3://$S3_BUCKET/"
    echo "  ├── patients/"
    echo "  │   ├── TCIA-001/"
    echo "  │   │   ├── claims/"
    echo "  │   │   └── clinical-notes/"
    echo "  │   └── ..."
    echo "  ├── metadata/"
    echo "  ├── mapping.json"
    echo "  └── statistics.json"
    echo ""
    echo "Next steps:"
    echo "  1. View files in S3 console or CLI:"
    echo "     aws s3 ls s3://$S3_BUCKET/ --recursive"
    echo ""
    echo "  2. Download specific files:"
    echo "     aws s3 cp s3://$S3_BUCKET/statistics.json ."
    echo ""
    echo "  3. Download entire dataset:"
    echo "     aws s3 sync s3://$S3_BUCKET/ ./downloaded_data/"
    echo ""
    echo "  4. Share with team (if bucket has appropriate permissions):"
    echo "     aws s3 presign s3://$S3_BUCKET/statistics.json --expires-in 3600"
    echo ""
    echo "  5. Configure Insurance Claim Portal to read from S3"
else
    echo ""
    echo "✗ Generation or upload failed. Check error messages above."
    echo ""
    echo "Common issues:"
    echo "  - AWS credentials expired or invalid"
    echo "  - Insufficient S3 permissions"
    echo "  - Network connectivity issues"
    echo "  - S3 bucket policy restrictions"
    echo ""
    exit 1
fi

# Optional: Clean up local files after successful upload
read -p "Delete local files (data uploaded to S3)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleaning up local files..."
    rm -rf "$OUTPUT_DIR"
    echo "✓ Local files deleted. Data preserved in S3."
fi
