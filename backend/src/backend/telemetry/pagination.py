"""Encode and validate cursors bound to a specific history query."""

import hashlib
import json
from base64 import b64decode, urlsafe_b64encode
from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, Field

from backend.telemetry.errors import InvalidHistoryQuery
from backend.telemetry.schemas import Aggregation


class HistoryCursor(BaseModel):
    observed_at: datetime
    id: Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]
    scope: Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


def query_scope(
    start: datetime,
    end: datetime,
    tag_name: list[str] | None,
    tag_ids: list[int] | None,
    aggregation: Aggregation,
) -> str:
    payload = [
        start.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat(),
        sorted(set(tag_name)) if tag_name is not None else None,
        sorted(set(tag_ids)) if tag_ids is not None else None, aggregation,
    ]
    return hashlib.sha256(json.dumps(payload, separators=(',', ':')).encode()).hexdigest()


def decode_cursor(cursor: str, scope: str) -> HistoryCursor:
    try:
        payload = b64decode(cursor + '=' * (-len(cursor) % 4), altchars=b'-_', validate=True)
        position = HistoryCursor.model_validate_json(payload)
        if position.scope != scope:
            raise ValueError('Different query')
        return position
    except ValueError as exc:
        raise InvalidHistoryQuery('Invalid history cursor or cursor does not match the query') from exc


def encode_cursor(time: datetime, position: int, scope: str) -> str:
    payload = HistoryCursor(observed_at=time, id=position, scope=scope)
    return urlsafe_b64encode(payload.model_dump_json().encode()).decode().rstrip('=')
