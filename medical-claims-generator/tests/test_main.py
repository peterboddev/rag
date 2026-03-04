"""
Unit tests for CLI entry point (main.py)
"""

import sys
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import pytest

from medical_claims_generator.main import (
    parse_arguments,
    validate_arguments,
    print_header,
    print_configuration,
    print_validation_report,
    print_statistics_summary,
    main
)
from medical_claims_generator.models import (
    GenerationConfig,
    ValidationResult,
    Statistics,
    GenerationResult
)


class TestParseArguments:
    """Test argument parsing."""
    
    def test_parse_default_arguments(self):
        """Test parsing with default arguments."""
        with patch('sys.argv', ['main.py']):
            args = parse_arguments()
            
            assert args.output_dir == "medical_data"
            assert args.tcia_metadata == "tcia_metadata.csv"
            assert args.patient_count == 25
            assert args.seed is None
            assert args.synthea_path == "./synthea"
    
    def test_parse_custom_arguments(self):
        """Test parsing with custom arguments."""
        with patch('sys.argv', [
            'main.py',
            '--output-dir', './custom_output',
            '--tcia-metadata', './custom_tcia.csv',
            '--patient-count', '20',
            '--seed', '12345',
            '--synthea-path', '/opt/synthea'
        ]):
            args = parse_arguments()
            
            assert args.output_dir == "./custom_output"
            assert args.tcia_metadata == "./custom_tcia.csv"
            assert args.patient_count == 20
            assert args.seed == 12345
            assert args.synthea_path == "/opt/synthea"
    
    def test_parse_patient_count_argument(self):
        """Test parsing patient count argument."""
        with patch('sys.argv', ['main.py', '--patient-count', '30']):
            args = parse_arguments()
            assert args.patient_count == 30
    
    def test_parse_s3_bucket_argument(self):
        """Test parsing S3 bucket argument."""
        with patch('sys.argv', ['main.py', '--s3-bucket', 'my-test-bucket']):
            args = parse_arguments()
            assert args.s3_bucket == 'my-test-bucket'
    
    def test_parse_s3_bucket_default_none(self):
        """Test S3 bucket defaults to None."""
        with patch('sys.argv', ['main.py']):
            args = parse_arguments()
            assert args.s3_bucket is None


