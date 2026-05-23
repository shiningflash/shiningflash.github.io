---
layout: practice-problem
track: data-engineering
problem_id: 3
title: Transform and Clean Raw Data for Analytics
slug: 003-transform-and-clean-raw-data-for-analytics
category: Data Cleaning
difficulty: Medium
topics: [CSV, validation, regex, date checks]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/003-transform-and-clean-raw-data-for-analytics"
solution_lang: python
---

{% raw %}

**Scenario:**
You receive raw user activity data from a partner API as a messy CSV file. The company wants to load it into a data warehouse (BigQuery, PostgreSQL) for analytics.

Here is what the CSV looks like:

```
user_id,name,email,signup_date,last_login,total_purchases
101,John Doe,john@example.com,2024-12-01,2025-10-10,15
102,Jane Doe,,2025-01-15,2025-09-30,22
103,Bob Smith,bob@example,2024-11-20,2025-10-05,abc
104,,maria@example.com,2025-02-10,,30
```

But it is full of dirty, inconsistent data:

* Missing `name` or `email`
* Invalid email format
* Non-numeric values in `total_purchases`
* Empty `last_login`
* Dates in wrong order (signup_date > last_login)

---

### Your Task:

Write a Python program that:

1. Reads the CSV file line by line. Assume it is large and won't fit in memory.
2. Validates and cleans the data:

 * Skip rows with missing `email` or invalid email format.
 * Replace missing `name` with `"Unknown"`.
 * Replace missing `last_login` with `"N/A"`.
 * Convert `total_purchases` to integer. If invalid, set it to `0`.
 * If `signup_date` is after `last_login`, mark a new column `is_date_valid` as `False`, else `True`.
3. Writes the cleaned data into a new CSV file called `cleaned_users.csv`.

**Example Output (cleaned_users.csv):**

```
user_id,name,email,signup_date,last_login,total_purchases,is_date_valid
101,John Doe,john@example.com,2024-12-01,2025-10-10,15,True
103,Bob Smith,bob@example,2024-11-20,2025-10-05,0,True
104,Unknown,maria@example.com,2025-02-10,N/A,30,False
```

---

### Bonus (if you want to go deeper):

* Log how many rows were skipped and why.
* Keep a separate file (`invalid_rows.csv`) for skipped rows.
* Use a `pydantic` model for validation.

---

**Hints for Interview Thinking:**

* Think streaming reads (`csv` module or `DictReader`).
* Use regex for email validation.
* Assume bad inputs will show up often.
* Make the solution easy to extend (more rules later).

---
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
_Reference implementation_ — `solution.py`

```python
#!/usr/bin/env python3
"""
Clean and Transform Raw Warehouse User Data
Author: Amirul Islam
Description:
    Stream large CSV data, validate and clean rows, and write cleaned output.
"""

import csv
import re
from datetime import datetime
from typing import Dict, Iterator

DIRTY_WAREHOUSE_DATA_FILE_PATH = "../../data/dirty_warehouse_data.csv"
CLEANED_WAREHOUSE_DATA_FILE_PATH = "../../data/cleaned_warehouse_data.csv"
INVALID_ROWS_FILE_PATH = "../../data/invalid_warehouse_data.csv"

EMAIL_REGEX = re.compile(r"^[\w\.-]+@[\w\.-]+\.\w+$")


def read_large_csv(file_path: str) -> Iterator[Dict[str, str]]:
    """Stream large CSV row by row as dictionaries."""
    with open(file_path, "r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        for row in reader:
            yield row


def is_valid_email(email: str) -> bool:
    return EMAIL_REGEX.match(email)


def parse_date(date_str: str) -> datetime | None:
    if not date_str or date_str == "N/A":
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None


def clean_row(row: Dict[str, str]) -> Dict[str, str] | None:
    """Validate and clean a single row. Returns None if invalid."""
    # Skip if email is missing or invalid
    if not row.get("email") or not is_valid_email(row["email"]):
        return None

    # Fill missing name
    row["name"] = (row.get("name") or "Unknown").strip()

    # Fill missing last_login
    row["last_login"] = (row.get("last_login") or "N/A").strip()

    # Convert total_purchases
    try:
        row["total_purchases"] = str(int(row["total_purchases"]))
    except (ValueError, TypeError):
        row["total_purchases"] = "0"

    # Validate date order
    signup = parse_date(row["signup_date"])
    last_login = parse_date(row["last_login"])
    row["is_date_valid"] = (
        "True" if signup and last_login and signup <= last_login else "False"
    )

    return row


def main():
    skipped_count = 0

    headers = [
        "user_id",
        "name",
        "email",
        "signup_date",
        "last_login",
        "total_purchases",
        "is_date_valid",
    ]

    with (
        open(
            CLEANED_WAREHOUSE_DATA_FILE_PATH, "w", newline="", encoding="utf-8"
        ) as cleaned_file,
        open(INVALID_ROWS_FILE_PATH, "w", newline="", encoding="utf-8") as invalid_file,
    ):
        writer = csv.DictWriter(cleaned_file, fieldnames=headers)
        invalid_writer = csv.DictWriter(
            invalid_file, fieldnames=headers[:-1]
        )  # no is_date_valid
        writer.writeheader()
        invalid_writer.writeheader()

        for row in read_large_csv(DIRTY_WAREHOUSE_DATA_FILE_PATH):
            cleaned = clean_row(row)
            if cleaned:
                writer.writerow(cleaned)
            else:
                skipped_count += 1
                invalid_writer.writerow(row)

    print(f"Cleaning complete. Skipped {skipped_count} invalid rows.")


if __name__ == "__main__":
    main()
```
{% endraw %}
