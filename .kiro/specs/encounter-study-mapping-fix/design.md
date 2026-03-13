# Encounter-Study Mapping Fix Bugfix Design

## Overview

The medical claims data generator currently fails to produce any claim documents (CMS-1500 forms, EOBs, radiology reports) because the encounter-to-imaging-study mapping produces empty arrays for all encounters. The root cause is that the date-based matching algorithm (±30 day window) between Synthea-generated encounter dates and TCIA imaging study dates fails to find matches due to temporal misalignment between the two datasets.

This fix implements a hybrid matching strategy: first attempting date-based matching (preserving the existing logic for when dates do align), then falling back to a guaranteed round-robin assignment strategy that ensures every encounter receives 1-3 imaging studies. This approach maintains the original intent while guaranteeing successful document generation.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when date-based matching between encounter dates and imaging study dates produces zero matches for an encounter
- **Property (P)**: The desired behavior - each encounter should be associated with 1-3 imaging studies to enable claim document generation
- **Preservation**: Existing date-matching logic, data structures, and document generation workflows that must remain unchanged
- **_map_encounters_to_studies**: The method in `patient_mapper.py` (line 169) that maps Synthea encounters to TCIA imaging studies
- **encounter_study_mapping**: Dictionary mapping encounter IDs to lists of ImagingStudy objects (currently contains empty lists)
- **date_window_days**: The ±30 day window used for date-based matching between encounters and studies
- **PatientMapping**: Data structure containing patient_id_mapping, encounter_study_mapping, and patient_names
- **ImagingStudy**: Dataclass containing study_uid, tcia_patient_id, modality, study_date, series_description, anatomical_region

## Bug Details

### Fault Condition

The bug manifests when the date-based matching algorithm in `_map_encounters_to_studies` fails to find any TCIA imaging studies within the ±30 day window of a Synthea encounter date. This occurs because Synthea generates encounters with recent dates (2024), while TCIA imaging studies have historical dates that don't align with the encounter timeline.

**Formal Specification:**
```
FUNCTION isBugCondition(encounter, patient_studies, date_window_days)
  INPUT: encounter of type Encounter
         patient_studies of type DataFrame (TCIA studies for one patient)
         date_window_days of type int (default 30)
  OUTPUT: boolean
  
  encounter_date := encounter.date
  start_date := encounter_date - timedelta(days=date_window_days)
  end_date := encounter_date + timedelta(days=date_window_days)
  
  matching_count := 0
  FOR EACH study_row IN patient_studies DO
    study_date := study_row['StudyDate'].date()
    IF start_date <= study_date <= end_date THEN
      matching_count := matching_count + 1
    END IF
  END FOR
  
  RETURN matching_count == 0
END FUNCTION
```

### Examples

- **Example 1**: Encounter on 2024-03-15 with ±30 day window (2024-02-14 to 2024-04-14), but all TCIA studies are from 2019-2021 → No matches → Empty imaging_studies list → 0 CMS-1500 forms generated

- **Example 2**: Encounter on 2024-06-20 for lung cancer patient with 5 available TCIA CT studies from 2020, but none fall within 2024-05-21 to 2024-07-20 window → No matches → 0 EOBs generated

- **Example 3**: Patient with 3 encounters (2024-01-10, 2024-03-15, 2024-05-20) mapped to TCIA patient with 8 imaging studies (all from 2019-2020) → All 3 encounters get empty study lists → 0 radiology reports generated

- **Edge Case**: Encounter on 2024-12-01 with TCIA studies from 2024-11-15 and 2024-12-10 → Date matching succeeds → 2 studies assigned → Expected behavior (no bug)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Date-based matching logic must continue to work when encounter and study dates do align (within ±30 day window)
- All existing data structures (PatientMapping, ImagingStudy, Encounter) must remain unchanged
- Document generation logic in document_generator.py must continue to work without modification
- Clinical note generation must continue to work for all encounters regardless of imaging study associations
- TCIA metadata extraction and validation must remain unchanged
- Synthea patient data processing must remain unchanged

