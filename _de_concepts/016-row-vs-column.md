---
concept_id: 16
slug: row-vs-column
title: "Row-oriented vs column-oriented storage"
tease: "Two ways to lay bytes on disk. One for transactions, one for analytics."
section: "File Formats & Storage"
status: draft
---

A row-oriented store keeps all columns of one row next to each other on disk. Reading a single row is one I/O. A column-oriented store keeps all values of one column next to each other. Reading a single column across millions of rows is one I/O. Almost every analytics question reads few columns from many rows, which is why columnar formats dominate data warehousing.

```mermaid
flowchart LR
    subgraph R["Row layout (Postgres, MySQL)"]
        R1["id=1, name=Ana, city=Berlin, age=29"]
        R2["id=2, name=Ben, city=Oslo, age=34"]
        R3["id=3, name=Cee, city=Berlin, age=41"]
    end
    subgraph C["Column layout (Parquet, ORC)"]
        C1["id: 1, 2, 3"]
        C2["name: Ana, Ben, Cee"]
        C3["city: Berlin, Oslo, Berlin"]
        C4["age: 29, 34, 41"]
    end
```

**What this page will cover.**

- Why "select 2 columns from 10 million rows" reads ~20% of the data in a column store vs 100% in a row store.
- Compression: same-type values next to each other compress 5-10x better.
- The cost: writing one row touches many physical files. Row stores beat column stores on transactional writes.
- Hybrid storage: PAX, row groups in Parquet.
- Predicate pushdown: reading only the row groups that could contain a matching row.
- Why every OLAP system you reach for in 2026 is columnar under the hood.

*Page coming soon.*

This concept sits in **Stage 5 (Storage and file formats)** of the [Data Engineering Roadmap](/practice/data-engineering/roadmap/).
