---
layout: practice-problem
track: data-engineering
problem_id: 5
title: Merging Messy CSVs from Multiple Partners
slug: 005-merging-messy-csvs-from-multiple-partners
category: Data Integration
difficulty: Medium
topics: [CSV, column mapping, date parsing, file walk]
source_url: "https://github.com/shiningflash/data-engineering-practice-problems/tree/main/problems/005-merging-messy-csvs-from-multiple-partners"
solution_lang: python
---

{% raw %}

**Scenario:**
Every Monday morning, your team receives a folder of CSV files from different partners. Each file contains the same kind of data (customer signups), but every partner names their columns differently. Some files have extra columns you don’t care about, some have missing values, and the date format is never consistent.

Here is what three example files might look like:

```
# partner_a.csv
customer_id,full_name,email,signup_date
201,Alice Lee,alice@a.com,2025-10-01
202,Bob Khan,bob@a.com,2025-10-02
```

```
# partner_b.csv
CustomerID,Name,Email,SignupDate,Country
301,Carol Tan,carol@b.com,2025-10-01,SG
302,,daniel@b.com,2025-10-04,MY
```

```
# partner_c.csv
cust_id,name,email_addr,joined_on
401,Eve Patel,eve@c.com,01/10/2025
402,Frank Wu,frank@c.com,02/10/2025
```

Typical issues you will see:

* Same field has different names (`customer_id`, `CustomerID`, `cust_id`)
* Date formats differ (`2025-10-01` vs `01/10/2025`)
* Some files have extra columns (like `Country`) that you don’t need
* Some rows have missing values
* The folder may contain hundreds of files

The warehouse team wants a single clean CSV they can load straight into BigQuery.

---

### Your Task:

Write a Python program that:

1. Reads every CSV file inside a folder called `partner_csvs/`.
2. Maps the different column names into one standard schema:

| Standard column | Possible source names              |
| --------------- | ---------------------------------- |
| customer_id     | customer_id, CustomerID, cust_id   |
| name            | name, Name, full_name              |
| email           | email, Email, email_addr           |
| signup_date     | signup_date, SignupDate, joined_on |

3. Converts `signup_date` to `YYYY-MM-DD`.
4. Skips rows that are missing `email` or `customer_id`.
5. Replaces a missing `name` with `"Unknown"`.
6. Adds a `source_file` column so you can trace which file each row came from.
7. Writes everything into a single output file called `all_customers.csv`.

**Example Output (all_customers.csv):**

```
customer_id,name,email,signup_date,source_file
201,Alice Lee,alice@a.com,2025-10-01,partner_a.csv
202,Bob Khan,bob@a.com,2025-10-02,partner_a.csv
301,Carol Tan,carol@b.com,2025-10-01,partner_b.csv
302,Unknown,daniel@b.com,2025-10-04,partner_b.csv
401,Eve Patel,eve@c.com,2025-10-01,partner_c.csv
402,Frank Wu,frank@c.com,2025-10-02,partner_c.csv
```

---

### Bonus Challenges:

* Print a small summary at the end: how many files were read, total rows in, rows written, rows skipped.
* Move the column mapping into a small config dict (or YAML file) so a new partner can be added without touching the code.
* Handle GZIP compressed files (`.csv.gz`) too.
* Stream the writing so that even with 500 files you never hold everything in memory.

---

💡 **Hints:**

* Use `pathlib.Path.glob` to walk the folder.
* The `csv.DictReader` and `csv.DictWriter` make column renaming much easier than positional indexes.
* Build a reverse lookup table from partner column name to standard column name once, then reuse it.
* Keep the date parsing in its own small function so adding a new format later is easy.

---
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
_Reference implementation_ — `solution.py`

```python
#!/usr/bin/env python3
"""
Partner CSV Merger: combine customer CSVs from many partners
into a single clean file with a standard schema.
Author: Amirul Islam
"""

import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Optional

INPUT_FOLDER = "../../data/partner_csvs"
OUTPUT_FILE = "all_customers.csv"

# Standard column -> possible source names from different partners
COLUMN_MAP = {
    "customer_id": ["customer_id", "CustomerID", "cust_id"],
    "name": ["name", "Name", "full_name"],
    "email": ["email", "Email", "email_addr"],
    "signup_date": ["signup_date", "SignupDate", "joined_on"],
}

DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"]

STANDARD_COLUMNS = list(COLUMN_MAP.keys()) + ["source_file"]


def build_reverse_map() -> Dict[str, str]:
    """Map any known partner column name back to our standard column name."""
    reverse = {}
    for standard, options in COLUMN_MAP.items():
        for option in options:
            reverse[option.lower()] = standard
    return reverse


def parse_date(value: str) -> Optional[str]:
    """Try a few common date formats and return ISO date if one matches."""
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def normalize_row(
    row: Dict[str, str],
    reverse_map: Dict[str, str],
    source: str,
) -> Optional[Dict[str, str]]:
    """Map one raw row to the standard schema. Return None if the row is unusable."""
    clean = {col: "" for col in STANDARD_COLUMNS}

    for raw_col, value in row.items():
        if raw_col is None:
            continue
        standard = reverse_map.get(raw_col.lower())
        if standard:
            clean[standard] = (value or "").strip()

    if not clean["customer_id"] or not clean["email"]:
        return None

    if not clean["name"]:
        clean["name"] = "Unknown"

    if clean["signup_date"]:
        parsed = parse_date(clean["signup_date"])
        if parsed is None:
            return None
        clean["signup_date"] = parsed

    clean["source_file"] = source
    return clean


def iter_csv_files(folder: str) -> Iterable[Path]:
    return sorted(Path(folder).glob("*.csv"))


def merge_partner_csvs(folder: str, output_file: str) -> Dict[str, int]:
    """Read every CSV in the folder, normalize, and write one combined CSV."""
    reverse_map = build_reverse_map()
    stats = {"files": 0, "rows_in": 0, "rows_out": 0, "rows_skipped": 0}

    with open(output_file, "w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=STANDARD_COLUMNS)
        writer.writeheader()

        for path in iter_csv_files(folder):
            stats["files"] += 1
            try:
                with open(path, "r", newline="") as f:
                    reader = csv.DictReader(f)
                    for raw in reader:
                        stats["rows_in"] += 1
                        clean = normalize_row(raw, reverse_map, path.name)
                        if clean is None:
                            stats["rows_skipped"] += 1
                            continue
                        writer.writerow(clean)
                        stats["rows_out"] += 1
            except FileNotFoundError:
                continue

    return stats


def main():
    stats = merge_partner_csvs(INPUT_FOLDER, OUTPUT_FILE)
    print("Merge complete")
    print(f"  files read:    {stats['files']}")
    print(f"  rows in:       {stats['rows_in']}")
    print(f"  rows written:  {stats['rows_out']}")
    print(f"  rows skipped:  {stats['rows_skipped']}")


if __name__ == "__main__":
    main()
```
{% endraw %}
