"""
Clinical Note Generator

Generates clinical notes as PDFs using ReportLab.
"""

from datetime import date
from typing import List, Dict
from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

from ..models import Patient, Encounter


class ClinicalNoteGenerator:
    """Generates clinical notes as professional PDF documents."""
    
    # Symptom templates based on cancer type and encounter reason
    SYMPTOM_TEMPLATES: Dict[str, Dict[str, List[str]]] = {
        "lung_cancer": {
            "screening": [
                "Patient presents for routine cancer screening",
                "No acute symptoms reported",
                "Patient is a former smoker with 20 pack-year history"
            ],
            "follow_up": [
                "Patient reports persistent dry cough for 3 weeks",
                "Mild dyspnea on exertion",
                "Denies hemoptysis or chest pain",
                "Weight loss of 8 lbs over past 2 months"
            ],
            "diagnostic": [
                "Patient presents with chronic cough and shortness of breath",
                "Reports fatigue and unintentional weight loss",
                "Occasional chest discomfort",
                "History of smoking (30 pack-years)"
            ]
        },
        "colorectal_cancer": {
            "screening": [
                "Patient presents for routine colorectal cancer screening",
                "No gastrointestinal symptoms reported",
                "Family history of colon cancer (father diagnosed at age 62)"
            ],
            "follow_up": [
                "Patient reports change in bowel habits over past month",
                "Intermittent abdominal cramping",
                "Denies rectal bleeding or melena",
                "Mild fatigue noted"
            ],
            "diagnostic": [
                "Patient presents with rectal bleeding and altered bowel habits",
                "Reports abdominal pain and bloating",
                "Unintentional weight loss of 10 lbs",
                "Increased fatigue over past 6 weeks"
            ]
        }
    }
    
    # Treatment plan templates based on cancer type
    TREATMENT_PLANS: Dict[str, List[str]] = {
        "lung_cancer": [
            "Order CT chest with contrast for further evaluation",
            "Refer to pulmonology for bronchoscopy if imaging concerning",
            "Consider PET scan if mass identified",
            "Refer to oncology for consultation",
            "Follow-up in 2 weeks to review imaging results",
            "Patient counseled on smoking cessation"
        ],
        "colorectal_cancer": [
            "Order CT abdomen and pelvis with contrast",
            "Refer to gastroenterology for colonoscopy",
            "Complete blood count and CEA level ordered",
            "Refer to oncology for consultation if malignancy confirmed",
            "Follow-up in 2 weeks to review test results",
            "Dietary counseling provided"
        ]
    }
    
    def __init__(self):
        """Initialize the clinical note generator."""
        self.page_width, self.page_height = letter
    
    def generate(
        self,
        patient: Patient,
        encounter: Encounter,
        imaging_orders: List[str],
        cancer_type: str,
        physician: str
    ) -> bytes:
        """
        Generate a clinical note as PDF bytes.
        
        Args:
            patient: Patient information
            encounter: Encounter details
            imaging_orders: List of imaging studies ordered (e.g., ["CT Chest with contrast"])
            cancer_type: Type of cancer (lung_cancer, colorectal_cancer)
            physician: Physician name
            
        Returns:
            PDF document as bytes
        """
        # Generate symptoms based on encounter reason and cancer type
        symptoms = self._generate_symptoms(cancer_type, encounter.reason)
        
        # Generate treatment plan
        treatment_plan = self._generate_treatment_plan(cancer_type, imaging_orders)
        
        # Create PDF using ReportLab
        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        
        # Draw header
        self._draw_header(c)
        
        # Draw patient information
        y = self._draw_patient_info(c, patient, 9.5 * inch)
        
        # Draw encounter information
        y = self._draw_encounter_info(c, encounter, y - 0.3 * inch)
        
        # Draw chief complaint
        y = self._draw_section(c, "CHIEF COMPLAINT / REASON FOR VISIT",
                               ', '.join(encounter.reason) if encounter.reason else 'Routine examination',
                               y - 0.3 * inch)
        
        # Draw symptoms (History of Present Illness)
        y = self._draw_symptoms_section(c, symptoms, y - 0.3 * inch)
        
        # Draw imaging orders
        y = self._draw_imaging_orders(c, imaging_orders, y - 0.3 * inch)
        
        # Draw treatment plan
        y = self._draw_treatment_plan_section(c, treatment_plan, y - 0.3 * inch)
        
        # Draw signature
        self._draw_signature(c, physician, encounter.date, y - 0.5 * inch)
        
        # Draw footer
        self._draw_footer(c)
        
        c.showPage()
        c.save()
        
        buffer.seek(0)
        return buffer.read()
    
    def _generate_symptoms(self, cancer_type: str, encounter_reasons: List[str]) -> List[str]:
        """
        Generate realistic symptoms based on cancer type and encounter reason.
        
        Args:
            cancer_type: Type of cancer
            encounter_reasons: List of encounter reasons
            
        Returns:
            List of symptom descriptions
        """
        # Determine encounter type from reasons
        encounter_type = "diagnostic"
        if encounter_reasons:
            reason_lower = encounter_reasons[0].lower()
            if "screening" in reason_lower or "routine" in reason_lower:
                encounter_type = "screening"
            elif "follow" in reason_lower or "followup" in reason_lower:
                encounter_type = "follow_up"
        
        # Get symptoms template
        templates = self.SYMPTOM_TEMPLATES.get(cancer_type, self.SYMPTOM_TEMPLATES["lung_cancer"])
        symptoms = templates.get(encounter_type, templates["diagnostic"])
        
        return symptoms
    
    def _generate_treatment_plan(self, cancer_type: str, imaging_orders: List[str]) -> str:
        """
        Generate treatment plan based on cancer type and imaging orders.
        
        Args:
            cancer_type: Type of cancer
            imaging_orders: List of imaging studies ordered
            
        Returns:
            Treatment plan as formatted string
        """
        # Get treatment plan template
        plan_items = self.TREATMENT_PLANS.get(
            cancer_type,
            self.TREATMENT_PLANS["lung_cancer"]
        )
        
        # Build treatment plan
        plan_lines = []
        for i, item in enumerate(plan_items, 1):
            plan_lines.append(f"{i}. {item}")
        
        return "\n".join(plan_lines)
    
    def _draw_header(self, c: canvas.Canvas) -> None:
        """Draw the clinical note header."""
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(self.page_width / 2, 10.5 * inch, "CLINICAL NOTE")
        
        c.setFont("Helvetica", 10)
        c.drawCentredString(self.page_width / 2, 10.2 * inch, "Department of Medicine")
        c.drawCentredString(self.page_width / 2, 10 * inch, "Medical Center")
        
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
    
    def _draw_encounter_info(self, c: canvas.Canvas, encounter: Encounter, y: float) -> float:
        """Draw encounter information section."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "ENCOUNTER INFORMATION")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        c.drawString(0.5 * inch, y, f"Encounter ID: {encounter.id}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Encounter Date: {encounter.date.strftime('%m/%d/%Y')}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Encounter Type: {encounter.type}")
        y -= 0.2 * inch
        
        c.drawString(0.5 * inch, y, f"Provider: {encounter.provider}")
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
    
    def _draw_symptoms_section(self, c: canvas.Canvas, symptoms: List[str], y: float) -> float:
        """Draw symptoms section (History of Present Illness)."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "HISTORY OF PRESENT ILLNESS")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        max_width = 6.5 * inch
        
        for symptom in symptoms:
            # Draw bullet point
            c.drawString(0.5 * inch, y, "\u2022")
            
            # Wrap symptom text
            lines = self._wrap_text(c, symptom, max_width, "Helvetica", 9)
            for line in lines:
                c.drawString(0.75 * inch, y, line)
                y -= 0.18 * inch
            
            y -= 0.05 * inch  # Extra space between items
        
        # Draw section separator
        y -= 0.05 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_imaging_orders(self, c: canvas.Canvas, imaging_orders: List[str], y: float) -> float:
        """Draw imaging orders section."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "IMAGING ORDERS")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        if imaging_orders:
            max_width = 6.5 * inch
            
            for order in imaging_orders:
                # Draw bullet point
                c.drawString(0.5 * inch, y, "\u2022")
                
                # Wrap order text
                lines = self._wrap_text(c, order, max_width, "Helvetica", 9)
                for line in lines:
                    c.drawString(0.75 * inch, y, line)
                    y -= 0.18 * inch
                
                y -= 0.05 * inch  # Extra space between items
        else:
            c.drawString(0.5 * inch, y, "\u2022 None ordered at this time")
            y -= 0.2 * inch
        
        # Draw section separator
        y -= 0.05 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_treatment_plan_section(self, c: canvas.Canvas, treatment_plan: str, y: float) -> float:
        """Draw treatment plan section."""
        c.setFont("Helvetica-Bold", 11)
        c.drawString(0.5 * inch, y, "ASSESSMENT AND PLAN")
        
        c.setFont("Helvetica", 9)
        y -= 0.25 * inch
        
        # Split treatment plan into lines
        lines = treatment_plan.split('\n')
        max_width = 7 * inch
        
        for line in lines:
            if line.strip():
                # Wrap each line if needed
                wrapped_lines = self._wrap_text(c, line, max_width, "Helvetica", 9)
                for wrapped_line in wrapped_lines:
                    c.drawString(0.5 * inch, y, wrapped_line)
                    y -= 0.18 * inch
        
        # Draw section separator
        y -= 0.1 * inch
        c.line(0.5 * inch, y, 8 * inch, y)
        
        return y
    
    def _draw_signature(self, c: canvas.Canvas, physician: str, note_date: date, y: float) -> None:
        """Draw signature section."""
        c.setFont("Helvetica-Bold", 10)
        c.drawString(0.5 * inch, y, f"{physician}, MD")
        
        c.setFont("Helvetica", 8)
        y -= 0.18 * inch
        c.drawString(0.5 * inch, y, "Attending Physician")
        
        y -= 0.15 * inch
        c.drawString(0.5 * inch, y, "Department of Medicine")
        
        # Note date on the right
        c.setFont("Helvetica-Bold", 9)
        c.drawRightString(8 * inch, y + 0.33 * inch, "Date:")
        c.setFont("Helvetica", 8)
        c.drawRightString(8 * inch, y + 0.18 * inch, note_date.strftime('%m/%d/%Y'))
    
    def _draw_footer(self, c: canvas.Canvas) -> None:
        """Draw footer."""
        y = 0.5 * inch
        
        c.setFont("Helvetica", 8)
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
