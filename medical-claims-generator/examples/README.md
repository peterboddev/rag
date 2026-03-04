# Medical Claims Generator - Example Scripts

This directory contains example shell scripts demonstrating common usage patterns for the Medical Claims Data Generator.

## Available Examples

### 1. Basic Usage (`basic_usage.sh`)

The simplest way to generate medical claims data with default settings.

**What it does:**
- Generates 25 synthetic patients
- Creates output in `./medical_data` directory
- Uses random seed (different results each time)

**When to use:**
- Quick data generation for testing
- First-time users learning the tool
- One-off dataset creation

**Run it:**
```bash
cd examples
chmod +x basic_usage.sh
./basic_usage.sh
```

### 2. Reproducible Generation (`reproducible_generation.sh`)

Generate datasets with a fixed random seed for reproducibility.

**What it does:**
- Generates 25 synthetic patients
- Uses seed `42` for deterministic results
- Creates output in `./medical_data_reproducible` directory
- Running multiple times produces identical results

**When to use:**
- Regression testing
- Debugging specific issues
- Creating consistent demo data
- Sharing reproducible test datasets

**Run it:**
```bash
cd examples
chmod +x reproducible_generation.sh
./reproducible_generation.sh
```

**Customization:**
Edit the `SEED` variable in the script to use a different seed:
```bash
SEED=12345  # Change this value
```

### 3. S3 Upload (`s3_upload.sh`)

Generate data and automatically upload to Amazon S3.

**What it does:**
- Generates 20 synthetic patients (smaller for faster upload)
- Creates local output in `./medical_data_s3` directory
- Uploads all files to specified S3 bucket
- Preserves directory structure in S3

**When to use:**
- Cloud storage and backup
- Sharing data with team members
- Integration with cloud-based Insurance Claim Portal
- Automated data pipelines

**Prerequisites:**
1. AWS credentials configured:
   ```bash
   aws configure
   ```
   Or set environment variables:
   ```bash
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   export AWS_DEFAULT_REGION=us-east-1
   ```

2. S3 bucket created:
   ```bash
   aws s3 mb s3://my-medical-claims-data
   ```

3. boto3 installed:
   ```bash
   pip install boto3
   ```

**Run it:**
```bash
cd examples
# Edit s3_upload.sh and change S3_BUCKET variable to your bucket name
chmod +x s3_upload.sh
./s3_upload.sh
```

## Prerequisites for All Examples

### 1. Install the Package

```bash
cd medical-claims-generator
pip install -e .
```

Or install from PyPI (when published):
```bash
pip install medical-claims-generator
```

### 2. Install Synthea

Download and set up Synthea:
```bash
# Download Synthea
wget https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar

# Create synthea directory
mkdir synthea
mv synthea-with-dependencies.jar synthea/

# Test Synthea
cd synthea
java -jar synthea-with-dependencies.jar --help
cd ..
```

### 3. Obtain TCIA Metadata

Download TCIA EAY131 collection metadata:
```bash
# Visit: https://www.cancerimagingarchive.net/collection/eay131/
# Download the metadata CSV file
# Save as tcia_metadata.csv in the current directory
```

Or use the provided sample metadata (if available):
```bash
cp path/to/sample/tcia_metadata.csv .
```

## Making Scripts Executable

All scripts need execute permissions:

```bash
cd examples
chmod +x basic_usage.sh
chmod +x reproducible_generation.sh
chmod +x s3_upload.sh
```

Or make all executable at once:
```bash
chmod +x examples/*.sh
```

## Customizing the Examples

### Change Patient Count

Edit the script and modify the command:
```bash
python -m medical_claims_generator.main \
    --patient-count 30  # Change from default 25
```

### Change Output Directory

```bash
python -m medical_claims_generator.main \
    --output-dir /path/to/custom/output
```

### Specify Custom Paths

```bash
python -m medical_claims_generator.main \
    --tcia-metadata /path/to/tcia.csv \
    --synthea-path /opt/synthea
```

### Combine Options

```bash
python -m medical_claims_generator.main \
    --output-dir ./my_data \
    --patient-count 20 \
    --seed 12345 \
    --tcia-metadata ./custom_tcia.csv \
    --synthea-path /opt/synthea \
    --s3-bucket my-bucket
```

## Expected Output

All scripts produce the following directory structure:

```
medical_data/
├── patients/
│   ├── TCIA-001/
│   │   ├── claims/
│   │   │   ├── cms1500_001.pdf
│   │   │   ├── cms1500_002.pdf
│   │   │   ├── eob_001.pdf
│   │   │   ├── eob_002.pdf
│   │   │   ├── radiology_report_001.pdf
│   │   │   └── radiology_report_002.pdf
│   │   └── clinical-notes/
│   │       ├── clinical_note_001.pdf
│   │       └── clinical_note_002.pdf
│   ├── TCIA-002/
│   │   └── ...
│   └── ...
├── metadata/
│   ├── tcia_metadata.csv
│   └── synthea-output/
│       ├── fhir/
│       │   └── *.json
│       └── csv/
│           └── *.csv
├── mapping.json
└── statistics.json
```

## Validation and Statistics

After generation, check these files:

### mapping.json
Contains patient ID mappings:
```json
{
  "patient_mappings": [
    {"synthea_id": "abc-123", "tcia_id": "TCIA-001"},
    ...
  ],
  "encounter_study_mappings": {
    "encounter-001": [
      {
        "study_uid": "1.2.3.4.5...",
        "modality": "CT",
        "study_date": "2023-01-15"
      }
    ]
  }
}
```

### statistics.json
Contains generation summary:
```json
{
  "total_patients": 25,
  "patients_by_cancer_type": {
    "lung_cancer": 13,
    "colorectal_cancer": 12
  },
  "total_claims": 50,
  "claims_by_status": {
    "approved": 30,
    "denied": 10,
    "pending": 10
  },
  "documents_by_type": {
    "cms1500": 50,
    "eob": 50,
    "radiology_report": 50,
    "clinical_note": 75
  },
  "random_seed": 42,
  "generation_timestamp": "2024-01-15T10:30:00Z"
}
```

## Troubleshooting

### Synthea Not Found
```
Error: Synthea directory not found: ./synthea
```
**Solution:** Install Synthea or specify correct path with `--synthea-path`

### TCIA Metadata Not Found
```
Error: TCIA metadata file not found: tcia_metadata.csv
```
**Solution:** Download TCIA metadata or specify correct path with `--tcia-metadata`

### Patient Count Out of Range
```
Error: patient-count must be between 20 and 30
```
**Solution:** Use `--patient-count` with value between 20 and 30

### S3 Upload Fails
```
Error: Cannot access S3 bucket
```
**Solution:** 
- Configure AWS credentials: `aws configure`
- Verify bucket exists: `aws s3 ls s3://your-bucket`
- Check IAM permissions for S3 write access

### Java Not Found (Synthea)
```
Error: java: command not found
```
**Solution:** Install Java 11 or later:
```bash
# Ubuntu/Debian
sudo apt-get install openjdk-11-jdk

# macOS
brew install openjdk@11

# Verify
java -version
```

## Additional Resources

- [Main README](../README.md) - Complete documentation
- [QUICKSTART Guide](../QUICKSTART.md) - Quick setup guide
- [Requirements](../.kiro/specs/medical-claims-data-generator/requirements.md) - Detailed requirements
- [Design Document](../.kiro/specs/medical-claims-data-generator/design.md) - Architecture and design

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the main README documentation
3. Check the requirements and design documents
4. Open an issue in the project repository

## License

These example scripts are part of the Medical Claims Data Generator project and are subject to the same license terms.
