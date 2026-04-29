"""
Tool Execution Trace Utilities

Provides a TraceCollector class and traced decorator for capturing
tool invocation metadata (name, timing, input/output summaries) during
agent execution. Used by both full_context_agent and enriched_agent.

The collected trace data is serialized with camelCase keys to match
the TypeScript TraceEntry interface directly, avoiding a mapping step
in the orchestrator.
"""

import functools
import json
import time
from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class TraceEntry:
    """A single tool invocation record."""

    tool_name: str
    execution_order: int
    duration_ms: int
    input_summary: str
    output_summary: str
    error: str | None = None


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len, appending '...' if truncated.

    Args:
        text: The string to truncate.
        max_len: Maximum allowed length (must be >= 4 for ellipsis to work).

    Returns:
        The original string if len <= max_len, otherwise the first
        (max_len - 3) characters followed by '...'.
    """
    if len(text) <= max_len:
        return text
    if max_len < 4:
        return text[:max_len]
    return text[: max_len - 3] + "..."


def _summarize_input(args: tuple, kwargs: dict) -> str:
    """Create a readable summary of function arguments.

    Converts positional and keyword arguments into a compact string
    representation, truncating large values.

    Args:
        args: Positional arguments passed to the function.
        kwargs: Keyword arguments passed to the function.

    Returns:
        A string summarizing the inputs.
    """
    parts: list[str] = []

    for i, arg in enumerate(args):
        parts.append(f"arg{i}: {_format_value(arg)}")

    for key, val in kwargs.items():
        parts.append(f"{key}: {_format_value(val)}")

    return ", ".join(parts) if parts else "(no args)"


def _summarize_output(result: Any) -> str:
    """Create a readable summary of a function's return value.

    Args:
        result: The return value of the function.

    Returns:
        A string summarizing the output.
    """
    return _format_value(result)


def _format_value(value: Any) -> str:
    """Format a value for display in a trace summary.

    Handles strings, dicts, lists, and other types with sensible
    truncation for large values.

    Args:
        value: Any Python value.

    Returns:
        A compact string representation.
    """
    if isinstance(value, str):
        # For JSON strings, try to show structure
        if value.startswith("[") or value.startswith("{"):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return f"[...] ({len(parsed)} items)"
                elif isinstance(parsed, dict):
                    keys = list(parsed.keys())[:3]
                    return "{" + ", ".join(keys) + ("..." if len(parsed) > 3 else "") + "}"
            except (json.JSONDecodeError, TypeError):
                pass
        if len(value) > 100:
            return value[:97] + "..."
        return value

    if isinstance(value, list):
        return f"[...] ({len(value)} items)"

    if isinstance(value, dict):
        keys = list(value.keys())[:3]
        return "{" + ", ".join(keys) + ("..." if len(value) > 3 else "") + "}"

    return str(value)[:100]


class TraceCollector:
    """Accumulates tool execution trace entries during an agent invocation.

    Thread-safe for single-threaded agent execution (which is the standard
    Strands SDK execution model).

    Usage::

        collector = TraceCollector()
        # ... record tool calls ...
        collector.record("my_tool", start_time, end_time, "input", "output")
        trace_list = collector.to_list()
    """

    def __init__(self) -> None:
        self._entries: list[TraceEntry] = []
        self._order: int = 0

    def record(
        self,
        tool_name: str,
        start_time: float,
        end_time: float,
        input_summary: str,
        output_summary: str,
        error: str | None = None,
    ) -> None:
        """Record a completed tool invocation.

        Args:
            tool_name: Name of the tool/function that was called.
            start_time: Unix timestamp when the call started (from time.time()).
            end_time: Unix timestamp when the call ended.
            input_summary: Summary of the input arguments.
            output_summary: Summary of the output/result.
            error: Error message if the call failed, None otherwise.
        """
        self._order += 1
        duration_ms = max(0, int((end_time - start_time) * 1000))
        self._entries.append(
            TraceEntry(
                tool_name=tool_name,
                execution_order=self._order,
                duration_ms=duration_ms,
                input_summary=_truncate(input_summary, 200),
                output_summary=_truncate(output_summary, 300),
                error=error,
            )
        )

    def to_list(self) -> list[dict]:
        """Serialize all entries to a list of camelCase dicts.

        The output uses camelCase keys to match the TypeScript TraceEntry
        interface directly, avoiding a mapping step in the orchestrator.

        Returns:
            List of dicts with keys: toolName, executionOrder, durationMs,
            inputSummary, outputSummary, and optionally error.
        """
        result = []
        for entry in self._entries:
            d: dict[str, Any] = {
                "toolName": entry.tool_name,
                "executionOrder": entry.execution_order,
                "durationMs": entry.duration_ms,
                "inputSummary": entry.input_summary,
                "outputSummary": entry.output_summary,
            }
            if entry.error is not None:
                d["error"] = entry.error
            result.append(d)
        return result

    @property
    def entries(self) -> list[TraceEntry]:
        """Read-only access to the collected entries."""
        return list(self._entries)


def traced(collector: TraceCollector):
    """Decorator factory that instruments a function with trace collection.

    Wraps the target function to record its name, timing, input summary,
    and output summary into the provided TraceCollector. If the function
    raises an exception, the trace entry is still recorded with the error
    message, and the exception is re-raised.

    Args:
        collector: The TraceCollector instance to record into.

    Returns:
        A decorator that wraps a function with tracing.

    Usage::

        collector = TraceCollector()
        trace = traced(collector)

        result = trace(my_function)(arg1, arg2)
        # or as a decorator:
        @traced(collector)
        def my_function(x):
            return x * 2
    """

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            input_summary = _summarize_input(args, kwargs)
            start = time.time()
            try:
                result = fn(*args, **kwargs)
                end = time.time()
                output_summary = _summarize_output(result)
                collector.record(
                    fn.__name__, start, end, input_summary, output_summary
                )
                return result
            except Exception as e:
                end = time.time()
                error_msg = str(e)
                collector.record(
                    fn.__name__,
                    start,
                    end,
                    input_summary,
                    f"ERROR: {error_msg}",
                    error=error_msg,
                )
                raise

        return wrapper

    return decorator
