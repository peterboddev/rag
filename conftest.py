"""Pytest configuration and custom marker registration."""

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "evaluation: marks tests that require Bedrock access for LLM evaluation (deselect with '-m \"not evaluation\"')",
    )
