---
concept_id: 26
slug: reading-nord-pool-day
title: 'Reading one Nord Pool day, hour by hour'
tease: 'A guided walk through 24 hours of real prices. What the shape tells you.'
section: 'Wholesale day-ahead'
status: live
---

A Nord Pool price chart is 24 numbers, one per hour, for each zone. That tiny image carries more information than people realise. Reading it well is one of the most useful skills you can pick up in this market.

Here is a typical SE3 day in late autumn. We will walk it hour by hour.

## A typical autumn day in SE3

| Hour | Price (SEK/MWh) | What was happening |
| --- | --- | --- |
| 00 to 05 | 350 | Overnight low. Demand small. Hydro and nuclear easily cover it. |
| 06 | 700 | Morning ramp begins. Heating turns on. Hydro starts releasing more. |
| 07 to 09 | 1,100 | Peak morning. Cold dark mornings drive heat-pump demand. |
| 10 to 14 | 600 | Working hours. Demand steady but spread out. Solar pushes prices a little down on the continent. |
| 15 | 750 | Demand starts climbing again. People come home. |
| 17 to 19 | 1,400 | Evening peak. Cooking + lights + EVs. Highest hours of the day. |
| 20 to 22 | 800 | Coming down. People wind down. |
| 23 | 450 | Night returns. |

## What the shape tells you

The two-hump shape is the **morning peak** and the **evening peak**. Almost every Swedish weekday in winter looks like this. In summer the morning peak gets weaker because heating disappears. The evening peak stays.

The depth of the **midday dip** depends on solar. In Sweden, solar is small, so the dip is shallow. In Germany or Spain, solar pushes midday prices much lower, sometimes to zero.

The height of the **evening peak** depends on three things: how cold it is, how much wind is forecast, and how full the cables to neighbours are. A cold, calm, congested evening can push the 17-19 hours past 5,000 SEK/MWh.

## Spotting unusual hours

Practice this and you will get fast at it.

```mermaid
flowchart TB
    A([Flat hours at the same price])
    B{Same as continental Europe?}
    B -->|Yes| C([Block order or coupled to Germany])
    B -->|No| D([Big block order from one Nordic player])

    style A fill:#fef3c7,stroke:#a16207,color:#713f12
    style B fill:#fef3c7,stroke:#a16207,color:#713f12
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style D fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

```mermaid
flowchart TB
    E([One hour spikes much higher than neighbours])
    F{Were cables to neighbours full?}
    F -->|Yes| G([Local supply shortage, expensive marginal unit])
    F -->|No| H([Probably a forecast bid-collection issue, rare])

    style E fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style F fill:#fef3c7,stroke:#a16207,color:#713f12
    style G fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style H fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

```mermaid
flowchart TB
    I([Hours of zero or negative price])
    J{Wind forecast very high?}
    J -->|Yes| K([Wind dump. Operators paying to offload])
    J -->|No| L([Look at neighbours and cable flows])

    style I fill:#dcfce7,stroke:#15803d,color:#14532d
    style J fill:#fef3c7,stroke:#a16207,color:#713f12
    style K fill:#dcfce7,stroke:#15803d,color:#14532d
    style L fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

## A small useful habit

Open the Nord Pool day-ahead page at 12:45 every day. Look at the shape of tomorrow's curve. Compare SE3 and SE4. Compare to SE1 and SE2. Note the gap.

Within a few weeks of doing this every day, you start to *feel* the system. You will start predicting which days will spike, which will be flat, and roughly when. That feel is most of what makes a good trader, a good analyst, or a good engineer in this domain.

## Where else to look

- **Nord Pool day-ahead page** for the prices themselves.
- **Svenska kraftnät Kontrollrummet** for the current physical situation.
- **The weather forecast** for tomorrow's prices. Wind and temperature are 80 percent of the explanation.

A weather forecast in this industry is not a hobby. It is the most important input to your day.

## Next

The repeating patterns within a Nord Pool day. See [Common day-ahead patterns]({{ '/energy/concepts/027-common-patterns/' | relative_url }}).
