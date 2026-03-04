"""
CLI Entry Point for Medical Claims Data Generator

Provides a command-line interface for generating synthetic medical claims data.
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Optional

from .models import GenerationConfig
from .orchestrator import GenerationOrchestrator


def setup_logging(verbose: bool = False) -> None:
    """
    Configure logging for the application.
    
    Args:
        verbose: If True, set DEBUG level; otherwise INFO level
    """
    log_level = logging.DEBUG if verbose else logging.INFO
    
    # Configure root logger
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Reduce noise from third-party libraries
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('boto3').setLevel(logging.WARNING)
    logging.getLogger('botocore').setLevel(logging.WARNING)
    logging.getLogger('s3transfer').setLevel(logging.WARNING)


def parse_arguments() -> argparse.Namespace:
    """
    Parse command-line arguments.
    
    Returns:
        Parsed arguments namespace
    """
    parser = argparse.ArgumentParser(
        description="Generate synthetic medical claims data with realistic patient records and imaging metadata.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate 25 patients with default settings
  python -m medical_claims_generator.main
  
  # Generate 20 patients with custom output directory
  python -m medical_claims_generator.main --output-dir ./my_data --patient-count 20
  
  # Generate with specific random seed for reproducibility
  python -m medical_claims_generator.main --seed 12345
  
  # Specify custom TCIA metadata and Synthea paths
  python -m medical_claims_generator.main --tcia-metadata ./tcia.csv --synthea-path /opt/synthea
  
  # Generate and upload to S3 bucket
  python -m medical_claims_generator.main --s3-bucket my-medical-data-bucket
  
  # Enable verbose logging
  python -m medical_claims_generator.main --verbose
        """
    )
    
    parser.add_argument(
        "--output-dir",
        type=str,
        default="medical_data",
        help="Root directory for generated data (default: medical_data)"
    )
    
    parser.add_argument(
        "--tcia-metadata",
        type=str,
        default="tcia_metadata.csv",
        help="Path to TCIA metadata CSV file (default: tcia_metadata.csv)"
    )
    
    parser.add_argument(
        "--patient-count",
        type=int,
        default=25,
        help="Number of patients to generate, must be between 20 and 30 (default: 25)"
    )
    
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible generation (default: random)"
    )
    
    parser.add_argument(
        "--synthea-path",
        type=str,
        default="./synthea",
        help="Path to Synthea installation directory (default: ./synthea)"
    )
    
    parser.add_argument(
        "--s3-bucket",
        type=str,
        default=None,
        help="Optional S3 bucket name to upload generated data (default: no upload)"
    )
    
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose (DEBUG level) logging"
    )
    
    return parser.parse_args()


def validate_arguments(args: argparse.Namespace) -> Optional[str]:
    """
    Validate command-line arguments.
    
    Args:
        args: Parsed arguments
        
    Returns:
        Error message if validation fails, None otherwise
    """
    # Validate patient count
    if not 20 <= args.patient_count <= 30:
        return f"Error: patient-count must be between 20 and 30, got {args.patient_count}"
    
    # Validate TCIA metadata file exists
    tcia_path = Path(args.tcia_metadata)
    if not tcia_path.exists():
        return f"Error: TCIA metadata file not found: {args.tcia_metadata}"
    
    # Validate Synthea path exists
    synthea_path = Path(args.synthea_path)
    if not synthea_path.exists():
        return f"Error: Synthea directory not found: {args.synthea_path}"
    
    return None


def print_header() -> None:
    """Print CLI header."""
    print("=" * 70)
    print("Medical Claims Data Generator")
    print("=" * 70)
    print()


def print_configuration(config: GenerationConfig) -> None:
    """
    Print generation configuration.
    
    Args:
        config: Generation configuration
    """
    print("Configuration:")
    print(f"  Output Directory:    {config.output_dir}")
    print(f"  TCIA Metadata:       {config.tcia_metadata_path}")
    print(f"  Patient Count:       {config.patient_count}")
    print(f"  Random Seed:         {config.seed if config.seed is not None else 'random'}")
    print(f"  Synthea Path:        {config.synthea_path}")
    print(f"  S3 Bucket:           {config.s3_bucket if config.s3_bucket else 'none (local only)'}")
    print()


def print_validation_report(validation_result) -> None:
    """
    Print validation report.
    
    Args:
        validation_result: ValidationResult object
    """
    print()
    print("=" * 70)
    print("Validation Report")
    print("=" * 70)
    print(validation_result.to_report())


