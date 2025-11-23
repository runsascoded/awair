#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#   "pandas",
#   "pyarrow",
#   "utz>=0.20.0",
#   "click>=8.0.0",
#   "boto3",
# ]
# ///
"""Rewrite Parquet files with smaller row groups using atomic S3 updates."""
from click import argument, command, option
import pyarrow.parquet as pq
from utz.s3 import atomic_edit


@command()
@argument('s3_path')
@argument('row_group_size', type=int)
def rewrite_parquet(s3_path: str, row_group_size: int):
    """Rewrite a Parquet file with specified row group size using atomic S3 update.

    Example:
        rewrite_parquet_row_groups.py s3://380nwk/awair-17617.parquet 10000
    """
    # Parse S3 path
    if not s3_path.startswith('s3://'):
        raise ValueError(f'Path must start with s3://: {s3_path}')

    s3_path_clean = s3_path[5:]  # Remove 's3://'
    parts = s3_path_clean.split('/', 1)
    bucket = parts[0]
    key = parts[1] if len(parts) > 1 else ''

    print(f'Rewriting {s3_path} with row_group_size={row_group_size}')

    # Read metadata to show before/after
    parquet_file = pq.ParquetFile(s3_path)
    print(f'Before: {parquet_file.metadata.num_row_groups} row groups')
    if parquet_file.metadata.num_row_groups > 0:
        first_rg = parquet_file.metadata.row_group(0)
        print(f'  First row group size: {first_rg.num_rows} rows')

    # Use atomic_edit to safely rewrite
    with atomic_edit(bucket, key, download=True) as tmp_path:
        # Read the table
        table = pq.read_table(str(tmp_path))
        print(f'  Total rows: {len(table)}')

        # Write back with smaller row groups
        pq.write_table(
            table,
            tmp_path,
            row_group_size=row_group_size
        )

        # Show new metadata
        new_file = pq.ParquetFile(str(tmp_path))
        print(f'After: {new_file.metadata.num_row_groups} row groups')
        if new_file.metadata.num_row_groups > 0:
            first_rg = new_file.metadata.row_group(0)
            print(f'  First row group size: {first_rg.num_rows} rows')

    print(f'Successfully rewrote {s3_path}')


if __name__ == '__main__':
    rewrite_parquet()
