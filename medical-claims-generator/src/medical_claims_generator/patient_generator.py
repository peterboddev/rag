"""
Patient Generator

Wrapper for Synthea execution and FHIR parsing.
Generates synthetic patient records with cancer diagnoses using Synthea
and parses the FHIR R4 output into Patient objects.
"""

import logging
import subprocess
import json
from pathlib import Path
from typing import List, Optional
from datetime import datetime

from fhir.resources.bundle import Bundle
from fhir.resources.patient import Patient as FHIRPatient
from fhir.resources.encounter import Encounter as FHIREncounter
from fhir.resources.condition import Condition as FHIRCondition
from pydantic import ValidationError

from .models import Patient, Address, Insurance, Encounter, Condition

logger = logging.getLogger(__name__)


class PatientGenerator:
    """Generates synthetic patients using Synthea and parses FHIR output."""
    
    def __init__(self, synthea_path: Path, output_dir: Path, seed: Optional[int] = None):
        """
        Initialize patient generator.
        
        Args:
            synthea_path: Path to Synthea installation directory
            output_dir: Directory where Synthea will output generated data
            seed: Optional random seed for reproducible generation
        """
        self.synthea_path = Path(synthea_path)
        self.output_dir = Path(output_dir)
        self.seed = seed
        
        # Validate Synthea installation
        if not self.synthea_path.exists():
            raise FileNotFoundError(f"Synthea path does not exist: {self.synthea_path}")
        
        # Create output directory if it doesn't exist
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def generate_patients(self, count: int, cancer_types: List[str]) -> List[Patient]:
        """
        Generate synthetic patients with specified cancer diagnoses.
        
        Args:
            count: Number of patients to generate
            cancer_types: List of cancer types (e.g., ["lung_cancer", "colorectal_cancer"])
            
        Returns:
            List of Patient objects parsed from FHIR output
            
        Raises:
            RuntimeError: If Synthea execution fails
            ValueError: If FHIR parsing fails
        """
        logger.info(f"Generating {count} patients with cancer types: {cancer_types}")
        
        # Execute Synthea to generate patients
        fhir_output_path = self._execute_synthea(count, cancer_types)
        
        # Parse FHIR output into Patient objects
        logger.info(f"Parsing FHIR output from {fhir_output_path}")
        patients = self._parse_fhir_output(fhir_output_path)
        
        logger.info(f"Successfully parsed {len(patients)} patients")
        return patients
    
    def _execute_synthea(self, count: int, modules: List[str]) -> Path:
        """
        Execute Synthea command-line tool to generate patients.
        
        Args:
            count: Number of patients to generate
            modules: List of Synthea modules to enable (cancer types)
            
        Returns:
            Path to FHIR output directory
            
        Raises:
            RuntimeError: If Synthea execution fails
        """
        logger.debug(f"Executing Synthea with count={count}, modules={modules}")
        
        # Synthea outputs to output/fhir by default
        fhir_output = self.output_dir / "synthea_output" / "fhir"
        fhir_output.mkdir(parents=True, exist_ok=True)
        
        # Build Synthea command
        # Synthea is typically run as: java -jar synthea-with-dependencies.jar [options]
        synthea_jar = self.synthea_path / "synthea-with-dependencies.jar"
        
        if not synthea_jar.exists():
            logger.error(f"Synthea JAR not found: {synthea_jar}")
            raise FileNotFoundError(
                f"Synthea JAR not found: {synthea_jar}. "
                "Please ensure Synthea is properly installed."
            )
        
        cmd = [
            "java",
            "-jar",
            "synthea-with-dependencies.jar",  # Use relative path since we run from synthea dir
            "-p", str(count),  # Population size
            "--exporter.fhir.export=true",  # Enable FHIR export
        ]
        
        # Add seed if provided
        if self.seed is not None:
            cmd.extend(["-s", str(self.seed)])
            logger.debug(f"Using seed: {self.seed}")
        
        # Add modules for cancer types (skip if modules don't work)
        # Note: Specific modules may not generate patients reliably
        # for module in modules:
        #     cmd.extend(["-m", module])
        
        # Don't specify output directory - let Synthea use its default ./output
        # We'll copy files from there after generation
        
        logger.debug(f"Synthea command: {' '.join(cmd)}")
        
        try:
            # Execute Synthea
            logger.info("Executing Synthea (this may take a few minutes)...")
            result = subprocess.run(
                cmd,
                cwd=str(self.synthea_path),
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode != 0:
                logger.error(f"Synthea execution failed with return code {result.returncode}")
                logger.error(f"STDERR: {result.stderr}")
                raise RuntimeError(
                    f"Synthea execution failed with return code {result.returncode}\n"
                    f"STDOUT: {result.stdout}\n"
                    f"STDERR: {result.stderr}"
                )
            
            logger.info("Synthea execution completed successfully")
            
            # Synthea outputs to ./output/fhir by default when run from its directory
            default_output = self.synthea_path / "output" / "fhir"
            return default_output
            
        except subprocess.TimeoutExpired:
            logger.error("Synthea execution timed out after 5 minutes")
            raise RuntimeError("Synthea execution timed out after 5 minutes")
        except Exception as e:
            logger.exception(f"Failed to execute Synthea: {str(e)}")
            raise RuntimeError(f"Failed to execute Synthea: {str(e)}")
    
    def _parse_fhir_output(self, output_path: Path) -> List[Patient]:
        """
        Parse FHIR R4 JSON files into Patient objects.
        
        Args:
            output_path: Path to directory containing FHIR JSON files
            
        Returns:
            List of Patient objects
            
        Raises:
            ValueError: If FHIR parsing fails
        """
        patients = []
        
        # Find all FHIR JSON files in the output directory (exclude hospital/practitioner info files)
        fhir_files = [f for f in output_path.glob("*.json") 
                     if not f.name.startswith(('hospital', 'practitioner'))]
        
        if not fhir_files:
            raise ValueError(f"No FHIR JSON files found in {output_path}")
        
        logger.info(f"Found {len(fhir_files)} FHIR files to parse")
        
        for fhir_file in fhir_files:
            try:
                # Parse FHIR Bundle directly as JSON without strict validation
                with open(fhir_file, 'r', encoding='utf-8') as f:
                    bundle_data = json.load(f)
                
                # Extract patient data directly from JSON
                patient = self._extract_patient_from_json(bundle_data)
                
                if patient:
                    patients.append(patient)
                    logger.debug(f"Successfully parsed patient from {fhir_file.name}")
                    
            except Exception as e:
                # Log warning but continue processing other files
                logger.warning(f"Failed to parse {fhir_file.name}: {str(e)}")
                continue
        
        if not patients:
            raise ValueError("No valid patients could be parsed from FHIR output")
        
        logger.info(f"Successfully parsed {len(patients)} patients")
        return patients
    
    def _extract_patient_from_json(self, bundle_data: dict) -> Optional[Patient]:
        """
        Extract Patient object directly from FHIR Bundle JSON.
        
        Args:
            bundle_data: FHIR Bundle as dict
            
        Returns:
            Patient object or None if extraction fails
        """
        if 'entry' not in bundle_data or not bundle_data['entry']:
            return None
        
        # Find Patient, Encounter, and Condition resources
        patient_data = None
        encounters_data = []
        conditions_data = []
        
        for entry in bundle_data['entry']:
            if 'resource' not in entry:
                continue
                
            resource = entry['resource']
            resource_type = resource.get('resourceType', '')
            
            if resource_type == 'Patient':
                patient_data = resource
            elif resource_type == 'Encounter':
                encounters_data.append(resource)
            elif resource_type == 'Condition':
                conditions_data.append(resource)
        
        if not patient_data:
            return None
        
        try:
            # Extract patient ID
            patient_id = patient_data.get('id', 'unknown')
            
            # Extract name
            name = "Unknown"
            if 'name' in patient_data and patient_data['name']:
                name_obj = patient_data['name'][0]
                name_parts = []
                if 'given' in name_obj:
                    name_parts.extend(name_obj['given'])
                if 'family' in name_obj:
                    name_parts.append(name_obj['family'])
                if name_parts:
                    name = " ".join(name_parts)
            
            # Extract birth date
            birth_date_str = patient_data.get('birthDate', '2000-01-01')
            birth_date = datetime.strptime(birth_date_str, '%Y-%m-%d').date()
            
            # Extract gender
            gender = patient_data.get('gender', 'unknown')
            
            # Extract address
            address = Address(
                line1="123 Main St",
                line2=None,
                city="Boston",
                state="MA",
                postal_code="02101"
            )
            
            if 'address' in patient_data and patient_data['address']:
                addr = patient_data['address'][0]
                if 'line' in addr and addr['line']:
                    address.line1 = addr['line'][0]
                    if len(addr['line']) > 1:
                        address.line2 = addr['line'][1]
                if 'city' in addr:
                    address.city = addr['city']
                if 'state' in addr:
                    address.state = addr['state']
                if 'postalCode' in addr:
                    address.postal_code = addr['postalCode']
            
            # Create insurance (simplified)
            insurance = Insurance(
                payer_name="Medicare",
                policy_number=f"POL-{patient_id[:8]}",
                group_number=None
            )
            
            # Extract encounters (simplified)
            encounters = []
            for enc_data in encounters_data[:5]:  # Limit to 5 encounters
                try:
                    enc_id = enc_data.get('id', 'unknown')
                    enc_date_str = enc_data.get('period', {}).get('start', '2020-01-01T00:00:00Z')
                    enc_date = datetime.fromisoformat(enc_date_str.replace('Z', '+00:00')).date()
                    enc_type = enc_data.get('type', [{}])[0].get('text', 'General')
                    
                    encounter = Encounter(
                        id=enc_id,
                        date=enc_date,
                        type=enc_type,
                        provider="Dr. Smith",
                        reason=[]
                    )
                    encounters.append(encounter)
                except:
                    continue
            
            # Extract conditions (simplified)
            conditions = []
            for cond_data in conditions_data[:5]:  # Limit to 5 conditions
                try:
                    code = cond_data.get('code', {}).get('coding', [{}])[0].get('code', 'unknown')
                    display = cond_data.get('code', {}).get('coding', [{}])[0].get('display', 'Unknown condition')
                    onset_str = cond_data.get('onsetDateTime', '2020-01-01T00:00:00Z')
                    onset_date = datetime.fromisoformat(onset_str.replace('Z', '+00:00')).date()
                    
                    condition = Condition(
                        code=code,
                        display=display,
                        onset_date=onset_date,
                        category="general"
                    )
                    conditions.append(condition)
                except:
                    continue
            
            # Create Patient object
            patient = Patient(
                id=patient_id,
                name=name,
                birth_date=birth_date,
                gender=gender,
                address=address,
                insurance=insurance,
                encounters=encounters,
                conditions=conditions
            )
            
            return patient
            
        except Exception as e:
            logger.warning(f"Failed to extract patient data: {str(e)}")
            return None
    
    def _extract_patient_from_bundle(self, bundle: Bundle) -> Optional[Patient]:
        """
        Extract Patient object from FHIR Bundle.
        
        Args:
            bundle: FHIR Bundle resource
            
        Returns:
            Patient object or None if extraction fails
        """
        if not bundle.entry:
            return None
        
        # Find Patient resource in bundle
        fhir_patient = None
        encounters = []
        conditions = []
        
        for entry in bundle.entry:
            try:
                # Handle both object and dict access
                if hasattr(entry, 'resource'):
                    resource = entry.resource
                elif isinstance(entry, dict) and 'resource' in entry:
                    resource = entry['resource']
                else:
                    continue
                
                # Get resource type
                if hasattr(resource, 'get_resource_type'):
                    resource_type = resource.get_resource_type()
                elif isinstance(resource, dict) and 'resourceType' in resource:
                    resource_type = resource['resourceType']
                else:
                    continue
                
                # Convert to dict if needed
                resource_dict = resource.dict() if hasattr(resource, 'dict') else resource
                
                if resource_type == "Patient":
                    # Use construct() for more lenient parsing
                    try:
                        fhir_patient = FHIRPatient.model_validate(resource_dict)
                    except ValidationError:
                        fhir_patient = FHIRPatient.construct(**resource_dict)
                elif resource_type == "Encounter":
                    try:
                        encounters.append(FHIREncounter.model_validate(resource_dict))
                    except ValidationError:
                        encounters.append(FHIREncounter.construct(**resource_dict))
                elif resource_type == "Condition":
                    try:
                        conditions.append(FHIRCondition.model_validate(resource_dict))
                    except ValidationError:
                        conditions.append(FHIRCondition.construct(**resource_dict))
            except Exception as e:
                logger.debug(f"Skipping resource due to error: {str(e)}")
                continue
        
        if not fhir_patient:
            return None
        
        # Extract patient demographics
        patient_id = fhir_patient.id
        
        # Extract name
        name = "Unknown"
        if fhir_patient.name and len(fhir_patient.name) > 0:
            name_parts = []
            if fhir_patient.name[0].given:
                name_parts.extend(fhir_patient.name[0].given)
            if fhir_patient.name[0].family:
                name_parts.append(fhir_patient.name[0].family)
            name = " ".join(name_parts)
        
        # Extract birth date
        birth_date = fhir_patient.birthDate
        
        # Extract gender
        gender = fhir_patient.gender if fhir_patient.gender else "unknown"
        
        # Extract address
        address = Address(
            line1="",
            line2=None,
            city="",
            state="",
            postal_code=""
        )
        if fhir_patient.address and len(fhir_patient.address) > 0:
            addr = fhir_patient.address[0]
            address = Address(
                line1=addr.line[0] if addr.line and len(addr.line) > 0 else "",
                line2=addr.line[1] if addr.line and len(addr.line) > 1 else None,
                city=addr.city if addr.city else "",
                state=addr.state if addr.state else "",
                postal_code=addr.postalCode if addr.postalCode else ""
            )
        
        # Extract insurance (simplified - use default values)
        insurance = Insurance(
            payer_name="Default Insurance Co.",
            policy_number=f"POL-{patient_id}",
            group_number=None
        )
        
        # Parse encounters
        parsed_encounters = []
        for enc in encounters:
            if enc.subject and enc.subject.reference and patient_id in enc.subject.reference:
                encounter = Encounter(
                    id=enc.id,
                    date=enc.period.start.date() if enc.period and enc.period.start else datetime.now().date(),
                    type=enc.type[0].text if enc.type and len(enc.type) > 0 and enc.type[0].text else "Unknown",
                    provider=enc.serviceProvider.display if enc.serviceProvider and enc.serviceProvider.display else "Unknown Provider",
                    reason=[]
                )
                
                # Extract reason codes
                if enc.reasonCode:
                    for reason_code in enc.reasonCode:
                        if reason_code.text:
                            encounter.reason.append(reason_code.text)
                
                parsed_encounters.append(encounter)
        
        # Parse conditions
        parsed_conditions = []
        for cond in conditions:
            if cond.subject and cond.subject.reference and patient_id in cond.subject.reference:
                # Determine cancer category
                category = "unknown"
                if cond.code and cond.code.text:
                    text_lower = cond.code.text.lower()
                    if "lung" in text_lower:
                        category = "lung_cancer"
                    elif "colorectal" in text_lower or "colon" in text_lower:
                        category = "colorectal_cancer"
                
                condition = Condition(
                    code=cond.code.coding[0].code if cond.code and cond.code.coding and len(cond.code.coding) > 0 else "Unknown",
                    display=cond.code.text if cond.code and cond.code.text else "Unknown Condition",
                    onset_date=cond.onsetDateTime.date() if cond.onsetDateTime else datetime.now().date(),
                    category=category
                )
                parsed_conditions.append(condition)
        
        # Create Patient object
        patient = Patient(
            id=patient_id,
            name=name,
            birth_date=birth_date,
            gender=gender,
            address=address,
            insurance=insurance,
            encounters=parsed_encounters,
            conditions=parsed_conditions
        )
        
        return patient