**Scope:**
All inputs where date-based matching successfully finds studies (start_date <= study_date <= end_date) should be completely unaffected by this fix. This includes:
- Encounters where dates naturally align with imaging studies
- All downstream document generation processes (CMS-1500, EOB, radiology reports, clinical notes)
- Patient mapping structure and serialization
- Random seed behavior for reproducibility

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Temporal Misalignment**: Synthea generates synthetic patient encounters with current/recent dates (2024), while TCIA imaging studies are historical medical images with dates from previous years (2019-2021). The ±30 day window is too narrow to bridge this multi-year gap.

2. **No Fallback Mechanism**: The current implementation only uses date-based matching with no alternative strategy when dates don't align. If no studies fall within the date window, the encounter gets an empty list, and the function moves to the next encounter.

3. **Silent Failure**: The code stores empty lists in encounter_study_mapping without logging warnings or attempting alternative matching strategies. This causes downstream document generators to skip all claim document generation.

4. **Dataset Assumption**: The original implementation assumed that Synthea encounter dates and TCIA study dates would be temporally correlated, which is not the case when using real TCIA datasets with historical imaging data.

## Correctness Properties

Property 1: Fault Condition - Guaranteed Study Assignment

_For any_ encounter where the date-based matching produces zero matches (isBugCondition returns true), the fixed _map_encounters_to_studies function SHALL assign 1-3 imaging studies from the patient's available TCIA studies using a round-robin distribution strategy, ensuring that every encounter has associated imaging studies for claim document generation.

**Validates: Requirements 2.1, 2.6**

Property 2: Preservation - Date-Based Matching Behavior

_For any_ encounter where the date-based matching produces one or more matches (isBugCondition returns false), the fixed _map_encounters_to_studies function SHALL produce exactly the same result as the original function, preserving the date-proximity matching logic and study assignments.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `medical-claims-generator/src/medical_claims_generator/patient_mapper.py`

**Function**: `_map_encounters_to_studies` (line 169)

**Specific Changes**:

1. **Preserve Existing Date-Based Matching**: Keep the current date-window matching logic as the primary strategy (lines 192-233)

2. **Add Fallback Detection**: After date-based matching, check if matching_studies is empty for an encounter

3. **Implement Round-Robin Assignment**: When no date matches are found, assign studies using a round-robin strategy:
   - Track a study index counter for each patient
   - Randomly determine number of studies to assign (1-3) using self.random
   - Assign studies sequentially from patient_studies, wrapping around if needed
   - Ensure each encounter gets unique studies when possible

4. **Add Logging**: Log when fallback strategy is used for debugging and monitoring

5. **Maintain Randomness**: Use self.random (initialized with seed in __init__) for reproducible study count selection

