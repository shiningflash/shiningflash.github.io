---
concept_id: 9
slug: bidding-zones
title: 'The four Swedish bidding zones'
tease: 'Same country, same hour, different price. Here is why.'
section: 'Foundations'
status: live
---

Sweden is one country. But for the wholesale electricity market, it is four countries. Each region gets its own hourly price. On a normal day the four prices are close. On a tight day, SE4 in Malmö can be five to ten times higher than SE1 in Luleå.

The four zones exist for one reason: the wires between north and south cannot carry all the power that the market would like to ship. Splitting the country into zones is the market's way of telling everyone *the wire is full, please rearrange*.

## The four zones

```mermaid
flowchart TB
    SE1([SE1, Luleå<br/>lots of hydro<br/>small load<br/>usually the cheapest])
    SE2([SE2, Sundsvall<br/>hydro and wind<br/>small load])
    SE3([SE3, Stockholm<br/>nuclear, biggest load<br/>middle of the range])
    SE4([SE4, Malmö<br/>weak local supply<br/>big load<br/>usually the most expensive])

    SE1 -->|power flows south| SE2
    SE2 -->|power flows south| SE3
    SE3 -->|power flows south| SE4

    style SE1 fill:#dcfce7,stroke:#15803d,color:#14532d
    style SE2 fill:#dcfce7,stroke:#15803d,color:#14532d
    style SE3 fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style SE4 fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

A clean way to remember it. **North has the power. South has the people.** Power flows south almost every day.

## When prices match, when they split

The Nord Pool auction tries to give everyone the lowest possible price. It always *wants* the four zones to be at the same price. But if the wire between two zones is full, the auction has to give up and price them separately.

```mermaid
flowchart TB
    A([Auction runs<br/>at 12:00 CET])

    A --> B{Is the wire<br/>between zones full?}

    B -->|No| C([All four prices<br/>are the same])
    B -->|Yes| D([Cheap zone stays cheap<br/>expensive zone stays expensive<br/>wire ships as much as it can])

    style A fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style B fill:#fef3c7,stroke:#a16207,color:#713f12
    style C fill:#dcfce7,stroke:#15803d,color:#14532d
    style D fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

So when you see big price differences between SE1 and SE4 on the news, it almost always means the same thing: the 400 kV north-south backbone is at its limit.

## Why this matters in practice

A few real consequences you will see often.

**SE4 prices follow continental Europe.** When the wires south to Germany and Denmark are not full, SE4 couples to the German price, which is mostly set by gas. So a cold day in Berlin can spike the bill in Malmö.

**SE1 prices stay low when the lines are full.** A wind storm in northern Sweden can drive SE1 close to zero (or negative) while SE3 and SE4 stay high. The wind power cannot leave.

**Building things in SE3 or SE4 is harder.** New data centres, new factories, and new electrified industry want to connect where the demand is, which is also where prices are high and the grid is most constrained. This is the single biggest political fight in Swedish energy today.

## Next

When the auction has to pick a price, it stacks bids cheap to expensive. The last bid accepted sets the price. See [Merit order]({{ '/energy/concepts/010-merit-order/' | relative_url }}).
