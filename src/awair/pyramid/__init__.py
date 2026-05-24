"""Build side of the pyrmts pyramid for awair sensor data.

Reads existing monthly raw parquet from S3 and emits tier shards conforming
to the pyrmts parquet schema (per metric `foo` with `sum` monoid:
`foo_n: INT32`, `foo_sum: DOUBLE`, `foo_sumsq: DOUBLE`; plus `ts: INT64`
UTC ms and `device_id: INT32`; sorted `(device_id, ts)`).

See `pyramid.yml` at the repo root and `pyrmts/SPEC.md` for the design.
"""
