---
concept_id: 33
slug: fcr-d
title: 'FCR-D up and down: catching the big dips'
tease: 'The big-event reserve. Twice as big as FCR-N. The home market of every grid battery in Sweden.'
section: 'Balancing'
status: live
---

FCR-D stands for **Frequency Containment Reserve, Disturbance**. The -D suffix means *Disturbance*: a serious event, like a nuclear unit tripping offline or a sudden loss of a major interconnector. FCR-N handles the small everyday wobbles. FCR-D handles the alarming ones.

The reserve is **asymmetric**. There is FCR-D **up** (more power into the grid, for when frequency falls hard) and FCR-D **down** (less power, for when frequency rises hard). Plants and batteries can sell either, or both as separate products.

## What FCR-D actually does

```mermaid
flowchart TB
    A([Major event<br/>nuclear unit trips<br/>frequency falls fast])
    B([Frequency crosses 49.90<br/>FCR-N is already maxed])
    C([FCR-D up activates<br/>units push much more power in])
    D([Frequency stops at ~49.50 instead of crashing])
    E([aFRR then pulls it back to 50.00])

    A --> B --> C --> D --> E

    style A fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style B fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style D fill:#fef3c7,stroke:#a16207,color:#713f12
    style E fill:#dcfce7,stroke:#15803d,color:#14532d
```

FCR-D **stops** a serious frequency excursion. It does not bring it back to 50.00. That is aFRR's job. FCR-D's only mission is to **catch the fall** (or the rise) before it becomes dangerous.

## How big is FCR-D

The Nordic synchronous area needs around **1,400 MW** of FCR-D up and similar of FCR-D down. Sweden's share is around **450 MW** of each. Much bigger than FCR-N because the events are much bigger.

The volume is sized so the system can survive losing the **largest single unit** on the grid (often a nuclear unit or a major HVDC interconnector). If something that big trips, FCR-D has to be big enough to catch it.

## How it gets bought

Like FCR-N, Svenska kraftnät runs auctions for FCR-D. Daily on D-1 is the main format. Each product (up and down) is auctioned separately.

```mermaid
flowchart TB
    A([FCR-D up auction<br/>SEK per MW per hour<br/>volume needed: ~450 MW])
    B([FCR-D down auction<br/>SEK per MW per hour<br/>volume needed: ~450 MW])
    C([Same providers can bid both<br/>different prices])

    style A fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style B fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

A battery can sell FCR-D up at 100 SEK/MW per hour and FCR-D down at 60 SEK/MW per hour, depending on what the market is paying. Different products. Different prices.

## Why FCR-D is the battery market

This is the part that matters for the Swedish energy transition.

A battery's biggest competitive advantage over hydro is **response speed**. Hydro can respond in tens of seconds. A battery responds in milliseconds. For FCR-D, where the goal is to catch a fast fall, the millisecond advantage is real.

So Swedish grid-scale battery projects have been built almost exclusively for FCR-D. A 10 MW lithium battery sized for 1 hour of energy is the canonical product. It bids into FCR-D up and FCR-D down, often takes both, and earns a capacity payment for the whole month.

```mermaid
flowchart TB
    A([Lithium battery<br/>10 MW × 1 hour<br/>fast response])
    B([FCR-D up<br/>~150 SEK/MW per hour])
    C([FCR-D down<br/>~100 SEK/MW per hour])
    D([Combined: ~250 SEK/MW per hour<br/>× 10 MW × 24 h × 365 days<br/>~22 MSEK per year])

    A --> B
    A --> C
    B --> D
    C --> D

    style A fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style B fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style D fill:#dcfce7,stroke:#15803d,color:#14532d
```

Numbers are illustrative, prices change. But this is roughly why the first wave of Swedish battery projects pencilled out at all. FCR-D was the only revenue stream big enough to make the numbers work.

## The qualification process

To bid into FCR-D, an asset has to be **qualified** by Svenska kraftnät. The process tests that the asset can respond fast enough, that its telemetry is reliable, and that it can sustain the response for the required time (usually 5 to 15 minutes for FCR-D up, longer for FCR-D down).

This is not a paperwork process. It is real testing, often over weeks. Battery operators have to schedule activation tests, prove their controls work, and pass before they can earn revenue. Plan around it when building.

## What this means for an engineer crossing in

If you join a battery operator, an aggregator, or any company touching FCR-D dispatch, you will learn this market deeply in your first month. The technical requirements are exacting. The revenue is meaningful. The IT work (real-time telemetry, control loops, qualification testing, settlement reconciliation) is real engineering.

This is one of the few corners of the energy industry where building good software is a direct, measurable revenue lever.

## Next

After FCR-D contains the event, aFRR restores the frequency. See [aFRR: the automatic restoration loop]({{ '/energy/concepts/034-afrr/' | relative_url }}).
