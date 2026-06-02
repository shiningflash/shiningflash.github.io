---
concept_id: 3
slug: real-time-clearing
title: 'The one weird rule: balance every second'
tease: 'The single rule that makes electricity different from every other product.'
section: 'Foundations'
status: live
---

A bakery bakes bread in the morning and sells it in the afternoon. A warehouse holds water bottles for months. Electricity gets none of that. The wires hold almost nothing.

So whatever Sweden is using right now, Sweden has to be making *right now*. Not over the hour. Not on average. **This second.**

```mermaid
flowchart LR
    G([Generation<br/>this second])
    E([balance<br/>required])
    C([Consumption<br/>this second])

    G --- E --- C

    style G fill:#dcfce7,stroke:#15803d,color:#14532d
    style E fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style C fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

If we make less than we use, the grid frequency falls. If we make more than we use, the frequency rises. Either way, the system has about **a few seconds** to fix it.

That one rule is where everything else in the market comes from.

## What follows from the rule

```mermaid
flowchart TB
    R([The rule<br/>balance every second])

    R --> A([Day-ahead market<br/>plans set 12 to 36 hours ahead])
    R --> B([Intraday market<br/>plans adjusted as forecasts change])
    R --> C([Balancing reserves<br/>last gap closed in real time])
    R --> D([Imbalance charges<br/>so someone pays when the plan is wrong])
    R --> E([Negative prices<br/>paying people to use power when there is too much])

    style R fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style A fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style B fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style D fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style E fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

Each of these is the market trying to keep two numbers matched, second by second, across a whole country.

## A small Swedish example

A cold January morning in Stockholm. People wake up. Heat pumps and electric heaters click on within 30 minutes of each other. Demand jumps by a few hundred MW.

The day-ahead bids for these hours were placed yesterday at noon, before anyone knew today would be this cold. So the plan is now slightly wrong.

Three things happen, in order, with no human in the loop:

1. Frequency dips a little, because demand briefly outran supply.
2. **FCR** reserves push more power in within seconds and stop the dip.
3. Intraday prices rise. Traders buy extra MWh for the morning. Generators ramp up.

No phone calls. No emails. The price and the automatic reserves do the work. That is the rule being followed in real time.

## Next

When the system is off balance, frequency is how you see it. See [Frequency: the heartbeat]({{ '/energy/concepts/004-frequency-heartbeat/' | relative_url }}).
