# Quick Start Guide

## Installation

```bash
cd medical-claims-generator

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install in development mode
pip install -e ".[dev]"
```

## Verify Installation

```bash
# Check that the CLI is available
generate-medical-claims --help

# Run tests (once implemented)
pytest
```

## Next Steps

The project structure is now set up. Implementation will proceed according to the tasks in `.kiro/specs/medical-claims-data-generator/tasks.md`:

1. ✅ Task 1: Project structure and dependencies (COMPLETE)
2. Task 2: Implement core data models
3. Task 3: Implement Patient Generator
4. Task 4: Implement Patient Mapper
5. And so on...

## Development Workflow

1. Implement functionality in `src/medical_claims_generator/`
2. Write tests in `tests/`
3. Run tests with `pytest`
4. Check code quality with `black`, `ruff`, and `mypy`

## Project Structure

```
medical-claims-generator/
├── src/medical_claims_generator/    # Source code
│   ├── models.py                    # Data models (Task 2)
│   ├── patient_generator.py         # Synthea wrapper (Task 3)
│   ├── patient_mapper.py            # Patient mapping (Task 4)
│   ├── document_generator.py        # Document orchestrator (Task 7)
│   ├── pdf_generators/              # PDF generators (Task 6)
│   ├── output_organizer.py          # File organization (Task 8)
│   ├── validator.py                 # Data validation (Task 9)
│   ├── statistics_generator.py      # Statistics (Task 10)
│   ├── orchestrator.py              # Main orchestrator (Task 12)
│   └── main.py                      # CLI entry point (Task 13)
├── tests/                           # Test suite
├── pyproject.toml                   # Project configuration
├── requirements.txt                 # Production dependencies
└── requirements-dev.txt             # Development dependencies
```