class TestValidateArguments:
    """Test argument validation."""
    
    def test_validate_valid_arguments(self, tmp_path):
        """Test validation with valid arguments."""
        # Create temporary files
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        args = Mock()
        args.patient_count = 25
        args.tcia_metadata = str(tcia_file)
        args.synthea_path = str(synthea_dir)
        
        error = validate_arguments(args)
        assert error is None
    
    def test_validate_patient_count_too_low(self, tmp_path):
        """Test validation fails when patient count is too low."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        args = Mock()
        args.patient_count = 19
        args.tcia_metadata = str(tcia_file)
        args.synthea_path = str(synthea_dir)
        
        error = validate_arguments(args)
        assert error is not None
        assert "must be between 20 and 30" in error
        assert "19" in error
    
    def test_validate_patient_count_too_high(self, tmp_path):
        """Test validation fails when patient count is too high."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        args = Mock()
        args.patient_count = 31
        args.tcia_metadata = str(tcia_file)
        args.synthea_path = str(synthea_dir)
        
        error = validate_arguments(args)
        assert error is not None
        assert "must be between 20 and 30" in error
        assert "31" in error
    
    def test_validate_missing_tcia_file(self, tmp_path):
        """Test validation fails when TCIA file doesn't exist."""
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        args = Mock()
        args.patient_count = 25
        args.tcia_metadata = str(tmp_path / "nonexistent.csv")
        args.synthea_path = str(synthea_dir)
        
        error = validate_arguments(args)
        assert error is not None
        assert "TCIA metadata file not found" in error
    
    def test_validate_missing_synthea_directory(self, tmp_path):
        """Test validation fails when Synthea directory doesn't exist."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        
        args = Mock()
        args.patient_count = 25
        args.tcia_metadata = str(tcia_file)
        args.synthea_path = str(tmp_path / "nonexistent")
        
        error = validate_arguments(args)
        assert error is not None
        assert "Synthea directory not found" in error


class TestPrintFunctions:
    """Test print utility functions."""
    
    def test_print_header(self, capsys):
        """Test print_header outputs correctly."""
        print_header()
        captured = capsys.readouterr()
        
        assert "Medical Claims Data Generator" in captured.out
        assert "=" in captured.out
    
    def test_print_configuration(self, capsys, tmp_path):
        """Test print_configuration outputs correctly."""
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "tcia.csv",
            patient_count=25,
            seed=12345,
            synthea_path=tmp_path / "synthea"
        )
        
        print_configuration(config)
        captured = capsys.readouterr()
        
        assert "Configuration:" in captured.out
        assert "Output Directory:" in captured.out
        assert "TCIA Metadata:" in captured.out
        assert "Patient Count:" in captured.out
        assert "25" in captured.out
        assert "Random Seed:" in captured.out
        assert "12345" in captured.out
    
    def test_print_configuration_no_seed(self, capsys, tmp_path):
        """Test print_configuration with no seed."""
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "tcia.csv",
            patient_count=25,
            seed=None,
            synthea_path=tmp_path / "synthea"
        )
        
        print_configuration(config)
        captured = capsys.readouterr()
        
        assert "random" in captured.out
    
    def test_print_validation_report_success(self, capsys):
        """Test print_validation_report with successful validation."""
        validation_result = ValidationResult(
            success=True,
            errors=[],
            warnings=[]
        )
        
        print_validation_report(validation_result)
        captured = capsys.readouterr()
        
        assert "Validation Report" in captured.out
        assert "PASSED" in captured.out
    
    def test_print_validation_report_failure(self, capsys):
        """Test print_validation_report with failed validation."""
        validation_result = ValidationResult(
            success=False,
            errors=["Missing file", "Invalid data"],
            warnings=["Low quality"]
        )
        
        print_validation_report(validation_result)
        captured = capsys.readouterr()
        
        assert "Validation Report" in captured.out
        assert "FAILED" in captured.out
        assert "Missing file" in captured.out
        assert "Invalid data" in captured.out
        assert "Low quality" in captured.out
    
    def test_print_statistics_summary(self, capsys):
        """Test print_statistics_summary outputs correctly."""
        statistics = Statistics(
            total_patients=25,
            patients_by_cancer_type={"lung_cancer": 15, "colorectal_cancer": 10},
            total_claims=50,
            claims_by_status={"approved": 30, "denied": 10, "pending": 10},
            documents_by_type={"cms1500": 50, "eob": 50, "radiology": 50, "clinical": 75},
            tcia_patient_ids=["TCIA-001", "TCIA-002"],
            random_seed=12345,
            generation_timestamp="2024-01-01T00:00:00"
        )
        
        print_statistics_summary(statistics)
        captured = capsys.readouterr()
        
        assert "Generation Statistics" in captured.out
        assert "Total Patients:" in captured.out
        assert "25" in captured.out
        assert "lung_cancer" in captured.out
        assert "15" in captured.out
        assert "colorectal_cancer" in captured.out
        assert "10" in captured.out
        assert "Total Claims:" in captured.out
        assert "50" in captured.out
        assert "approved" in captured.out
        assert "30" in captured.out
        assert "Random Seed:" in captured.out
        assert "12345" in captured.out


class TestMainFunction:
    """Test main function."""
    
    def test_main_success(self, tmp_path, capsys):
        """Test main function with successful generation."""
        # Create temporary files
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        output_dir = tmp_path / "output"
        
        # Mock successful generation result
        mock_statistics = Statistics(
            total_patients=25,
            patients_by_cancer_type={"lung_cancer": 15, "colorectal_cancer": 10},
            total_claims=50,
            claims_by_status={"approved": 30, "denied": 10, "pending": 10},
            documents_by_type={"cms1500": 50, "eob": 50},
            tcia_patient_ids=["TCIA-001"],
            random_seed=12345,
            generation_timestamp="2024-01-01T00:00:00"
        )
        
        mock_validation = ValidationResult(
            success=True,
            errors=[],
            warnings=[]
        )
        
        mock_result = GenerationResult(
            success=True,
            statistics=mock_statistics,
            validation_result=mock_validation,
            output_directory=output_dir
        )
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(output_dir),
            '--tcia-metadata', str(tcia_file),
            '--patient-count', '25',
            '--synthea-path', str(synthea_dir)
        ]):
            with patch('medical_claims_generator.main.GenerationOrchestrator') as mock_orchestrator:
                mock_orchestrator.return_value.generate.return_value = mock_result
                
                exit_code = main()
                
                assert exit_code == 0
                captured = capsys.readouterr()
                assert "Medical Claims Data Generator" in captured.out
                assert "Generation completed successfully" in captured.out
    
    def test_main_validation_failure(self, tmp_path, capsys):
        """Test main function with validation failure."""
        # Create temporary files
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        output_dir = tmp_path / "output"
        
        # Mock failed generation result
        mock_statistics = Statistics(
            total_patients=0,
            patients_by_cancer_type={},
            total_claims=0,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=[],
            random_seed=12345,
            generation_timestamp="2024-01-01T00:00:00"
        )
        
        mock_validation = ValidationResult(
            success=False,
            errors=["Missing files"],
            warnings=[]
        )
        
        mock_result = GenerationResult(
            success=False,
            statistics=mock_statistics,
            validation_result=mock_validation,
            output_directory=output_dir
        )
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(output_dir),
            '--tcia-metadata', str(tcia_file),
            '--patient-count', '25',
            '--synthea-path', str(synthea_dir)
        ]):
            with patch('medical_claims_generator.main.GenerationOrchestrator') as mock_orchestrator:
                mock_orchestrator.return_value.generate.return_value = mock_result
                
                exit_code = main()
                
                assert exit_code == 1
                captured = capsys.readouterr()
                assert "Generation completed with errors" in captured.err
    
    def test_main_invalid_patient_count(self, tmp_path, capsys):
        """Test main function with invalid patient count."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(tmp_path / "output"),
            '--tcia-metadata', str(tcia_file),
            '--patient-count', '15',  # Invalid: too low
            '--synthea-path', str(synthea_dir)
        ]):
            exit_code = main()
            
            assert exit_code == 1
            captured = capsys.readouterr()
            assert "must be between 20 and 30" in captured.err
    
    def test_main_missing_tcia_file(self, tmp_path, capsys):
        """Test main function with missing TCIA file."""
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(tmp_path / "output"),
            '--tcia-metadata', str(tmp_path / "nonexistent.csv"),
            '--patient-count', '25',
            '--synthea-path', str(synthea_dir)
        ]):
            exit_code = main()
            
            assert exit_code == 1
            captured = capsys.readouterr()
            assert "TCIA metadata file not found" in captured.err
    
    def test_main_keyboard_interrupt(self, tmp_path, capsys):
        """Test main function handles keyboard interrupt."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(tmp_path / "output"),
            '--tcia-metadata', str(tcia_file),
            '--patient-count', '25',
            '--synthea-path', str(synthea_dir)
        ]):
            with patch('medical_claims_generator.main.GenerationOrchestrator') as mock_orchestrator:
                mock_orchestrator.return_value.generate.side_effect = KeyboardInterrupt()
                
                exit_code = main()
                
                assert exit_code == 130
                captured = capsys.readouterr()
                assert "interrupted by user" in captured.err
    
    def test_main_unexpected_exception(self, tmp_path, capsys):
        """Test main function handles unexpected exceptions."""
        tcia_file = tmp_path / "tcia.csv"
        tcia_file.write_text("test")
        synthea_dir = tmp_path / "synthea"
        synthea_dir.mkdir()
        
        with patch('sys.argv', [
            'main.py',
            '--output-dir', str(tmp_path / "output"),
            '--tcia-metadata', str(tcia_file),
            '--patient-count', '25',
            '--synthea-path', str(synthea_dir)
        ]):
            with patch('medical_claims_generator.main.GenerationOrchestrator') as mock_orchestrator:
                mock_orchestrator.return_value.generate.side_effect = RuntimeError("Test error")
                
                exit_code = main()
                
                assert exit_code == 1
                captured = capsys.readouterr()
                assert "Fatal error" in captured.err
                assert "Test error" in captured.err
