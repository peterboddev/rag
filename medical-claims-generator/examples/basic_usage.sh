#!/bin/bash

################################################################################
# Basic Usage Example
#
# This script demonstrates the most basic usage of the Medical Claims Data
# Generator with default settings.
#
# Prerequisites:
# - Synthea installed in ./synthea directory
# - TCIA metadata CSV file named tcia_metadata.csv in current directory
# - Python 3.10+ with medical-claims-generator package installed
#
# What this does:
# - Generates 25 synthetic patients (default)
# - Creates medical claims data in ./medical_data directory
# - Uses random seed (different results each time)
################################################################################

echo "=========================================="
echo "Medical Claims Generator - Basic Usage"
echo "=========================================="
echo ""

# Run the generator with default settings
# This will:
# - Generate 25 patients
# - Output to ./medical_data directory
# - Use tcia_metadata.csv from current directory
# - Use Synthea from ./synthea directory
# - Generate a random seed (non-reproducible)

python -m medical_claims_generator.main

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Generation completed successfully!"
    echo ""
    echo "Output directory structure:"
    echo "  medical_data/"
    echo "  ├── patients/           # Patient-specific data"
    echo "  │   ├── TCIA-001/"
    echo "  │   │   ├── claims/     # CMS-1500, EOB, radiology reports"
    echo "  │   │   └── clinical-notes/"
    echo "  │   └── ..."
    echo "  ├── metadata/           # Source data and mappings"
    echo "  │   ├── tcia_metadata.csv"
    echo "  │   └── synthea-output/"
    echo "  ├── mapping.json        # Patient ID mappings"
    echo "  └── statistics.json     # Generation statistics"
    echo ""
    echo "Next steps:"
    echo "  1. Review the validation report above"
    echo "  2. Check statistics.json for dataset summary"
    echo "  3. Explore patient directories in medical_data/patients/"
    echo "  4. Upload to Insurance Claim Portal for testing"
else
    echo ""
    echo "✗ Generation failed. Check error messages above."
    exit 1
fi
