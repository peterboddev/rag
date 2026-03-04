"""
EOB Document Generator

Generates Explanation of Benefits documents as PDFs using ReportLab.
"""

from datetime import date
from typing import Optional
from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib import colors

from ..models import Patient, ClaimStatus, PaymentInfo


class EOBGenerator:
    """Generates Explanation of Benefits documents as PDF documents."""
    
    def __init__(self):
        """Initialize the EOB generator."""
        self.page_width, self.page_height = letter
    
    def generate(
        self,
        eob_number: str,
        claim_number: str,
        patient: Patient,
        status: ClaimStatus,
        payment_info: Optional[PaymentInfo] = None,
        denial_reason: Optional[str] = None,
        service_date: date = None,
        billed_amount: float = 0.0
    ) -> bytes:
        """
        Generate an Explanation of Benefits document as PDF bytes.
        
        Args:
            eob_number: Unique EOB identifier
            claim_number: Reference to corresponding CMS-1500 claim
            patient: Patient information
            status: Claim processing status (APPROVED, DENIED, PENDING)
            payment_info: Payment details for approved claims
            denial_reason: Reason for denial if claim is denied
            service_date: Date of service
            billed_amount: Amount billed for the service
            
        Returns:
            PDF document as bytes
        """
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        
        # Draw document sections
        self._draw_header(c, eob_number)
        self._draw_patient_info(c, patient)
        self._draw_claim_reference(c, claim_number)
        self._draw_claim_status(c, status, payment_info, denial_reason)
        self._draw_service_summary(c, service_date, billed_amount, status, payment_info)
        self._draw_footer(c)
        
        c.showPage()
        c.save()
        
        buffer.seek(0)
        return buffer.read()
    
    def _draw_header(self, c: canvas.Canvas, eob_number: str) -> None:
        """Draw the EOB header."""
        c.setFont("Helvetica-Bold", 18)
        c.drawString(1 * inch, 10.5 * inch, "EXPLANATION OF BENEFITS")
        
        c.setFont("Helvetica", 10)
        c.drawString(1 * inch, 10.2 * inch, f"EOB Number: {eob_number}")
        c.drawString(1 * inch, 10 * inch, f"Date Issued: {date.today().strftime('%m/%d/%Y')}")
        
        # Draw horizontal line
        c.line(0.5 * inch, 9.8 * inch, 8 * inch, 9.8 * inch)
    
    def _draw_patient_info(self, c: canvas.Canvas, patient: Patient) -> None:
        """Draw patient information section."""
        y = 9.4 * inch
        
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "PATIENT INFORMATION")
        
        c.setFont("Helvetica", 9)
        y -= 0.3 * inch
        
        c.drawString(0.5 * inch, y, f"Patient Name: {patient.name}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Patient ID: {patient.id}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Date of Birth: {patient.birth_date.strftime('%m/%d/%Y')}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Policy Number: {patient.insurance.policy_number}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Insurance: {patient.insurance.payer_name}")
        
        # Draw section separator
        y -= 0.2 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_claim_reference(self, c: canvas.Canvas, claim_number: str) -> None:
        """Draw claim reference section."""
        y = 7.8 * inch
        
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "CLAIM REFERENCE")
        
        c.setFont("Helvetica", 9)
        y -= 0.3 * inch
        
        c.drawString(0.5 * inch, y, f"Related Claim Number: {claim_number}")
        
        # Draw section separator
        y -= 0.2 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_claim_status(
        self,
        c: canvas.Canvas,
        status: ClaimStatus,
        payment_info: Optional[PaymentInfo],
        denial_reason: Optional[str]
    ) -> None:
        """Draw claim status section with status-specific information."""
        y = 7.2 * inch
        
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "CLAIM STATUS")
        
        y -= 0.3 * inch
        
        # Status with color coding
        if status == ClaimStatus.APPROVED:
            c.setFillColor(colors.green)
            c.setFont("Helvetica-Bold", 12)
            c.drawString(0.5 * inch, y, "STATUS: APPROVED")
            c.setFillColor(colors.black)
            
            if payment_info:
                y -= 0.3 * inch
                c.setFont("Helvetica", 9)
                c.drawString(0.5 * inch, y, f"Payment Amount: ${payment_info.amount:.2f}")
                y -= 0.2 * inch
                c.drawString(0.5 * inch, y, f"Payment Date: {payment_info.payment_date.strftime('%m/%d/%Y')}")
                y -= 0.2 * inch
                c.drawString(0.5 * inch, y, "Payment Method: Electronic Funds Transfer")
        
        elif status == ClaimStatus.DENIED:
            c.setFillColor(colors.red)
            c.setFont("Helvetica-Bold", 12)
            c.drawString(0.5 * inch, y, "STATUS: DENIED")
            c.setFillColor(colors.black)
            
            if denial_reason:
                y -= 0.3 * inch
                c.setFont("Helvetica-Bold", 9)
                c.drawString(0.5 * inch, y, "Denial Reason:")
                y -= 0.2 * inch
                c.setFont("Helvetica", 9)
                
                # Wrap denial reason text if needed
                max_width = 7 * inch
                words = denial_reason.split()
                line = ""
                for word in words:
                    test_line = line + word + " "
                    if c.stringWidth(test_line, "Helvetica", 9) < max_width:
                        line = test_line
                    else:
                        c.drawString(1 * inch, y, line.strip())
                        y -= 0.2 * inch
                        line = word + " "
                if line:
                    c.drawString(1 * inch, y, line.strip())
                    y -= 0.2 * inch
                
                c.drawString(0.5 * inch, y, "You may appeal this decision within 60 days.")
        
        else:  # PENDING
            c.setFillColor(colors.orange)
            c.setFont("Helvetica-Bold", 12)
            c.drawString(0.5 * inch, y, "STATUS: PENDING")
            c.setFillColor(colors.black)
            
            y -= 0.3 * inch
            c.setFont("Helvetica", 9)
            c.drawString(0.5 * inch, y, "Your claim is currently under review.")
            y -= 0.2 * inch
            c.drawString(0.5 * inch, y, "You will receive an update within 30 business days.")
        
        # Draw section separator
        y -= 0.3 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
    
    def _draw_service_summary(
        self,
        c: canvas.Canvas,
        service_date: date,
        billed_amount: float,
        status: ClaimStatus,
        payment_info: Optional[PaymentInfo]
    ) -> None:
        """Draw service summary section."""
        y = 5.2 * inch
        
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "SERVICE SUMMARY")
        
        c.setFont("Helvetica", 8)
        y -= 0.25 * inch
        
        # Table headers
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0.5 * inch, y, "Service Date")
        c.drawString(2 * inch, y, "Billed Amount")
        c.drawString(3.5 * inch, y, "Allowed Amount")
        c.drawString(5 * inch, y, "Patient Responsibility")
        c.drawString(6.8 * inch, y, "Paid Amount")
        
        y -= 0.25 * inch
        c.setFont("Helvetica", 8)
        
        # Service details
        if service_date:
            c.drawString(0.5 * inch, y, service_date.strftime("%m/%d/%Y"))
        else:
            c.drawString(0.5 * inch, y, "N/A")
        
        c.drawString(2 * inch, y, f"${billed_amount:.2f}")
        
        # Calculate amounts based on status
        if status == ClaimStatus.APPROVED and payment_info:
            allowed_amount = payment_info.amount
            patient_responsibility = billed_amount - allowed_amount if billed_amount > allowed_amount else 0.0
            paid_amount = payment_info.amount
        elif status == ClaimStatus.DENIED:
            allowed_amount = 0.0
            patient_responsibility = billed_amount
            paid_amount = 0.0
        else:  # PENDING
            allowed_amount = 0.0
            patient_responsibility = 0.0
            paid_amount = 0.0
        
        c.drawString(3.5 * inch, y, f"${allowed_amount:.2f}")
        c.drawString(5 * inch, y, f"${patient_responsibility:.2f}")
        c.drawString(6.8 * inch, y, f"${paid_amount:.2f}")
        
        # Draw section separator
        y -= 0.3 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        # Add explanation
        y -= 0.3 * inch
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "EXPLANATION")
        
        y -= 0.25 * inch
        c.setFont("Helvetica", 8)
        
        if status == ClaimStatus.APPROVED:
            c.drawString(0.5 * inch, y, "Your claim has been processed and approved. Payment has been issued.")
        elif status == ClaimStatus.DENIED:
            c.drawString(0.5 * inch, y, "Your claim has been denied. Please review the denial reason above.")
            y -= 0.2 * inch
            c.drawString(0.5 * inch, y, "You are responsible for the full billed amount.")
        else:  # PENDING
            c.drawString(0.5 * inch, y, "Your claim is being reviewed. No action is required at this time.")
    
    def _draw_footer(self, c: canvas.Canvas) -> None:
        """Draw footer with contact information."""
        y = 1.5 * inch
        
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0.5 * inch, y, "QUESTIONS?")
        
        y -= 0.25 * inch
        c.setFont("Helvetica", 8)
        c.drawString(0.5 * inch, y, "If you have questions about this Explanation of Benefits, please contact:")
        
        y -= 0.2 * inch
        c.drawString(0.5 * inch, y, "Customer Service: 1-800-555-0123")
        
        y -= 0.2 * inch
        c.drawString(0.5 * inch, y, "Hours: Monday-Friday, 8:00 AM - 6:00 PM EST")
        
        # Bottom disclaimer
        y = 0.5 * inch
        c.setFont("Helvetica", 7)
        c.drawString(0.5 * inch, y, "This is not a bill. This is a summary of services provided and how your claim was processed.")
        c.drawString(0.5 * inch, y - 0.15 * inch, "Please retain this document for your records.")
