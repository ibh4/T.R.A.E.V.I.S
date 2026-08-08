"""Event output adapters."""

from .sinks import CompositeEventSink, EventSink, JsonlEventSink, StdoutEventSink

__all__ = ["CompositeEventSink", "EventSink", "JsonlEventSink", "StdoutEventSink"]
