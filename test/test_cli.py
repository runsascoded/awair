"""Tests for CLI commands using snapshot data."""

from pathlib import Path

from awair.cli import awair
from click.testing import CliRunner

# Path to test data
TEST_DATA_PATH = Path(__file__).parent / 'data' / 'snapshot.parquet'


def verify(
    command_args: list[str | Path],
    expected_lines: list[str],
):
    """Helper to run a command and assert exact output lines."""
    runner = CliRunner()
    args = [ str(arg) for arg in command_args ]
    result = runner.invoke(awair, args)
    assert result.exit_code == 0, f"Command failed with exit code {result.exit_code}: {result.output}"

    actual_lines = result.output.rstrip('\n').split('\n')
    assert actual_lines == expected_lines, f"Expected:\n{expected_lines}\nActual:\n{actual_lines}"


def test_data_info_command():
    """Test the data-info command output."""
    verify(['data-info', '-d', TEST_DATA_PATH], [
        'Data file: /Users/ryan/c/380nwk/awair/test/data/snapshot.parquet',
        'Total records: 46797',
        'Date range: 2025-06-05 18:00:58 to 2025-07-08 10:05:06.948000',
        'File size: 0.68 MB'
    ])


def test_hist_command():
    """Test the hist command output."""
    verify(['hist', '-d', TEST_DATA_PATH], [
        '    358 2025-06-05',
        '   1433 2025-06-06',
        '   1422 2025-06-07',
        '   1433 2025-06-08',
        '   1434 2025-06-09',
        '   1433 2025-06-10',
        '   1434 2025-06-11',
        '   1434 2025-06-12',
        '   1434 2025-06-13',
        '   1425 2025-06-14',
        '   1434 2025-06-15',
        '   1433 2025-06-16',
        '   1434 2025-06-17',
        '   1430 2025-06-18',
        '   1432 2025-06-19',
        '   1432 2025-06-20',
        '   1434 2025-06-21',
        '   1433 2025-06-22',
        '   1432 2025-06-23',
        '   1433 2025-06-24',
        '   1434 2025-06-25',
        '   1431 2025-06-26',
        '   1434 2025-06-27',
        '   1431 2025-06-28',
        '   1434 2025-06-29',
        '   1430 2025-06-30',
        '   1434 2025-07-01',
        '   1433 2025-07-02',
        '   1433 2025-07-03',
        '   1433 2025-07-04',
        '   1434 2025-07-05',
        '   1432 2025-07-06',
        '   1434 2025-07-07',
        '    603 2025-07-08'
    ])


def test_hist_command_with_date_range():
    """Test the hist command with date range filtering."""
    verify(['hist', '-d', TEST_DATA_PATH, '-f', '20250607', '-t', '20250608'], [
        '   1422 2025-06-07'
    ])


def test_gaps_command():
    """Test the gaps command output."""
    verify(['gaps', '-d', TEST_DATA_PATH, '-n', '5'], [
        'Gap analysis for /Users/ryan/c/380nwk/awair/test/data/snapshot.parquet',
        'Date range: 2025-06-05 to 2025-07-08',
        'Total records: 46797',
        '',
        'Top 5 largest gaps:',
        '  9.5m gap: 2025-06-07 17:06:32 -> 2025-06-07 17:16:01',
        '  7.3m gap: 2025-06-14 11:17:26 -> 2025-06-14 11:24:43',
        '  7.2m gap: 2025-06-18 04:02:34 -> 2025-06-18 04:09:44',
        '  4.7m gap: 2025-06-18 14:27:25 -> 2025-06-18 14:32:09',
        '  3.5m gap: 2025-06-23 19:08:27 -> 2025-06-23 19:11:58'
    ])


def test_gaps_command_with_min_gap():
    """Test the gaps command with minimum gap filter."""
    verify(['gaps', '-d', TEST_DATA_PATH, '-m', '300', '-n', '3'], [
        'Gap analysis for /Users/ryan/c/380nwk/awair/test/data/snapshot.parquet',
        'Date range: 2025-06-05 to 2025-07-08',
        'Total records: 46797',
        'Gaps >= 300s: 3',
        'Total gap time: 23.9 minutes',
        '',
        'Top 3 largest gaps:',
        '  9.5m gap: 2025-06-07 17:06:32 -> 2025-06-07 17:16:01',
        '  7.3m gap: 2025-06-14 11:17:26 -> 2025-06-14 11:24:43',
        '  7.2m gap: 2025-06-18 04:02:34 -> 2025-06-18 04:09:44'
    ])


def test_gaps_command_with_date_range():
    """Test the gaps command with date range filtering."""
    verify(['gaps', '-d', TEST_DATA_PATH, '-f', '20250607', '-t', '20250608', '-n', '3'], [
        'Gap analysis for /Users/ryan/c/380nwk/awair/test/data/snapshot.parquet',
        'Date range: 2025-06-07 to 2025-06-07',
        'Total records: 1422',
        '',
        'Top 3 largest gaps:',
        '  9.5m gap: 2025-06-07 17:06:32 -> 2025-06-07 17:16:01',
        '  3.0m gap: 2025-06-07 16:18:31 -> 2025-06-07 16:21:32',
        '  2.8m gap: 2025-06-07 17:03:43 -> 2025-06-07 17:06:32'
    ])


def test_flexible_date_parsing():
    """Test that flexible date parsing works in commands."""
    verify(['hist', '-d', TEST_DATA_PATH, '-f', '250607', '-t', '250608'], [
        '   1422 2025-06-07'
    ])


def test_nonexistent_file():
    """Test behavior with nonexistent data file."""
    verify(['data-info', '-d', 'nonexistent.parquet'], [
        'Data file: nonexistent.parquet',
        'Total records: 0',
        'No data in file'
    ])


def test_hist_flexible_date_formats():
    """Test various flexible date formats with hist command."""
    # Test short format
    verify(['hist', '-d', TEST_DATA_PATH, '-f', '250607', '-t', '250608'], [
        '   1422 2025-06-07'
    ])

    # Test full format
    verify(['hist', '-d', TEST_DATA_PATH, '-f', '20250607', '-t', '20250608'], [
        '   1422 2025-06-07'
    ])

    # Test with hour - should only show partial day data
    verify(['hist', '-d', TEST_DATA_PATH, '-f', '250607T10', '-t', '250607T14'], [
        '    239 2025-06-07'
    ])


def test_gaps_no_gaps_scenario():
    """Test gaps command when no significant gaps exist."""
    verify(['gaps', '-d', TEST_DATA_PATH, '-m', '10000'], [
        'No gaps >= 10000 seconds found'
    ])


def test_command_help_includes_docstrings():
    """Test that command help includes the docstrings we added."""
    verify(['--help'], [
        'Usage: awair [OPTIONS] COMMAND [ARGS]...',
        '',
        'Options:',
        '  --help  Show this message and exit.',
        '',
        'Commands:',
        '  data-info  Show data file information.',
        '  devices    List all devices associated with the authenticated user account.',
        '  gaps       Find and report the largest timing gaps in the data.',
        '  hist       Generate histogram of record counts per day.',
        '  raw        Fetch raw air data from an Awair Element device.',
        '  self       Get information about the authenticated user account.'
    ])
