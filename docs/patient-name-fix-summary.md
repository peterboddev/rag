# Patient Name Display Fix

## Issue
Patient detail page was showing "Unknown Patient" and "Claims (0)" because:
1. mapping.json didn't include patient names
2. Claim documents weren't being generated in the claims/ directory

## Code Changes Made

### Medical Claims Generator
- Updated `PatientMapping` model to include `patient_names` field
- Modified `patient_mapper.py` to populate patient names from Synthea data
- Output organizer already correctly places claims in `claims/` directory

### Lambda Functions
- Updated `patient-detail.ts` to read patient names from mapping.json
- Updated `patient-list.ts` to parse new mapping format with patient names
- Both Lambdas now handle the new format: `{synthea_id, tcia_id, patient_name}`

### Unit Tests
- Updated `patient-detail.test.ts` to expect patient names
- All tests passing

## Current Status
✅ Code fixes complete and committed
❌ Cannot regenerate data due to Synthea issue

## Data Generation Issue
Synthea generates more patients than requested:
- Requested: 20 patients
- Generated: 56 patients
- Available TCIA patients: 30
- Result: Insufficient TCIA patients for mapping

## Next Steps
1. Either get more TCIA metadata (need 56+ patients)
2. Or fix Synthea to respect patient count parameter
3. Once resolved, regenerate data with: `python -m medical_claims_generator.main --patient-count 20 --s3-bucket medical-claims-synthetic-data-dev`
4. New data will have patient names and claims in correct directories
5. App will display patient names correctly