**Pseudocode for Fallback Logic**:
```python
# After existing date-based matching loop (around line 233)
if len(matching_studies) == 0 and len(patient_studies) > 0:
    # Fallback: assign studies round-robin
    num_studies_to_assign = self.random.randint(1, min(3, len(patient_studies)))
    
    # Get or initialize study index for this patient
    if tcia_patient_id not in study_index_tracker:
        study_index_tracker[tcia_patient_id] = 0
    
    start_idx = study_index_tracker[tcia_patient_id]
    
    for i in range(num_studies_to_assign):
        study_idx = (start_idx + i) % len(patient_studies)
        study_row = patient_studies.iloc[study_idx]
        
        # Create ImagingStudy object (same as existing code)
        imaging_study = ImagingStudy(...)
        matching_studies.append(imaging_study)
    
    # Update index for next encounter
    study_index_tracker[tcia_patient_id] = (start_idx + num_studies_to_assign) % len(patient_studies)
    
    logger.info(f"Fallback: Assigned {num_studies_to_assign} studies to encounter {encounter.id}")
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (exploratory testing), then verify the fix works correctly and preserves existing behavior (fix checking and preservation checking).

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that date-based matching fails and produces empty study lists. This validates our root cause hypothesis.

**Test Plan**: Write tests that run the UNFIXED _map_encounters_to_studies method with real Synthea and TCIA data, then assert that encounter_study_mapping contains empty lists. Examine the date ranges to confirm temporal misalignment.

**Test Cases**:
1. **Empty Mapping Test**: Run patient mapper with 5 Synthea patients (2024 encounters) and TCIA data (2019-2021 studies), assert all encounters have empty imaging_studies lists (will fail on unfixed code - this is expected)
2. **Date Range Analysis**: Log encounter dates and study dates to confirm they don't overlap within ±30 days (will show temporal gap on unfixed code)
3. **Document Generation Impact**: Run full pipeline on unfixed code, assert that 0 CMS-1500 forms, 0 EOBs, 0 radiology reports are generated (will fail on unfixed code)
4. **Clinical Notes Still Generated**: Verify that clinical notes are still generated despite empty imaging studies (should pass on unfixed code)

**Expected Counterexamples**:
- All encounters will have empty imaging_studies lists in encounter_study_mapping
- Document generator will skip all claim document generation loops
- Output will show "Generated 0 CMS-1500 forms, 0 EOBs, 0 radiology reports, N clinical notes"
- Possible causes confirmed: temporal misalignment between Synthea (2024) and TCIA (2019-2021) dates

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (date matching fails), the fixed function produces the expected behavior (assigns 1-3 studies per encounter).

**Pseudocode:**
```
FOR ALL encounter WHERE isBugCondition(encounter, patient_studies, 30) DO
  result := _map_encounters_to_studies_fixed(...)
  imaging_studies := result[encounter.id]
  
  ASSERT len(imaging_studies) >= 1 AND len(imaging_studies) <= 3
  ASSERT all studies belong to correct TCIA patient
  ASSERT all studies are valid ImagingStudy objects
END FOR
```

**Test Cases**:
1. **Study Assignment Test**: Run fixed mapper with 10 patients, verify every encounter has 1-3 imaging studies
2. **Document Generation Test**: Run full pipeline with fixed code, verify CMS-1500 forms, EOBs, and radiology reports are generated (approximately 200-300 total documents for 100 patients)
3. **Round-Robin Distribution**: Verify that studies are distributed evenly across encounters for a patient
4. **Reproducibility Test**: Run mapper twice with same seed, verify identical study assignments

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (date matching succeeds), the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL encounter WHERE NOT isBugCondition(encounter, patient_studies, 30) DO
  result_original := _map_encounters_to_studies_original(...)
  result_fixed := _map_encounters_to_studies_fixed(...)
  
  ASSERT result_original[encounter.id] == result_fixed[encounter.id]
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Create synthetic test data where encounter dates and study dates DO align (within ±30 days), run both original and fixed code, verify identical results.

**Test Cases**:
1. **Aligned Dates Preservation**: Create test data with encounter date 2024-03-15 and study dates 2024-03-10, 2024-03-20 (within window), verify fixed code produces same matches as original
2. **Data Structure Preservation**: Verify PatientMapping structure is identical between original and fixed code
3. **Clinical Notes Preservation**: Verify clinical note generation continues to work identically
4. **Serialization Preservation**: Verify PatientMapping.to_json() produces same output structure

### Unit Tests

- Test _map_encounters_to_studies with various patient/study combinations
- Test fallback logic triggers correctly when date matching fails
- Test round-robin assignment distributes studies evenly
- Test edge cases: patient with 1 study, patient with 20 studies, patient with 0 studies
- Test random seed reproducibility for study count selection

### Property-Based Tests

- Generate random patient data with misaligned dates, verify all encounters get 1-3 studies
- Generate random patient data with aligned dates, verify date-based matching still works
- Generate random combinations of patient counts, encounter counts, study counts
- Verify that total number of study assignments is reasonable (not all encounters get same study)

### Integration Tests

- Run full pipeline (Synthea generation → patient mapping → document generation) with fixed code
- Verify output includes CMS-1500 forms, EOBs, radiology reports, and clinical notes
- Verify statistics show non-zero counts for all document types
- Verify generated PDFs are valid and contain correct patient/study information
- Test with different random seeds to ensure reproducibility
