---
layout: practice-problem
track: data-engineering
problem_id: 1
title: Log File Error Analysis
slug: 001-log-file-error-analysis
category: Logs and Monitoring
difficulty: Easy
topics: [file streaming, counters, top-N, IoT logs]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/001-log-file-error-analysis"
solution_lang: python
---

{% raw %}

**Scenario:**
You have a huge log file from an IoT platform. Each line follows this structure:

```
2025-10-11T13:45:20Z sensor_12 OK
2025-10-11T13:45:21Z sensor_45 ERROR
2025-10-11T13:45:22Z sensor_12 ERROR
2025-10-11T13:45:25Z sensor_99 OK
...
```

Each line contains:

* A timestamp (ISO format)
* A sensor ID
* A status (`OK` or `ERROR`)

The file can be **very large (10+ GB)** — so you **cannot load it fully into memory**.

---

### Task:

Write a **Python program** that:

1. Reads the log file efficiently (without loading the entire file).
2. Counts how many times each sensor reported `ERROR`.
3. Prints the **top 5 sensors** with the highest error counts.

**Bonus (Optional):**

* Print both count and percentage of total errors for each top sensor.
* Your code should work even if the file is extremely large.

---

💡 **Tips:**

* Think about streaming/iterative processing.
* Consider using `Counter`, `heapq`, or generator patterns.
* Clean and readable code matters as much as correctness.

---
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
_Reference implementation_ — `solution.py`

```python
#!/usr/bin/env python3
"""
Log Analyzer: Count sensor errors efficiently from large log files.
Author: Amirul Islam
"""

import heapq
from collections import defaultdict
from typing import Dict

LOG_FILE_PATH = "../../data/sensor_data.log"


def analyze_log(file_path: str) -> Dict[str, Dict[str, int]]:
    """
    Analyzes a large sensor log file and returns OK/error counts per sensor.
    """
    counts = defaultdict(lambda: {"ok": 0, "error": 0})

    try:
        with open(file_path, "r") as file:
            for line_num, line in enumerate(file, 1):
                parts = line.strip().split()
                if len(parts) != 3:
                    # skip malformed line but log it in real pipeline
                    continue

                _, sensor_id, status = parts
                status = status.upper()
                if status == "OK":
                    counts[sensor_id]["ok"] += 1
                elif status == "ERROR":
                    counts[sensor_id]["error"] += 1
                else:
                    # unknown status, skip or log warning
                    continue
    except FileNotFoundError:
        raise SystemExit(f"Log file not found: {file_path}")

    return counts


def print_top_errors(counts: Dict[str, Dict[str, int]], top_n: int = 5):
    """
    Prints top N sensors with the highest error counts.
    """
    # Use heapq for efficient top-N extraction
    top_sensors = heapq.nlargest(top_n, counts.items(), key=lambda x: x[1]["error"])

    print(f"Top {top_n} sensors with highest errors:\n")
    print("Sensor ID | OK Count | Error Count | Error Percentage")
    print("-" * 55)

    for sensor_id, data in top_sensors:
        total = data["ok"] + data["error"]
        error_pct = (data["error"] / total) * 100 if total > 0 else 0
        print(
            f"{sensor_id:<9} | {data['ok']:<8} | {data['error']:<11} | {error_pct:>6.2f}%"
        )


def main():
    counts = analyze_log(LOG_FILE_PATH)
    print_top_errors(counts, top_n=5)


if __name__ == "__main__":
    main()
```
{% endraw %}
