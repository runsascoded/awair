"""Load and validate a pyrmts pyramid YAML config.

Mirrors `pyrmts/js/packages/pyrmts/src/yaml.ts` (the source of truth). Only
the fields the Python builder cares about are surfaced — storage `type` and
binding details are runtime concerns for the CFW worker.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

VALID_AXES = {'time', 'step'}
VALID_DIM_TYPES = {'int', 'string', 'h3', 'geohash'}
VALID_MONOIDS = {'sum', 'count', 'histogram', 'topk', 'botk', 'hll', 'tdigest'}


@dataclass(frozen=True)
class Dim:
    name: str
    type: str


@dataclass(frozen=True)
class Metric:
    name: str
    monoid: str


@dataclass(frozen=True)
class Tier:
    name: str
    bin: str                    # e.g. '1min', '1h', '1d', '1mo'
    shards: tuple[str, ...]     # ascending, divisibility-chained ladder;
                                # `shards[0]` is smallest, `shards[-1]` is
                                # the max-rung the Python builder writes.
                                # Cascade fills the smaller rungs itself.

    @property
    def max_shard(self) -> str:
        return self.shards[-1]


@dataclass(frozen=True)
class PyramidConfig:
    storage: dict       # opaque; consumed by the serving worker, not the builder
    key_template: str
    axis: str
    bin_col: str
    dims: tuple[Dim, ...]
    metrics: tuple[Metric, ...]
    tiers: tuple[Tier, ...]

    def tier(self, name: str) -> Tier:
        for t in self.tiers:
            if t.name == name:
                return t
        raise KeyError(f'tier {name!r} not in pyramid (have {[t.name for t in self.tiers]})')

    def previous_tier(self, name: str) -> Tier:
        """Return the source tier for coarsening `name` — the largest tier T'
        such that `bin(T') < bin(name)` AND `bin(name) % bin(T') == 0`.

        Bin-divisibility guarantees exact `floor(ts, targetBin)` rebinning.
        A source whose bin doesn't divide the target's would silently smear
        source buckets across neighboring target bins (silent aggregation
        corruption). Matches ctbk's `sourceTierFor` semantics in
        `gbfs/cascade/src/avail3/cascade.ts`.
        """
        from .builder import _bin_ms  # local import to avoid cycle
        target = self.tier(name)
        target_ms = _bin_ms(target.bin)
        best: Tier | None = None
        best_ms = 0
        for t in self.tiers:
            if t.name == name:
                break
            t_ms = _bin_ms(t.bin)
            if t_ms < target_ms and target_ms % t_ms == 0 and t_ms > best_ms:
                best, best_ms = t, t_ms
        if best is None:
            raise ValueError(
                f'tier {name!r} has no bin-divisible source in the pyramid '
                f'(candidates: {[t.name for t in self.tiers if t.name != name]})',
            )
        return best


def load_config(path: str | Path) -> PyramidConfig:
    with open(path) as f:
        raw = yaml.safe_load(f)
    return parse_config(raw)


def parse_config(raw: object) -> PyramidConfig:
    if not isinstance(raw, dict):
        raise ValueError('pyramid config: top-level must be a mapping')

    storage_block = raw.get('storage')
    if not isinstance(storage_block, dict):
        raise ValueError("pyramid config: 'storage' must be a mapping")
    storage = dict(storage_block)
    key_template = storage.pop('key', None)
    if not isinstance(key_template, str):
        raise ValueError("pyramid config: 'storage.key' (template) must be a string")

    axis = raw.get('axis', 'time')
    if axis not in VALID_AXES:
        raise ValueError(f'pyramid config: axis {axis!r} invalid (want one of {sorted(VALID_AXES)})')

    bin_col = raw.get('binCol', 'ts')
    if not isinstance(bin_col, str):
        raise ValueError("pyramid config: 'binCol' must be a string")

    dims = tuple(_parse_dim(d, i) for i, d in enumerate(_require_list(raw, 'dims')))
    metrics = tuple(_parse_metric(m, i) for i, m in enumerate(_require_list(raw, 'metrics')))
    tiers = tuple(_parse_tier(t, i) for i, t in enumerate(_require_list(raw, 'tiers')))
    if not tiers:
        raise ValueError("pyramid config: 'tiers' must be non-empty")

    return PyramidConfig(
        storage=storage,
        key_template=key_template,
        axis=axis,
        bin_col=bin_col,
        dims=dims,
        metrics=metrics,
        tiers=tiers,
    )


def _require_list(raw: dict, key: str) -> list:
    v = raw.get(key)
    if not isinstance(v, list):
        raise ValueError(f"pyramid config: {key!r} must be a list")
    return v


def _parse_dim(raw: object, i: int) -> Dim:
    if not isinstance(raw, dict):
        raise ValueError(f'pyramid config: dims[{i}] must be a mapping')
    name = raw.get('name')
    type_ = raw.get('type')
    if not isinstance(name, str):
        raise ValueError(f'pyramid config: dims[{i}].name must be a string')
    if type_ not in VALID_DIM_TYPES:
        raise ValueError(f'pyramid config: dims[{i}].type {type_!r} invalid (want one of {sorted(VALID_DIM_TYPES)})')
    return Dim(name=name, type=type_)


def _parse_metric(raw: object, i: int) -> Metric:
    if not isinstance(raw, dict):
        raise ValueError(f'pyramid config: metrics[{i}] must be a mapping')
    name = raw.get('name')
    monoid = raw.get('monoid')
    if not isinstance(name, str):
        raise ValueError(f'pyramid config: metrics[{i}].name must be a string')
    if monoid not in VALID_MONOIDS:
        raise ValueError(f'pyramid config: metrics[{i}].monoid {monoid!r} invalid (want one of {sorted(VALID_MONOIDS)})')
    return Metric(name=name, monoid=monoid)


def _parse_tier(raw: object, i: int) -> Tier:
    if not isinstance(raw, dict):
        raise ValueError(f'pyramid config: tiers[{i}] must be a mapping')
    name = raw.get('name')
    bin_ = raw.get('bin')
    if not isinstance(name, str):
        raise ValueError(f'pyramid config: tiers[{i}].name must be a string')
    if not isinstance(bin_, str):
        raise ValueError(f'pyramid config: tiers[{i}].bin must be a string')
    # Accept new plural `shards: [rung0, ..., maxRung]`; fall back to
    # legacy singular `shard: <dur>` and wrap as a single-rung ladder.
    shards_raw = raw.get('shards')
    if shards_raw is None:
        shard = raw.get('shard')
        if not isinstance(shard, str):
            raise ValueError(
                f'pyramid config: tiers[{i}] needs either `shards: [...]` '
                f'(plural) or legacy `shard: <dur>` (singular)',
            )
        shards = (shard,)
    else:
        if not isinstance(shards_raw, list) or len(shards_raw) == 0 or not all(isinstance(s, str) for s in shards_raw):
            raise ValueError(f'pyramid config: tiers[{i}].shards must be a non-empty list of strings')
        shards = tuple(shards_raw)
    return Tier(name=name, bin=bin_, shards=shards)
