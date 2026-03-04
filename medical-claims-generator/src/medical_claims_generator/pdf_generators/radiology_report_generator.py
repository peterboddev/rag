"""
Radiology Report Generator

Generates radiology reports as PDFs using ReportLab.
"""

from datetime import date
from typing import Dict
from io import BytesIO
import random

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from ..models import Patient


class RadiologyReportGenerator:
    """Generates radiology reports as PDF documents."""
    
    # Mapping of cancer types to realistic findings
    FINDINGS_TEMPLATES: Dict[str, str] = {
        "lung_cancer": """There is a {size} cm spiculated mass in the {location} lobe of the lung. The mass demonstrates irregular margins and appears to invade the adjacent pleura. Associated mediastinal lymphadenopathy is noted, with enlarged lymph nodes measuring up to {lymph_size} cm in the {lymph_location} station.

No pleural effusion is identified. The remaining lung parenchyma shows no acute abnormality. The heart size is within normal limits.

IMPRESSION:
1. Suspicious lung mass in the {location} lobe with features concerning for primary lung malignancy. Clinical correlation and tissue diagnosis recommended.
2. Mediastinal lymphadenopathy, likely representing nodal metastases.""",
        
        "colorectal_cancer": """There is focal wall thickening of the {location} colon measuring approximately {size} cm in length. The wall thickness measures up to {thickness} mm. Associated pericolic fat stranding and lymphadenopathy are present.

Multiple enlarged mesenteric lymph nodes are identified, the largest measuring {lymph_size} cm. No evidence of distant metastatic disease in the visualized portions of the liver or lungs.

The remaining bowel loops appear unremarkable. No free fluid or pneumoperitoneum is identified.

IMPRESSION:
1. Focal wall thickening of the {location} colon with associated lymphadenopathy, highly suspicious for colorectal malignancy. Recommend colonoscopy with biopsy.
2. Regional lymphadenopathy, concerning for nodal involvement."""
    }
    
    # Anatomical variations for realistic reports
    LUNG_LOCATIONS = ["right upper", "right middle", "right lower", "left upper", "left lower"]
    COLON_LOCATIONS = ["ascending", "transverse", "descending", "sigmoid"]
    LYMPH_STATIONS = ["paratracheal", "subcarinal", "hilar"]
    
    def __init__(self):
        """Initialize the radiology report generator."""
        self.page_width, self.page_height = letter
    
    def generate(
        self,
        patient: Patient,
        study_uid: str,
        modality: str,
        anatomical_region: str,
        cancer_type: str,
        radiologist: str,
        report_date: date
    ) -> bytes:
        """
        Generate a radiology report as PDF bytes.
        
        Args:
            patient: Patient information
            study_uid: DICOM Study UID
            modality: Imaging modality (e.g., "CT")
            anatomical_region: Anatomical region scanned
            cancer_type: Type of cancer (lung_cancer, colorectal_cancer)
            radiologist: Radiologist name
            report_date: Date of the report
            
        Returns:
            PDF document as bytes
        """
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        
        # Draw header
        self._draw_header(c)
        
        # Draw patient information
        y = self._draw_patient_info(c, patient, 9.5 * inch)
        
        # Draw study information
        y = self._draw_study_info(c, study_uid, modality, anatomical_region, report_date, y - 0.3 * inch)
        
        # Draw clinical indication
        y = self._draw_section(c, "CLINICAL INDICATION", 
                               "Evaluation for suspected malignancy. Clinical correlation requested.",
                               y - 0.3 * inch)
        
        # Draw technique
        technique_text = f"Contrast-enhanced {modality} examination of the {anatomical_region} was performed following administration of intravenous contrast material. Multiplanar reconstructions were obtained."
        y = self._draw_section(c, "TECHNIQUE", technique_text, y - 0.3 * inch)
        
        # Draw findings
        findings_text = self._generate_findings(cancer_type)
        y = self._draw_findings_section(c, findings_text, y - 0.3 * inch)
        
        # Draw signature
        self._draw_signature(c, radiologist, report_date, y - 0.5 * inch)
        
        # Draw footer
        self._draw_footer(c)
        
        c.showPage()
        c.save()
        
        buffer.seek(0)
        return buffer.read()
    
    def _generate_findings(self, cancer_type: str) -> str:
        """
        Generate realistic findings text based on cancer type.
        
        Args:
            cancer_type: Type of cancer
            
        Returns:
            String with findings
        """
        # Get template for cancer type, default to lung cancer if unknown
        template = self.FINDINGS_TEMPLATES.get(
            cancer_type,
            self.FINDINGS_TEMPLATES["lung_cancer"]
        )
        
        # Generate realistic measurements and locations
        if cancer_type == "lung_cancer":
            replacements = {
                "size": f"{random.uniform(2.0, 5.5):.1f}",
                "location": random.choice(self.LUNG_LOCATIONS),
                "lymph_size": f"{random.uniform(1.2, 2.8):.1f}",
                "lymph_location": random.choice(self.LYMPH_STATIONS)
            }
        elif cancer_type == "colorectal_cancer":
            replacements = {
                "size": f"{random.uniform(3.0, 8.0):.1f}",
                "location": random.choice(self.COLON_LOCATIONS),
                "thickness": f"{random.uniform(8, 15):.0f}",
                "lymph_size": f"{random.uniform(1.0, 2.5):.1f}"
            }
        else:
            # Default replacements
            replacements = {
                "size": "3.5",
                "location": "right upper",
                "lymph_size": "1.8",
                "lymph_location": "hilar"
            }
        
        # Replace placeholders in template
        findings = template
        for key, value in replacements.items():
            findings = findings.replace(f"{{{key}}}", value)
        
        return findings
    
    def _draw_header(self, c: canvas.Canvas) -> None:
        """Draw the report header."""
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(self.page_width / 2, 10.5 * inch, "RADIOLOGY REPORT")
        
        c.setFont("Helvetica", 10)
        c.drawCentredString(self.page_width / 2, 10.2 * inch, "Department of Radiology")
        c.drawCentredString(self.page_width / 2, 10 * inch, "Medical Imaging Center")
        
        # Draw horizontal line
        c.line(0.5 * inch, 9.8 * inch, 8 * inch, 9.8 * inch)
    
    def _draw_patient_info(self, c: canvas.Canvas, patient: Patient, y: float) -> float:
        """Draw patient information section."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "PATIENT INFORMATION")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        c.drawString(0.5 * inch, y, f"Patient Name: {patient.name}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Patient ID: {patient.id}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Date of Birth: {patient.birth_date.strftime('%m/%d/%Y')}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Gender: {patient.gender}")
        y -= 0.2 * inch
        
        # Draw section separator
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_study_info(
        self,
        c: canvas.Canvas,
        study_uid: str,
        modality: str,
        anatomical_region: str,
        report_date: date,
        y: float
    ) -> float:
        """Draw study information section."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "STUDY INFORMATION")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        c.drawString(0.5 * inch, y, f"Study Date: {report_date.strftime('%m/%d/%Y')}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Modality: {modality}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Anatomical Region: {anatomical_region}")
        y -= 0.2 * inch
        
        # Study UID might be long, use smaller font
        c.setFont("Helvetica", 8)
        c.drawString(0.5 * inch, y, f"Study UID: {study_uid}")
        y -= 0.2 * inch
        
        # Draw section separator
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_section(self, c: canvas.Canvas, title: str, content: str, y: float) -> float:
        """Draw a generic section with title and content."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, title)
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        # Wrap text if needed
        max_width = 7 * inch
        lines = self._wrap_text(c, content, max_width, "Helvetica", 9)
        
        for line in lines:
            c.drawString(0.5 * inch, y, line)
            y -= 0.2 * inch
        
        # Draw section separator
        y -= 0.05 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_findings_section(self, c: canvas.Canvas, findings: str, y: float) -> float:
        """Draw findings section with proper formatting."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "FINDINGS")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        # Split findings into paragraphs
        paragraphs = findings.split('\n\n')
        max_width = 7 * inch
        
        for paragraph in paragraphs:
            if paragraph.strip():
                # Check if this is the IMPRESSION section
                if paragraph.strip().startswith("IMPRESSION:"):
                    y -= 0.15 * inch
                    c.setFont("Helvetica-Bold", 10)
                    c.drawString(0.5 * inch, y, "IMPRESSION:")
                    y -= 0.2 * inch
                    c.setFont("Helvetica", 9)
                    # Get the rest of the text after "IMPRESSION:"
                    impression_text = paragraph.replace("IMPRESSION:", "").strip()
                    lines = self._wrap_text(c, impression_text, max_width, "Helvetica", 9)
                else:
                    lines = self._wrap_text(c, paragraph.strip(), max_width, "Helvetica", 9)
                
                for line in lines:
                    c.drawString(0.5 * inch, y, line)
                    y -= 0.18 * inch
                
                y -= 0.1 * inch  # Extra space between paragraphs
        
        # Draw section separator
        y -= 0.05 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_signature(self, c: canvas.Canvas, radiologist: str, report_date: date, y: float) -> None:
        """Draw signature section."""
        c.setFont("Helvetica-Bold", 10)
        c.drawString(0.5 * inch, y, f"{radiologist}, MD")
        
        c.setFont("Helvetica", 8)
        y -= 0.18 * inch
        c.drawString(0.5 * inch, y, "Board Certified Radiologist")
        
        y -= 0.15 * inch
        c.drawString(0.5 * inch, y, "Department of Radiology")
        
        # Report date on the right
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(8 * inch, y + 0.33 * inch, "Report Date:")
        c.setFont("Helvetica", 8)
        c.drawRightString(8 * inch, y + 0.18 * inch, report_date.strftime('%m/%d/%Y %I:%M %p'))
    
    def _draw_footer(self, c: canvas.Canvas) -> None:
        """Draw footer."""
        y = 0.8 * inch
        
        c.setFont("Helvetica", 8)
        c.drawCentredString(self.page_width / 2, y, 
                           "This report has been electronically signed and is considered final.")
        
        y -= 0.15 * inch
        c.drawCentredString(self.page_width / 2, y,
                           "Confidential Medical Record - For Authorized Use Only")
    
    def _wrap_text(self, c: canvas.Canvas, text: str, max_width: float, font: str, font_size: int) -> list:
        """Wrap text to fit within max_width."""
        words = text.split()
        lines = []
        current_line = ""
        
        for word in words:
            test_line = current_line + word + " " if current_line else word + " "
            if c.stringWidth(test_line, font, font_size) <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line.strip())
                current_line = word + " "
        
        if current_line:
            lines.append(current_line.strip())
        
        return lines
