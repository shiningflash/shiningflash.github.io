---
concept_id: 23
slug: hydro-marginal
title: 'Why hydro usually sets the Nordic price'
tease: 'Water is free. So why is the hydro bid not zero? Because the operator is a scheduler, not a producer.'
section: 'Wholesale day-ahead'
status: live
---

In continental Europe, the marginal unit (the one that sets the price most hours) is gas. The gas plant bids a price tied to the cost of gas plus the cost of carbon allowances. When gas spikes, prices spike. Simple cause and effect.

In the Nordics, things work differently. The marginal unit is usually **reservoir hydro**. And hydro has no fuel cost. So what is the hydro operator bidding?

This is the most useful idea to take away from the Nordic market: a hydro operator is a **scheduler**, not a producer. The bid is the *opportunity cost* of water.

## What opportunity cost means here

A reservoir holds a finite amount of water. Once the operator uses one MWh of water today, that MWh is gone. They cannot get it back. So every time they decide to release water, they are saying: *the price today is better than the price I expect to get next week*.

That comparison is the bid.

```mermaid
flowchart TB
    A([Reservoir level today])

    A --> B{Today's price<br/>vs expected future price}

    B -->|today is higher| C([Release water<br/>generate now])
    B -->|future is higher| D([Hold water<br/>generate later])

    style A fill:#dcfce7,stroke:#15803d,color:#14532d
    style B fill:#fef3c7,stroke:#a16207,color:#713f12
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style D fill:#dcfce7,stroke:#15803d,color:#14532d
```

So the hydro bid is not zero. It is the future value of the water, discounted. Operators use complex models to estimate this number every day. The result is the bid that goes into Nord Pool.

## Why this makes the Nordic price special

Most hours, the marginal unit in SE3 is somewhere between nuclear (very cheap) and gas (very expensive). It is reservoir hydro. The operator's *opportunity cost* sets the price for everyone above it in the merit stack.

This is why the Nordic price moves with **reservoir levels and weather forecasts**, not with the gas price (most of the time).

```mermaid
flowchart TB
    A([Reservoirs full<br/>melt water coming<br/>spring conditions])
    B([Hydro operators<br/>willing to release at low prices<br/>opportunity cost is low])
    C([Nordic prices drop])

    A --> B --> C

    style A fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style B fill:#dcfce7,stroke:#15803d,color:#14532d
    style C fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

```mermaid
flowchart TB
    D([Reservoirs low<br/>dry summer<br/>cold winter coming])
    E([Hydro operators<br/>save water<br/>opportunity cost is high])
    F([Nordic prices rise])

    D --> E --> F

    style D fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
    style E fill:#fef3c7,stroke:#a16207,color:#713f12
    style F fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

If you follow Swedish energy news for one season, you will see this play out: the Norwegian and Swedish hydrology report becomes the most-cited document of the month.

## When hydro is *not* the marginal unit

Three situations switch the marginal unit away from hydro.

**Borders not full, continental coupling active.** The cables to Germany have spare capacity. The SE3 price couples to the German price, set by gas. Hydro becomes inframarginal: it still runs, it just gets paid the gas price instead of the water price.

**Very high demand, hydro tapped out.** A cold winter morning. All available hydro is already running. The marginal unit moves up the stack to imports, peaking hydro at higher reservoirs, or peakers. Price spikes follow.

**Very high supply, hydro spilling.** A windy summer afternoon. So much wind production that hydro operators stop holding back. Bids drop near zero. Sometimes negative.

So hydro sets the price *most* hours, but not *every* hour. The exceptions are exactly the most interesting hours.

## What this means for everyone else

A few real consequences.

**Wind and solar in Sweden get paid the hydro price most of the time.** Their bids are near zero, but they receive the marginal-unit price, which is the hydro operator's opportunity cost. This is much better than near-zero.

**A wet year drops everyone's revenue.** Hydro bids low, marginal price falls, every generator in the stack gets paid less. A wet summer is bad news for any merchant project, not just hydro.

**The biggest power players are the hydro schedulers.** Vattenfall, Fortum, and Statkraft together control most of the Nordic reservoir hydro. Their daily scheduling decisions are the single biggest input into Nordic prices.

## Next

Cross-border flows reshape the merit order every hour. See [How cross-zonal capacity is allocated]({{ '/energy/concepts/024-cross-zonal-capacity/' | relative_url }}).
