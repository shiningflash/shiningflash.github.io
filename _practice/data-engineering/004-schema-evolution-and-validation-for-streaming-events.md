---
layout: practice-problem
track: data-engineering
id: 4
title: Schema Evolution and Validation for Streaming Events
slug: 004-schema-evolution-and-validation-for-streaming-events
category: Schema Validation
difficulty: Medium
topics: [JSON, schema evolution, type coercion, pydantic]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/004-schema-evolution-and-validation-for-streaming-events"
solution_lang: python
---

{% raw %}

**Scenario:**
You’re building a streaming pipeline that ingests **user event data** from multiple microservices.
The data comes in JSON format like this:

```json
{"user_id": 101, "event_type": "login", "timestamp": "2025-10-14T12:00:00Z"}
{"user_id": 102, "event_type": "purchase", "amount": 59.99, "timestamp": "2025-10-14T12:02:15Z"}
{"user_id": "103", "event_type": "logout", "timestamp": "2025-10-14T12:05:20Z"}
{"event_type": "login", "timestamp": "2025-10-14T12:07:00Z"}
```

But because these events come from **different teams and versions**, they are often **incomplete, inconsistent, or evolve over time**:

* `user_id` might be a string or int
* `amount` may appear only for purchase events
* Some fields may be missing
* Future versions may include new fields (like `device` or `location`)

Your goal: **Validate and normalize** these events before they are published to your downstream system (e.g., BigQuery, Kafka, or Pub/Sub).

---

### Task:

Write a Python program that:

1. Reads a JSON lines file (`events.jsonl`) line by line (treat it as streaming input).
2. Validates and normalizes each event based on this **expected schema**:

| Field      | Type  | Required | Notes                                                            |
| ---------- | ----- | -------- | ---------------------------------------------------------------- |
| user_id    | int   | ✅ Yes    | Convert to int if possible; skip event if missing or invalid     |
| event_type | str   | ✅ Yes    | Must be one of `"login"`, `"logout"`, `"purchase"`               |
| timestamp  | str   | ✅ Yes    | Must be valid ISO8601                                            |
| amount     | float | ❌ No     | Only required for `"purchase"` events; default to 0.0 if missing |
| device     | str   | ❌ No     | Optional new field (can be present or not)                       |

3. Writes **valid normalized events** to `cleaned_events.jsonl`.
4. Writes **invalid events** to `invalid_events.jsonl` with an extra field `"error_reason"` describing why it failed validation.

---

### Example Output (cleaned_events.jsonl):

```json
{"user_id": 101, "event_type": "login", "timestamp": "2025-10-14T12:00:00Z", "amount": 0.0}
{"user_id": 102, "event_type": "purchase", "timestamp": "2025-10-14T12:02:15Z", "amount": 59.99}
{"user_id": 103, "event_type": "logout", "timestamp": "2025-10-14T12:05:20Z", "amount": 0.0}
```

### Example Output (invalid_events.jsonl):

```json
{"event_type": "login", "timestamp": "2025-10-14T12:07:00Z", "error_reason": "missing user_id"}
{"user_id": "abc", "event_type": "purchase", "timestamp": "2025-10-14T12:09:00Z", "amount": "NaN", "error_reason": "user_id not convertible to int"}
```

---

### Bonus Challenges (Highly Recommended):

* Make your schema **evolution-proof** – gracefully ignore unknown fields instead of failing.
* Keep counters: total events processed, valid, invalid.
* Use `pydantic` (optional but very powerful) for validation.

---

💡 **Hints:**

* Use `json.loads()` for streaming line-by-line.
* Use `try/except` for type conversions.
* Keep validation and normalization logic inside a single clean function.
* Think about how you’d handle new fields without code changes — this is key for schema evolution.

---
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
_Reference implementation_ — `solution.py`

```python
#!/usr/bin/env python3
"""
Validate and Normalize Streaming User Events (Schema Evolution Ready)
Author: Amirul Islam
Description:
    Streams JSON events line-by-line, validates and normalizes them
    against an evolving schema, and separates valid and invalid events.
Complexity:
    Time: O(n) — one pass over events.
    Space: O(1) — processes line by line.
"""

import json
from datetime import datetime
from typing import Any, Dict, Iterator

RAW_EVENTS_FILE_PATH = "../../data/events.jsonl"
CLEANED_EVENTS_FILE_PATH = "../../data/cleaned_events.jsonl"
INVALID_EVENTS_FILE_PATH = "../../data/invalid_events.jsonl"

VALID_EVENT_TYPES = {"login", "logout", "purchase"}


def read_json_lines(file_path: str) -> Iterator[Dict[str, Any]]:
    """Stream JSON objects line by line (memory-safe)."""
    with open(file_path, "r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                yield {
                    "_raw": line,
                    "error_reason": f"invalid_json_at_line_{line_number}",
                }


def is_valid_iso8601(ts: str) -> bool:
    """Check if timestamp is ISO8601-formatted."""
    try:
        datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return True
    except Exception:
        return False


def normalize_event(event: Dict[str, Any]) -> Dict[str, Any] | None:
    """
    Validate and normalize a single event.
    Returns normalized dict if valid, or None if invalid.
    Adds 'error_reason' if invalid.
    """
    # --- Validate user_id ---
    if "user_id" not in event:
        event["error_reason"] = "missing user_id"
        return None
    try:
        user_id = int(event["user_id"])
    except (ValueError, TypeError):
        event["error_reason"] = "user_id not convertible to int"
        return None

    # --- Validate event_type ---
    event_type = str(event.get("event_type", "")).lower()
    if event_type not in VALID_EVENT_TYPES:
        event["error_reason"] = f"invalid event_type '{event_type}'"
        return None

    # --- Validate timestamp ---
    timestamp = event.get("timestamp")
    if not timestamp or not is_valid_iso8601(timestamp):
        event["error_reason"] = "invalid or missing timestamp"
        return None

    # --- Normalize amount ---
    amount = 0.0
    if event_type == "purchase":
        try:
            amount = float(event.get("amount", 0.0))
        except (ValueError, TypeError):
            event["error_reason"] = "invalid amount for purchase"
            return None

    # --- Optional fields (schema evolution safe) ---
    device = event.get("device") if isinstance(event.get("device"), str) else None

    # --- Build normalized record ---
    normalized = {
        "user_id": user_id,
        "event_type": event_type,
        "timestamp": timestamp,
        "amount": round(amount, 2),
    }
    # keep optional field if present
    if device:
        normalized["device"] = device

    return normalized


def main():
    total = valid = invalid = 0

    with (
        open(CLEANED_EVENTS_FILE_PATH, "w", encoding="utf-8") as clean_f,
        open(INVALID_EVENTS_FILE_PATH, "w", encoding="utf-8") as invalid_f,
    ):
        for event in read_json_lines(RAW_EVENTS_FILE_PATH):
            total += 1

            # Handle decode errors specially
            if "_raw" in event:
                invalid += 1
                invalid_f.write(json.dumps(event, ensure_ascii=False) + "\n")
                continue

            normalized = normalize_event(event)
            if normalized:
                valid += 1
                clean_f.write(json.dumps(normalized, ensure_ascii=False) + "\n")
            else:
                invalid += 1
                invalid_f.write(json.dumps(event, ensure_ascii=False) + "\n")

    print(
        f"Validation complete. "
        f"Processed {total} events: {valid} valid, {invalid} invalid."
    )


if __name__ == "__main__":
    main()
```
{% endraw %}
