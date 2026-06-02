---
concept_id: 6
slug: path-from-generator-to-socket
title: 'From generator to your socket'
tease: 'The full journey of one kWh, and why the bill has two halves.'
section: 'Foundations'
status: live
---

A kWh used in Malmö may have been made one second ago at a hydro plant 1,500 km away in Norrland. The trip goes through several voltage levels and three different operators. We are going to walk the trip, then explain why your bill always has two parts.

## The journey, grouped into three stages

```mermaid
flowchart TB
    subgraph S1["Stage 1, make it"]
        A([River, reactor, wind, sun])
        B([Generator<br/>around 20 kV])
        A --> B
    end

    subgraph S2["Stage 2, ship it long distance"]
        C([Step up<br/>20 kV to 400 kV])
        D([400 kV line<br/>hundreds of km])
        E([Step down<br/>400 kV to 130 kV])
        C --> D --> E
    end

    subgraph S3["Stage 3, deliver it locally"]
        F([Local lines<br/>20 kV, then 400 V])
        G([Your meter<br/>230 V or 400 V])
        H([Coffee maker])
        F --> G --> H
    end

    S1 --> S2 --> S3

    style A fill:#dcfce7,stroke:#15803d,color:#14532d
    style B fill:#dcfce7,stroke:#15803d,color:#14532d
    style C fill:#fef3c7,stroke:#a16207,color:#713f12
    style D fill:#fef3c7,stroke:#a16207,color:#713f12
    style E fill:#fef3c7,stroke:#a16207,color:#713f12
    style F fill:#fef3c7,stroke:#a16207,color:#713f12
    style G fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    style H fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

Why three stages? Because each stage is run by a different kind of company.

| Stage | Who runs it | Voltage |
| --- | --- | --- |
| Make it | Producer (Vattenfall, Fortum, OX2, Statkraft, ...) | up to ~20 kV |
| Ship it | **TSO**, Svenska kraftnät | 400 kV and 220 kV |
| Deliver it locally | **DSO** (Vattenfall Eldistribution, Ellevio, E.ON, ...) | 130 kV down to 400 V |

One TSO for the whole country. Around 170 DSOs across Sweden. You cannot pick your DSO. It is set by where you live.

## Three operators, three different jobs

Most newcomer confusion in Sweden comes from mixing up these roles.

```mermaid
flowchart TB
    P([Producer<br/>makes the power<br/>Vattenfall, Fortum, OX2, ...])
    T([TSO, Svenska kraftnät<br/>runs the 400 kV grid<br/>keeps the system balanced])
    D([DSO<br/>runs the local wires<br/>delivers power to your meter])
    R([Retailer, elhandelsföretag<br/>sells you a contract<br/>owns no wires, no plants<br/>Tibber, Bixia, Greenely, ...])

    P --> T
    T --> D
    D --> Y([You])
    R -.->|contract| Y

    style P fill:#dcfce7,stroke:#15803d,color:#14532d
    style T fill:#fef3c7,stroke:#a16207,color:#713f12
    style D fill:#fef3c7,stroke:#a16207,color:#713f12
    style R fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    style Y fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
```

Same parent brand can wear different hats. *Vattenfall* shows up as a producer (operates Forsmark), a DSO (Vattenfall Eldistribution), and a retailer (Vattenfall Sälj). Swedish law keeps these as **legally separate** companies under the same parent, so the wire business cannot favour the contract business.

## Why your bill has two halves

The same kWh is billed twice, once by the retailer and once by the DSO.

```mermaid
flowchart TB
    K([One kWh used at your house])

    K --> N([Network half, nätavgift<br/>paid to the DSO<br/>same whoever your retailer is])
    K --> E([Energy half, spot × kWh + påslag<br/>paid to your retailer<br/>changes if you switch retailer])

    style K fill:#dcfce7,stroke:#15803d,color:#14532d
    style N fill:#fef3c7,stroke:#a16207,color:#713f12
    style E fill:#fed7aa,stroke:#c2410c,color:#7c2d12
```

The state then adds **energiskatt** and 25 percent **moms** on top.

Three simple rules for everyday life.

- Power outage? Call the **DSO**. They own the wire.
- Bill looks wrong? Call the **retailer**. They sold you the contract.
- Want to switch supplier? Switch the **retailer**. The DSO stays the same.

## One kWh, traced

Walk through one kWh used in a Lund apartment on a Wednesday evening.

1. Made by a Vattenfall hydro plant in Jämtland.
2. Sent south on Svenska kraftnät's 400 kV grid through SE2, SE3, then into SE4.
3. Stepped down through an E.ON regional substation, 130 kV down to 20 kV.
4. Travelled the last few hundred metres on E.ON's local 400 V wire.
5. Past the meter, into the lamp.
6. Billed by **Tibber** for the spot price plus their **påslag**.
7. Billed by **E.ON Distribution** (a separate legal company) for the **nätavgift**.
8. **Energiskatt** and **moms** added.

One kWh. Five companies. Two bills.

## Next

The path uses 400 kV in the middle and 230 V at home. Time to see why. See [Why we ship power at high voltage]({{ '/energy/concepts/007-ac-three-phase-high-voltage/' | relative_url }}).
