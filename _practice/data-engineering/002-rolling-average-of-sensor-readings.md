---
layout: practice-problem
track: data-engineering
problem_id: 2
title: Rolling Average of Sensor Readings
slug: 002-rolling-average-of-sensor-readings
category: Streaming
difficulty: Easy
topics: [rolling window, deque, IoT sensors, real-time]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/002-rolling-average-of-sensor-readings"
solution_lang: python
---

{% raw %}

**Scenario:**
You are building a data pipeline for IoT sensors (like BESS, PV inverters, weather stations).
Each sensor sends temperature data every few seconds to your system in this format:

```
2025-10-11T13:45:20Z sensor_1 25.4
2025-10-11T13:45:25Z sensor_1 26.1
2025-10-11T13:45:30Z sensor_2 22.8
2025-10-11T13:45:35Z sensor_1 27.0
2025-10-11T13:45:40Z sensor_2 23.4
...
```

Each line contains:

* timestamp (ISO8601)
* sensor_id
* temperature (float, °C)

The stream never ends (you can assume input comes from a file, MQTT, or Kafka — but treat it as **continuous input**).

---

### Task:

Write a Python program that:

1. Continuously reads incoming sensor data (line by line).
2. For **each sensor**, maintains a rolling average temperature over the **last 3 readings**.
3. Each time a new reading arrives, print:

   ```
   <timestamp> <sensor_id> <rolling_average>
   ```

   Example:

   ```
   2025-10-11T13:45:35Z sensor_1 26.17
   ```

---

### Bonus Challenges:

* Make it **memory efficient** (don’t store all history).
* Handle **multiple sensors** dynamically.
* Handle malformed lines gracefully.
* Ensure the code could be easily extended to a real streaming consumer (e.g., Kafka/MQTT).

---

💡 **Tips:**

* Think about how to store only the **last 3 values per sensor**.
* You’ll probably want to use a **deque** or a simple list with slicing.
* Focus on **clean, production-like structure** — not just working code.

---
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
_Reference implementation_ — `solution.py`

```python
#!/usr/bin/env python3
"""
Rolling Average Temperature Processor
Author: Amirul Islam
Description:
    Continuously reads sensor readings from a stream and prints
    a rolling average over the last 3 readings for each sensor.
"""

import sys
from collections import defaultdict, deque
from typing import Deque, Dict


def compute_rolling_average(file_stream=sys.stdin) -> None:
    """
    Reads sensor data from a stream and prints rolling averages
    of the last 3 readings per sensor.

    Expected input line format:
        <timestamp> <sensor_id> <temperature>
    """
    # Use maxlen=3 to automatically maintain a rolling window
    sensor_readings: Dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=3))

    for line_num, line in enumerate(file_stream, 1):
        parts = line.strip().split()
        if len(parts) != 3:
            # skip malformed lines
            continue

        timestamp, sensor_id, temp_str = parts
        try:
            temperature = float(temp_str)
        except ValueError:
            # skip bad temperature values
            continue

        # Update rolling window for the sensor
        sensor_readings[sensor_id].append(temperature)

        # Only print average when we have 3 readings
        if len(sensor_readings[sensor_id]) == 3:
            avg_temp = sum(sensor_readings[sensor_id]) / 3
            print(f"{timestamp} {sensor_id} {avg_temp:.2f}")


def main():
    print("Reading sensor data... (Ctrl+C to stop)")
    try:
        compute_rolling_average()
    except KeyboardInterrupt:
        print("\nStopping stream. Goodbye!")


if __name__ == "__main__":
    main()
```
{% endraw %}
