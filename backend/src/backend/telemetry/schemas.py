"""Public telemetry request types and response schemas."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field


Aggregation = Literal['raw', '5min', 'hourly', 'daily', 'weekly', 'monthly']
BucketAggregation = Literal['5min', 'hourly', 'daily', 'weekly', 'monthly']


class TelemetryTagResponse(BaseModel):
    id: int
    tag_key: str
    name: str
    unit: str | None


class TelemetryValue(BaseModel):
    id: int
    tag_id: int
    tag_key: str
    value: float
    quality: int
    observed_at: datetime
    ingested_at: datetime


class LatestTelemetryResponse(BaseModel):
    readings: list[TelemetryValue]


class HistoricalTelemetryResponse(BaseModel):
    aggregation: Literal['raw'] = 'raw'
    readings: list[TelemetryValue]
    next_cursor: str | None = None


class HistoryBucket(BaseModel):
    tag_id: int
    tag_key: str
    bucket_start: datetime
    bucket_end: datetime
    coverage_start: datetime
    coverage_end: datetime
    partial: bool
    method: Literal['average', 'last']
    value: float | None
    minimum: float | None
    maximum: float | None
    sample_count: int
    good_count: int
    uncertain_count: int
    bad_count: int
    unknown_count: int
    usable_count: int
    last_observed_at: datetime
    last_quality: int


class AggregatedTelemetryResponse(BaseModel):
    aggregation: BucketAggregation
    buckets: list[HistoryBucket]
    next_cursor: str | None = None


HistoryResponse = Annotated[
    HistoricalTelemetryResponse | AggregatedTelemetryResponse,
    Field(discriminator='aggregation'),
]
