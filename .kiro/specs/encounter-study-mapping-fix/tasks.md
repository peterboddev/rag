# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Fault Condition** - Empty Study Mapping on Date Mismatch
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Test with real Synthea (2024 encounters) and TCIA data (2019-2021 studies) to ensure reproducibility
  - Test that _map_encounters_to_studies produces empty imaging_studies lists when encounter dates (2024) don't align with TCIA study dates (2019-2021) within ±30 day window
  - The test assertions should verify that after fix, every encounter has 1-3 imaging studies assigned (from Fault Condition in design)
  - Run test on UNFIXED code in `medical-claims-generator/src/medical_claims_generator/patient_mapper.py`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: empty encounter_study_mapping entries, 0 claim documents generated
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Date-Based Matching Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for encounters where dates DO align (within ±30 day window)
  - Create test data with aligned dates: encounter date 2024-03-15 and study dates 2024-03-10, 2024-03-20
  - Write property-based tests capturing observed date-matching behavior from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees that date-matching logic is unchanged
  - Verify that when dates align, the same studies are matched by date proximity
  - Verify PatientMapping data structure remains identical
  - Verify clinical note generation continues to work identically
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for encounter-study mapping empty arrays

  - [x] 3.1 Implement the fallback round-robin assignment logic
    - Modify `_map_encounters_to_studies` method in `medical-claims-generator/src/medical_claims_generator/patient_mapper.py` (line 169)
    - Preserve existing date-based matching logic (lines 192-233)
    - Add fallback detection: check if matching_studies is empty after date-based matching
    - Implement round-robin assignment when no date matches found:
      - Initialize study_index_tracker dictionary to track position for each patient
      - Randomly select 1-3 studies using self.random.randint(1, min(3, len(patient_studies)))
      - Assign studies sequentially from patient_studies, wrapping around with modulo
      - Update study_index_tracker for next encounter
    - Add logging: logger.info when fallback strategy is used
    - Maintain randomness with self.random for reproducibility
    - _Bug_Condition: isBugCondition(encounter, patient_studies, 30) where date-based matching produces zero matches_
    - _Expected_Behavior: Every encounter SHALL have 1-3 imaging studies assigned when date matching fails (Property 1 from design)_
    - _Preservation: Date-based matching logic, PatientMapping structure, document generation workflows, clinical note generation must remain unchanged (Property 2 from design)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Guaranteed Study Assignment
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (1-3 studies per encounter)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - Verify all encounters now have 1-3 imaging studies in encounter_study_mapping
    - Verify claim documents (CMS-1500, EOBs, radiology reports) are now generated
    - _Requirements: 2.1, 2.6_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Date-Based Matching Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm date-based matching still works identically when dates align
    - Confirm PatientMapping structure unchanged
    - Confirm clinical note generation unchanged
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all unit tests for patient_mapper.py
  - Run integration test with full pipeline (Synthea → mapping → document generation)
  - Verify output statistics show non-zero counts for CMS-1500 forms, EOBs, radiology reports
  - Verify clinical notes continue to be generated
  - Verify reproducibility with same random seed
  - Ensure all tests pass, ask the user if questions arise
