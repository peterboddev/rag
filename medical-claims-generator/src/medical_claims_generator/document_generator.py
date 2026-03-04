"""
Document Generator

Orchestrates generation of all PDF documents including CMS-1500 forms,
EOB documents, radiology reports, and clinical notes.
"""

import logging
import random
from datetime import date, timedelta
from typing import List, Optional, Dict

from .models import (
    Patient,
    PatientMapping,
    DocumentSet,
    CMS1500Document,
    EOBDocument,
    RadiologyReport,
    ClinicalNote,
    ClaimStatus,
    PaymentInfo,
    ImagingStudy,
    Address
)
from .pdf_generators.cms1500_generator import CMS1500Generator
from .pdf_generators.eob_generator import EOBGenerator
from .pdf_generators.radiology_report_generator import RadiologyReportGenerator
from .pdf_generators.clinical_note_generator import ClinicalNoteGenerator

logger = logging.getLogger(__name__)


class DocumentGenerator:
    """Orchestrates generation of all PDF documents for medical claims."""
    
    # Provider information (used for all claims)
    PROVIDER_NAME = "Dr. Sarah Johnson"
    PROVIDER_NPI = "1234567890"
    PROVIDER_ADDRESS = Address(
        line1="123 Medical Plaza",
        line2="Suite 200",
        city="Boston",
        state="MA",
        postal_code="02101"
    )
    
    # Radiologist names (randomly selected)
    RADIOLOGISTS = [
        "Dr. Michael Chen",
        "Dr. Emily Rodriguez",
        "Dr. James Wilson",
        "Dr. Lisa Anderson"
    ]
    
    # Physician names (randomly selected)
    PHYSICIANS = [
        "Dr. Robert Martinez",
        "Dr. Jennifer Lee",
        "Dr. David Thompson",
        "Dr. Maria Garcia"
    ]
    
    # Denial reasons for denied claims
    DENIAL_REASONS = [
        "Service not covered under current policy. The requested procedure is not included in the patient's benefit plan.",
        "Prior authorization required but not obtained. Please submit prior authorization request and resubmit claim.",
        "Medical necessity not established. Additional documentation required to support the medical necessity of this service.",
        "Duplicate claim. This service has already been billed and processed under claim number {previous_claim}."
    ]
    
    def __init__(self, seed: Optional[int] = None):
        """
        Initialize document generator.
        
        Args:
            seed: Random seed for reproducible document generation
        """
        self.seed = seed
        if seed is not None:
            random.seed(seed)
        
        # Initialize PDF generators
        self.cms1500_generator = CMS1500Generator()
        self.eob_generator = EOBGenerator()
        self.radiology_generator = RadiologyReportGenerator()
        self.clinical_note_generator = ClinicalNoteGenerator()
        
        # Counters for unique IDs
        self._claim_counter = 1
        self._eob_counter = 1
        self._report_counter = 1
        self._note_counter = 1
    
    def generate_all_documents(
        self,
        patients: List[Patient],
        mapping: PatientMapping
    ) -> DocumentSet:
        """
        Generate all documents for all patients.
        
        Args:
            patients: List of Patient objects
            mapping: PatientMapping containing patient and encounter mappings
            
        Returns:
            DocumentSet containing all generated documents
        """
        logger.info(f"Generating documents for {len(patients)} patients")
        
        cms1500_forms = []
        eob_documents = []
        radiology_reports = []
        clinical_notes = []
        
        # Generate documents for each patient
        for idx, patient in enumerate(patients, 1):
            logger.debug(f"Processing patient {idx}/{len(patients)}: {patient.id}")
            
            # Get TCIA patient ID for this patient
            tcia_patient_id = mapping.patient_id_mapping.get(patient.id)
            if not tcia_patient_id:
                logger.warning(f"No TCIA mapping found for patient {patient.id}, skipping")
                continue
            
            # Generate documents for each encounter
            for encounter in patient.encounters:
                # Get imaging studies for this encounter
                imaging_studies = mapping.encounter_study_mapping.get(encounter.id, [])
                
                # Generate clinical note for this encounter
                clinical_note = self.generate_clinical_note(
                    patient=patient,
                    encounter=encounter,
                    tcia_patient_id=tcia_patient_id,
                    imaging_studies=imaging_studies
                )
                clinical_notes.append(clinical_note)
                
                # Generate documents for each imaging study
                for imaging_study in imaging_studies:
                    # Generate CMS-1500 claim form
                    cms1500 = self.generate_cms1500(
                        patient=patient,
                        encounter=encounter,
                        imaging_study=imaging_study,
                        tcia_patient_id=tcia_patient_id
                    )
                    cms1500_forms.append(cms1500)
                    
                    # Generate EOB document with status distribution
                    eob = self.generate_eob(
                        cms1500=cms1500,
                        patient=patient,
                        encounter=encounter
                    )
                    eob_documents.append(eob)
                    
                    # Generate radiology report
                    radiology_report = self.generate_radiology_report(
                        patient=patient,
                        imaging_study=imaging_study,
                        tcia_patient_id=tcia_patient_id
                    )
                    radiology_reports.append(radiology_report)
        
        logger.info(f"Document generation complete: {len(cms1500_forms)} CMS-1500 forms, "
                   f"{len(eob_documents)} EOBs, {len(radiology_reports)} radiology reports, "
                   f"{len(clinical_notes)} clinical notes")
        
        return DocumentSet(
            cms1500_forms=cms1500_forms,
            eob_documents=eob_documents,
            radiology_reports=radiology_reports,
            clinical_notes=clinical_notes
        )
    
    def generate_cms1500(
        self,
        patient: Patient,
        encounter: any,
        imaging_study: ImagingStudy,
        tcia_patient_id: str
    ) -> CMS1500Document:
        """
        Generate CMS-1500 claim form using CMS1500Generator.
        
        Args:
            patient: Patient information
            encounter: Encounter details
            imaging_study: Imaging study information
            tcia_patient_id: TCIA patient identifier
            
        Returns:
            CMS1500Document with generated PDF
        """
        # Generate unique claim number
        claim_number = f"CLM{self._claim_counter:06d}"
        self._claim_counter += 1
        
        # Select procedure code (CPT code for CT imaging: 71250-71275)
        procedure_code = str(random.randint(71250, 71275))
        
        # Generate procedure charge ($500-$3000)
        procedure_charge = round(random.uniform(500.0, 3000.0), 2)
        
        # Get diagnosis codes from patient conditions
        diagnosis_codes = [condition.code for condition in patient.conditions[:4]]
        if not diagnosis_codes:
            # Default diagnosis code if none available
            diagnosis_codes = ["C34.90"]  # Malignant neoplasm of unspecified part of bronchus or lung
        
        # Generate PDF using CMS1500Generator
        pdf_bytes = self.cms1500_generator.generate(
            patient=patient,
            provider_name=self.PROVIDER_NAME,
            provider_npi=self.PROVIDER_NPI,
            provider_address=self.PROVIDER_ADDRESS,
            diagnosis_codes=diagnosis_codes,
            procedure_code=procedure_code,
            procedure_charge=procedure_charge,
            service_date=encounter.date,
            study_uid=imaging_study.study_uid,
            claim_number=claim_number
        )
        
        # Create filename
        filename = f"cms1500_{claim_number}.pdf"
        
        return CMS1500Document(
            claim_number=claim_number,
            patient_id=patient.id,
            tcia_patient_id=tcia_patient_id,
            encounter_id=encounter.id,
            study_uid=imaging_study.study_uid,
            procedure_code=procedure_code,
            diagnosis_codes=diagnosis_codes,
            pdf_bytes=pdf_bytes,
            filename=filename
        )
    
    def generate_eob(
        self,
        cms1500: CMS1500Document,
        patient: Patient,
        encounter: any
    ) -> EOBDocument:
        """
        Generate EOB document using EOBGenerator with status distribution.
        
        Status distribution: 60% approved, 20% denied, 20% pending
        
        Args:
            cms1500: CMS1500Document to reference
            patient: Patient information
            encounter: Encounter details
            
        Returns:
            EOBDocument with generated PDF
        """
        # Generate unique EOB number
        eob_number = f"EOB{self._eob_counter:06d}"
        self._eob_counter += 1
        
        # Assign claim status based on distribution (60/20/20)
        rand_value = random.random()
        if rand_value < 0.6:
            status = ClaimStatus.APPROVED
        elif rand_value < 0.8:
            status = ClaimStatus.DENIED
        else:
            status = ClaimStatus.PENDING
        
        # Generate payment info for approved claims
        payment_info = None
        if status == ClaimStatus.APPROVED:
            # Payment is typically 70-90% of billed amount
            billed_amount = float(cms1500.procedure_code)  # Using procedure code as proxy for amount
            payment_amount = round(random.uniform(500.0, 2500.0), 2)
            payment_date = encounter.date + timedelta(days=random.randint(14, 45))
            payment_info = PaymentInfo(
                amount=payment_amount,
                payment_date=payment_date
            )
        
        # Generate denial reason for denied claims
        denial_reason = None
        if status == ClaimStatus.DENIED:
            denial_reason = random.choice(self.DENIAL_REASONS)
            # Replace placeholder if present
            if "{previous_claim}" in denial_reason:
                previous_claim = f"CLM{random.randint(1, self._claim_counter - 1):06d}"
                denial_reason = denial_reason.replace("{previous_claim}", previous_claim)
        
        # Get billed amount (estimate from procedure code range)
        billed_amount = round(random.uniform(500.0, 3000.0), 2)
        
        # Generate PDF using EOBGenerator
        pdf_bytes = self.eob_generator.generate(
            eob_number=eob_number,
            claim_number=cms1500.claim_number,
            patient=patient,
            status=status,
            payment_info=payment_info,
            denial_reason=denial_reason,
            service_date=encounter.date,
            billed_amount=billed_amount
        )
        
        # Create filename
        filename = f"eob_{eob_number}.pdf"
        
        return EOBDocument(
            eob_number=eob_number,
            claim_number=cms1500.claim_number,
            patient_id=patient.id,
            tcia_patient_id=cms1500.tcia_patient_id,
            status=status,
            payment_info=payment_info,
            denial_reason=denial_reason,
            pdf_bytes=pdf_bytes,
            filename=filename
        )
    
    def generate_radiology_report(
        self,
        patient: Patient,
        imaging_study: ImagingStudy,
        tcia_patient_id: str
    ) -> RadiologyReport:
        """
        Generate radiology report using RadiologyReportGenerator.
        
        Args:
            patient: Patient information
            imaging_study: Imaging study information
            tcia_patient_id: TCIA patient identifier
            
        Returns:
            RadiologyReport with generated PDF
        """
        # Generate unique report ID
        report_id = f"RAD{self._report_counter:06d}"
        self._report_counter += 1
        
        # Determine cancer type from patient conditions
        cancer_type = "lung_cancer"  # Default
        for condition in patient.conditions:
            if "lung" in condition.category.lower():
                cancer_type = "lung_cancer"
                break
            elif "colorectal" in condition.category.lower() or "colon" in condition.category.lower():
                cancer_type = "colorectal_cancer"
                break
        
        # Select radiologist
        radiologist = random.choice(self.RADIOLOGISTS)
        
        # Generate PDF using RadiologyReportGenerator
        pdf_bytes = self.radiology_generator.generate(
            patient=patient,
            study_uid=imaging_study.study_uid,
            modality=imaging_study.modality,
            anatomical_region=imaging_study.anatomical_region,
            cancer_type=cancer_type,
            radiologist=radiologist,
            report_date=imaging_study.study_date
        )
        
        # Create filename
        filename = f"radiology_report_{report_id}.pdf"
        
        # Generate findings summary (for metadata)
        findings = f"Imaging findings consistent with {cancer_type.replace('_', ' ')}"
        
        return RadiologyReport(
            report_id=report_id,
            patient_id=patient.id,
            tcia_patient_id=tcia_patient_id,
            study_uid=imaging_study.study_uid,
            modality=imaging_study.modality,
            anatomical_region=imaging_study.anatomical_region,
            findings=findings,
            radiologist=radiologist,
            report_date=imaging_study.study_date,
            pdf_bytes=pdf_bytes,
            filename=filename
        )
    
    def generate_clinical_note(
        self,
        patient: Patient,
        encounter: any,
        tcia_patient_id: str,
        imaging_studies: List[ImagingStudy]
    ) -> ClinicalNote:
        """
        Generate clinical note using ClinicalNoteGenerator.
        
        Args:
            patient: Patient information
            encounter: Encounter details
            tcia_patient_id: TCIA patient identifier
            imaging_studies: List of imaging studies for this encounter
            
        Returns:
            ClinicalNote with generated PDF
        """
        # Generate unique note ID
        note_id = f"NOTE{self._note_counter:06d}"
        self._note_counter += 1
        
        # Determine cancer type from patient conditions
        cancer_type = "lung_cancer"  # Default
        for condition in patient.conditions:
            if "lung" in condition.category.lower():
                cancer_type = "lung_cancer"
                break
            elif "colorectal" in condition.category.lower() or "colon" in condition.category.lower():
                cancer_type = "colorectal_cancer"
                break
        
        # Generate imaging orders from imaging studies
        imaging_orders = []
        for study in imaging_studies:
            order = f"{study.modality} {study.anatomical_region} with contrast"
            imaging_orders.append(order)
        
        # Select physician
        physician = random.choice(self.PHYSICIANS)
        
        # Generate PDF using ClinicalNoteGenerator
        pdf_bytes = self.clinical_note_generator.generate(
            patient=patient,
            encounter=encounter,
            imaging_orders=imaging_orders,
            cancer_type=cancer_type,
            physician=physician
        )
        
        # Create filename
        filename = f"clinical_note_{note_id}.pdf"
        
        # Generate symptoms summary (for metadata)
        symptoms = encounter.reason if encounter.reason else ["Routine examination"]
        
        # Generate treatment plan summary (for metadata)
        treatment_plan = f"Ordered {len(imaging_orders)} imaging studies for evaluation"
        
        return ClinicalNote(
            note_id=note_id,
            patient_id=patient.id,
            tcia_patient_id=tcia_patient_id,
            encounter_id=encounter.id,
            symptoms=symptoms,
            imaging_orders=imaging_orders,
            treatment_plan=treatment_plan,
            physician=physician,
            note_date=encounter.date,
            pdf_bytes=pdf_bytes,
            filename=filename
        )
