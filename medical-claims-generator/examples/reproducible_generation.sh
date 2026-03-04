#!/bin/bash

################################################################################
# Reproducible Generation Example
#
# This script demonstrates how to use a random seed to generate reproducible
# datasets. Using the same seed will always produce the same patient mappings,
# claim statuses, and document assignments.
#
# Prerequisites:
# - Synthea installed in ./synthea directory
# - TCIA metadata CSV file named tcia_metadata.csv in current directory
# - Python 3.10+ with medical-claims-generator package installed
#
# Use Cases:
# - Regression testing: Verify changes don't affect output
# - Debugging: Reproduce exact dataset that caused an issue
# - Demos: Create consistent demo data for presentations
# - Testing: Generate same test data across environments
################################################################################

echo "=========================================="
echo "Medical Claims Generator - Reproducible Generation"
echo "=========================================="
echo ""

# Define a specific random seed for reproducibility
# Using the same seed will always produce identical results
SEED=42

echo "Using random seed: $SEED"
echo "This ensures reproducible generation across runs."
echo ""

# Run the generator with a specific seed
# This will:
# - Generate 25 patients
# - Use seed 42 for all random operations
# - Produce identical results every time with this seed
# - Output to ./medical_data_reproducible directory

python -m medical_claims_generator.main \
    --output-dir ./medical_data_reproducible \
    --seed $SEED

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Generation completed successfully!"
    echo ""
    echo "Reproducibility Notes:"
    echo "  - Random seed used: $SEED"
    echo "  - Running this script again will produce identical results"
    echo "  - Patient-to-TCIA mappings will be the same"
    echo "  - Claim statuses (approved/denied/pending) will be the same"
    echo "  - Document IDs and assignments will be the same"
    echo ""
    echo "To verify reproducibility:"
    echo "  1. Run this script again"
    echo "  2. Compare the two output directories"
    echo "  3. Check that mapping.json files are identical"
    echo "  4. Verify statistics.json shows same seed and counts"
    echo ""
    echo "To generate different data:"
    echo "  - Change the SEED value in this script"
    echo "  - Or omit --seed to use random generation"
    echo ""
    echo "Example: Generate with different seed"
    echo "  python -m medical_claims_generator.main --seed 12345"
else
    echo ""
    echo "✗ Generation failed. Check error messages above."
    exit 1
fi
