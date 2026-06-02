---
concept_id: 12
slug: reading-the-data
title: 'Reading the data: load curves and capacity factor'
tease: 'Two charts and one number you will see every day.'
section: 'Foundations'
status: live
---

Every analytical conversation in this business starts with one of two charts. The **load curve** answers *what happens when*. The **duration curve** answers *how often each level happens*. And one number, the **capacity factor**, summarises a whole year of a generator in one digit.

Get fluent with these three and you can follow almost any meeting about energy strategy.

## The load curve: what happens when

A load curve plots demand in MW on the vertical axis and time on the horizontal axis. A winter weekday in Sweden has a very clear shape.

```mermaid
flowchart TB
    A([Overnight, 00:00 to 05:00<br/>around 10,000 MW<br/>people are asleep])
    B([Morning ramp, 06:00 to 09:00<br/>around 16,000 MW<br/>heat, lights, showers])
    C([Working hours, 10:00 to 15:00<br/>around 14,000 MW<br/>gentle midday dip])
    D([Evening peak, 16:00 to 20:00<br/>around 17,000 MW<br/>cooking, lights, EVs])
    E([Wind down, 21:00 to 23:59<br/>around 13,000 MW])

    A --> B --> C --> D --> E

    style A fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style B fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style C fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style D fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style E fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

A load curve answers questions like *when is the peak today*, *how fast does the system ramp*, *did we hit a constraint at any moment*. You read it left to right, like a story.

## The duration curve: how often each level happens

Now take a whole year of hourly values and sort them from biggest to smallest. The shape that comes out is the **duration curve**. The horizontal axis is no longer time. It is *number of hours per year where demand was at least this high*.

```mermaid
flowchart TB
    T1([True winter peak<br/>around 26,000 MW<br/>50 hours per year])
    T2([Strong winter mornings<br/>around 22,000 MW<br/>500 hours per year])
    T3([Average winter day<br/>around 16,000 MW<br/>3,000 hours per year])
    T4([Shoulder season<br/>around 12,000 MW<br/>3,000 hours per year])
    T5([Summer trough<br/>around 9,500 MW<br/>2,000 hours per year])

    T1 --> T2 --> T3 --> T4 --> T5

    style T1 fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style T2 fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style T3 fill:#fef3c7,stroke:#a16207,color:#713f12
    style T4 fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style T5 fill:#dcfce7,stroke:#15803d,color:#14532d
```

A duration curve answers very different questions. *How much firm capacity do I need to invest in. How many hours per year does my peaker actually run. If I shave off the top 50 hours, what happens.*

| Question | Use the load curve | Use the duration curve |
| --- | --- | --- |
| When is peak today? | yes | no |
| How many hours of high prices per year? | no | yes |
| Will the system get tight this evening? | yes | no |
| Worth building a 500 MW peaker? | no | yes |

A simple rule: load curve for operations, duration curve for investment.

## Capacity factor: one number to compare generators

The duration curve shows the whole shape. The **capacity factor** shows just the average.

> **capacity factor = actual energy in a year / what it could have made if it ran flat out**

A year has 8,760 hours. If a 1 MW unit produces 4,380 MWh in a year, its capacity factor is 50 percent.

```mermaid
flowchart TB
    N([Nuclear<br/>80 to 90 percent<br/>runs almost always])
    H([Reservoir hydro<br/>35 to 55 percent<br/>held back on purpose])
    W([Onshore wind<br/>30 to 40 percent<br/>limited by wind])
    O([Offshore wind<br/>40 to 55 percent<br/>steadier sea wind])
    S([Solar in Sweden<br/>10 to 12 percent<br/>short winter days])
    P([Gas peaker<br/>5 to 15 percent<br/>only runs when prices are high])

    style N fill:#dcfce7,stroke:#15803d,color:#14532d
    style H fill:#dcfce7,stroke:#15803d,color:#14532d
    style W fill:#dcfce7,stroke:#15803d,color:#14532d
    style O fill:#dcfce7,stroke:#15803d,color:#14532d
    style S fill:#dcfce7,stroke:#15803d,color:#14532d
    style P fill:#dcfce7,stroke:#15803d,color:#14532d
```

This is why 1,000 MW of new nuclear and 1,000 MW of new solar are *not the same product*. The nuclear unit produces around 7,500 GWh per year. The solar plants produce around 1,000 GWh per year. Same MW on the press release, **seven times** the energy from the nuclear unit.

Capacity factor is the number that lets you turn a MW headline into the MWh that actually matter.

## Next

The same MW vs MWh split, but for storage. See [Storage on the grid]({{ '/energy/concepts/013-storage/' | relative_url }}).
