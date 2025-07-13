#!/usr/bin/env python3
"""Test the lambda updater locally (without S3)."""

import os
import tempfile
from pathlib import Path

# Mock the S3 atomic_edit for testing
class MockAtomicEdit:
    def __init__(self, bucket, key, **kwargs):
        self.tmp_file = tempfile.NamedTemporaryFile(suffix='.parquet', delete=False)
        self.tmp_path = Path(self.tmp_file.name)
        self.tmp_file.close()

        # If testing with existing data, copy it
        test_data = Path(__file__).parent.parent.parent.parent / 'test' / 'data' / 'snapshot.parquet'
        if test_data.exists() and kwargs.get('download'):
            import shutil
            shutil.copy(test_data, self.tmp_path)

    def __enter__(self):
        return self.tmp_path

    def __exit__(self, *args):
        # Print stats about the file
        if self.tmp_path.exists():
            import pandas as pd
            df = pd.read_parquet(self.tmp_path)
            print(f"Final file has {len(df)} records")
            if not df.empty:
                print(f"Date range: {df['timestamp'].min()} to {df['timestamp'].max()}")
        # Clean up
        if self.tmp_path.exists():
            self.tmp_path.unlink()

def test_updater():
    """Test the updater function locally."""
    # Mock the atomic_edit import
    import sys
    from unittest.mock import MagicMock

    # Mock utz.s3.atomic_edit
    mock_module = MagicMock()
    mock_module.atomic_edit = MockAtomicEdit
    sys.modules['utz.s3'] = mock_module

    # Set up environment
    if not os.environ.get('AWAIR_TOKEN'):
        # Try to read from .token file
        token_file = Path.cwd() / '.token'
        if token_file.exists():
            os.environ['AWAIR_TOKEN'] = token_file.read_text().strip()
        else:
            print("No AWAIR_TOKEN environment variable or .token file found")
            return

    # Import and test the updater
    from .updater import lambda_handler

    print("Testing lambda updater...")

    # Mock event and context
    event = {}
    context = MagicMock()
    context.aws_request_id = 'test-request-id'

    # Run the handler
    result = lambda_handler(event, context)

    print(f"Result: {result}")
    return result

if __name__ == '__main__':
    test_updater()