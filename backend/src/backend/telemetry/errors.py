"""Telemetry errors translated to HTTP responses by the router."""


class InvalidHistoryQuery(ValueError):
    """The history range or pagination cursor is invalid."""