def print_statistics_summary(statistics) -> None:
    """
    Print statistics summary.
    
    Args:
        statistics: Statistics object
    """
    print()
    print("=" * 70)
    print("Generation Statistics")
    print("=" * 70)
    print()
    print(f"Total Patients:        {statistics.total_patients}")
    print()
    print("Patients by Cancer Type:")
    for cancer_type, count in statistics.patients_by_cancer_type.items():
        print(f"  {cancer_type:20s} {count}")
    print()
    print(f"Total Claims:          {statistics.total_claims}")
    print()
    print("Claims by Status:")
    for status, count in statistics.claims_by_status.items():
        print(f"  {status:20s} {count}")
    print()
    print("Documents by Type:")
    for doc_type, count in statistics.documents_by_type.items():
        print(f"  {doc_type:20s} {count}")
    print()
    print(f"Random Seed:           {statistics.random_seed}")
    print(f"Generation Time:       {statistics.generation_timestamp}")
    print()
    print("=" * 70)


def print_upload_summary(upload_summary) -> None:
    """
    Print S3 upload summary.
    
    Args:
        upload_summary: Upload summary dictionary
    """
    if not upload_summary:
        return
    
    print()
    print("=" * 70)
    print("S3 Upload Summary")
    print("=" * 70)
    print()
    
    if upload_summary.get('success'):
        print(f"✓ Upload Status:       Success")
        print(f"  Files Uploaded:      {upload_summary['file_count']}")
        print(f"  Total Size:          {upload_summary['total_bytes']:,} bytes")
    else:
        print(f"✗ Upload Status:       Failed")
        print(f"  Error:               {upload_summary.get('error_message', 'Unknown error')}")
        if upload_summary.get('failed_files'):
            print(f"  Failed Files:        {len(upload_summary['failed_files'])}")
            for failed_file in upload_summary['failed_files'][:5]:  # Show first 5
                print(f"    - {failed_file}")
            if len(upload_summary['failed_files']) > 5:
                print(f"    ... and {len(upload_summary['failed_files']) - 5} more")
    
    print()
    print("=" * 70)


def main() -> int:
    """
    Main entry point for the data generator CLI.
    
    Returns:
        Exit code (0 for success, non-zero for failure)
    """
    try:
        # Parse arguments
        args = parse_arguments()
        
        # Setup logging
        setup_logging(verbose=args.verbose)
        logger = logging.getLogger(__name__)
        
        # Print header
        print_header()
        
        logger.info("Starting Medical Claims Data Generator")
        
        # Validate arguments
        error_message = validate_arguments(args)
        if error_message:
            logger.error(f"Argument validation failed: {error_message}")
            print(error_message, file=sys.stderr)
            return 1
        
        logger.debug(f"Arguments validated successfully")
        
        # Create configuration
        try:
            config = GenerationConfig(
                output_dir=Path(args.output_dir),
                tcia_metadata_path=Path(args.tcia_metadata),
                patient_count=args.patient_count,
                seed=args.seed,
                synthea_path=Path(args.synthea_path),
                s3_bucket=args.s3_bucket
            )
            logger.debug(f"Configuration created: {config}")
        except ValueError as e:
            logger.error(f"Invalid configuration: {e}")
            print(f"Error: Invalid configuration - {e}", file=sys.stderr)
            return 1
        
        # Print configuration
        print_configuration(config)
        
        # Create orchestrator
        logger.info("Initializing generation orchestrator")
        orchestrator = GenerationOrchestrator(config)
        
        # Execute generation
        print("Starting data generation...")
        print()
        logger.info("Beginning data generation workflow")
        result = orchestrator.generate()
        
        # Print validation report
        print_validation_report(result.validation_result)
        
        # Print statistics summary
        print_statistics_summary(result.statistics)
        
        # Print upload summary if S3 upload was performed
        if result.upload_summary:
            print_upload_summary(result.upload_summary)
        
        # Print final status
        if result.success:
            logger.info(f"Generation completed successfully. Output: {result.output_directory}")
            print(f"✓ Generation completed successfully!")
            print(f"  Output directory: {result.output_directory}")
            return 0
        else:
            logger.error(f"Generation completed with errors. Output: {result.output_directory}")
            print(f"✗ Generation completed with errors", file=sys.stderr)
            print(f"  Output directory: {result.output_directory}", file=sys.stderr)
            return 1
            
    except KeyboardInterrupt:
        logger.warning("Generation interrupted by user")
        print("\n\nGeneration interrupted by user", file=sys.stderr)
        return 130  # Standard exit code for SIGINT
    except Exception as e:
        logger.exception(f"Fatal error during generation: {e}")
        print(f"\n\nFatal error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
