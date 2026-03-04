"""
CMS-1500 Form Generator

Generates CMS-1500 claim forms as PDFs using ReportLab.
"""

from datetime import date
from typing import List
from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib import colors

from ..models import Patient, Address, Insurance


class CMS1500Generator:
    """Generates CMS-1500 claim forms as PDF documents."""
    
    def __init__(self):
        """Initialize the CMS-1500 generator."""
        self.page_width, self.page_height = letter
        
    def generate(
        self,
        patient: Patient,
        provider_name: str,
        provider_npi: str,
        provider_address: Address,
        diagnosis_codes: List[str],
        procedure_code: str,
        procedure_charge: float,
        service_date: date,
        study_uid: str,
        claim_number: str
    ) -> bytes:
        """
        Generate a CMS-1500 form as PDF bytes.
        
        Args:
            patient: Patient information
            provider_name: Healthcare provider name
            provider_npi: Provider NPI number
            provider_address: Provider address
            diagnosis_codes: List of ICD-10 diagnosis codes
            procedure_code: CPT procedure code
            procedure_charge: Charge amount for the procedure
            service_date: Date of service
            study_uid: DICOM Study UID
            claim_number: Unique claim identifier
            
        Returns:
            PDF document as bytes
        """
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        
        # Draw form title
        self._draw_header(c, claim_number)
        
        # Draw form sections
        self._draw_patient_info(c, patient)
        self._draw_insurance_info(c, patient.insurance)
        self._draw_diagnosis_codes(c, diagnosis_codes)
        self._draw_service_line(c, service_date, procedure_code, procedure_charge)
        self._draw_provider_info(c, provider_name, provider_npi, provider_address)
        self._draw_study_uid_note(c, study_uid)
        
        c.showPage()
        c.save()
        
        buffer.seek(0)
        return buffer.read()
    
    def _draw_header(self, c: canvas.Canvas, claim_number: str) -> None:
        """Draw the form header."""
        c.setFont("Helvetica-Bold", 16)
        c.drawString(1 * inch, 10.5 * inch, "CMS-1500 HEALTH INSURANCE CLAIM FORM")
        
        c.setFont("Helvetica", 10)
        c.drawString(1 * inch, 10.2 * inch, f"Claim Number: {claim_number}")
        
        # Draw horizontal line
        c.line(0.5 * inch, 10 * inch, 8 * inch, 10 * inch)
    
    def _draw_patient_info(self, c: canvas.Canvas, patient: Patient) -> None:
        """Draw patient information section (boxes 1-13)."""
        y_start = 9.5 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y_start, "PATIENT INFORMATION")
        
        c.setFont("Helvetica", 8)
        y = y_start - 0.3 * inch
        
        # Box 2: Patient Name
        c.drawString(0.5 * inch, y, "2. PATIENT'S NAME:")
        c.drawString(2 * inch, y, patient.name)
        y -= 0.25 * inch
        
        # Box 3: Patient Birth Date
        c.drawString(0.5 * inch, y, "3. PATIENT'S BIRTH DATE:")
        c.drawString(2 * inch, y, patient.birth_date.strftime("%m/%d/%Y"))
        c.drawString(3.5 * inch, y, f"SEX: {patient.gender}")
        y -= 0.25 * inch
        
        # Box 5: Patient Address
        c.drawString(0.5 * inch, y, "5. PATIENT'S ADDRESS:")
        c.drawString(2 * inch, y, patient.address.line1)
        y -= 0.2 * inch
        
        if patient.address.line2:
            c.drawString(2 * inch, y, patient.address.line2)
            y -= 0.2 * inch
        
        c.drawString(2 * inch, y, f"{patient.address.city}, {patient.address.state} {patient.address.postal_code}")
        y -= 0.3 * inch
        
        # Box 1a: Insured's ID Number
        c.drawString(0.5 * inch, y, "1a. INSURED'S I.D. NUMBER:")
        c.drawString(2.5 * inch, y, patient.insurance.policy_number)
        
        # Draw section separator
        y -= 0.2 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_insurance_info(self, c: canvas.Canvas, insurance: Insurance) -> None:
        """Draw insurance information section."""
        y = 8 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "INSURANCE INFORMATION")
        
        c.setFont("Helvetica", 8)
        y -= 0.3 * inch
        
        # Box 1: Insurance Type (Medicare, Medicaid, etc.)
        c.drawString(0.5 * inch, y, "1. INSURANCE TYPE:")
        c.drawString(2 * inch, y, "OTHER")
        y -= 0.25 * inch
        
        # Box 4: Insured's Name
        c.drawString(0.5 * inch, y, "4. INSURED'S NAME:")
        c.drawString(2 * inch, y, insurance.payer_name)
        y -= 0.25 * inch
        
        # Box 11: Insured's Policy Group
        if insurance.group_number:
            c.drawString(0.5 * inch, y, "11. INSURED'S POLICY GROUP:")
            c.drawString(2.5 * inch, y, insurance.group_number)
            y -= 0.25 * inch
        
        # Draw section separator
        y -= 0.1 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_diagnosis_codes(self, c: canvas.Canvas, diagnosis_codes: List[str]) -> None:
        """Draw diagnosis codes section (box 21)."""
        y = 6.8 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "21. DIAGNOSIS OR NATURE OF ILLNESS OR INJURY")
        
        c.setFont("Helvetica", 8)
        y -= 0.3 * inch
        
        # Display up to 4 diagnosis codes (A-D)
        labels = ['A.', 'B.', 'C.', 'D.']
        x_positions = [0.5 * inch, 2.5 * inch, 4.5 * inch, 6.5 * inch]
        
        for i, (label, code) in enumerate(zip(labels, diagnosis_codes[:4])):
            col = i % 2
            row = i // 2
            x = x_positions[col * 2]
            y_pos = y - (row * 0.25 * inch)
            c.drawString(x, y_pos, f"{label} {code}")
        
        # Draw section separator
        y -= 0.6 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_service_line(
        self,
        c: canvas.Canvas,
        service_date: date,
        procedure_code: str,
        charge: float
    ) -> None:
        """Draw service line section (box 24)."""
        y = 5.8 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "24. SERVICE DETAILS")
        
        c.setFont("Helvetica", 7)
        y -= 0.2 * inch
        
        # Column headers
        c.drawString(0.5 * inch, y, "DATE OF SERVICE")
        c.drawString(1.8 * inch, y, "PLACE")
        c.drawString(2.5 * inch, y, "PROCEDURES")
        c.drawString(3.5 * inch, y, "DIAGNOSIS")
        c.drawString(4.5 * inch, y, "CHARGES")
        c.drawString(5.5 * inch, y, "UNITS")
        
        y -= 0.25 * inch
        c.setFont("Helvetica", 8)
        
        # Service line data
        date_str = service_date.strftime("%m/%d/%Y")
        c.drawString(0.5 * inch, y, date_str)
        c.drawString(1.8 * inch, y, "11")  # Office
        c.drawString(2.5 * inch, y, procedure_code)
        c.drawString(3.5 * inch, y, "A")  # Points to diagnosis A
        c.drawString(4.5 * inch, y, f"${charge:.2f}")
        c.drawString(5.5 * inch, y, "1")
        
        # Draw section separator
        y -= 0.3 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_provider_info(
        self,
        c: canvas.Canvas,
        provider_name: str,
        provider_npi: str,
        provider_address: Address
    ) -> None:
        """Draw provider information section."""
        y = 4.8 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "PROVIDER INFORMATION")
        
        c.setFont("Helvetica", 8)
        y -= 0.3 * inch
        
        # Box 31: Physician/Supplier Signature
        c.drawString(0.5 * inch, y, "31. SIGNATURE OF PHYSICIAN:")
        c.drawString(2.5 * inch, y, provider_name)
        y -= 0.25 * inch
        
        # Box 32: Service Facility Location
        c.drawString(0.5 * inch, y, "32. SERVICE FACILITY LOCATION:")
        y -= 0.2 * inch
        c.drawString(1 * inch, y, provider_address.line1)
        y -= 0.2 * inch
        c.drawString(1 * inch, y, f"{provider_address.city}, {provider_address.state} {provider_address.postal_code}")
        y -= 0.3 * inch
        
        # Box 33: Billing Provider Info & NPI
        c.drawString(0.5 * inch, y, "33. BILLING PROVIDER INFO & NPI:")
        y -= 0.2 * inch
        c.drawString(1 * inch, y, provider_name)
        y -= 0.2 * inch
        c.drawString(1 * inch, y, f"NPI: {provider_npi}")
        
        # Draw section separator
        y -= 0.2 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_study_uid_note(self, c: canvas.Canvas, study_uid: str) -> None:
        """Draw Study UID in notes section."""
        y = 2.8 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "ADDITIONAL INFORMATION")
        
        c.setFont("Helvetica", 8)
        y -= 0.3 * inch
        
        c.drawString(0.5 * inch, y, "DICOM Study UID:")
        y -= 0.2 * inch
        c.drawString(1 * inch, y, study_uid)
        
        # Draw footer
        y = 1 * inch
        c.setFont("Helvetica", 7)
        c.drawString(0.5 * inch, y, "APPROVED BY NUCC")
        c.drawString(6.5 * inch, y, "FORM CMS-1500 (02/12)")
