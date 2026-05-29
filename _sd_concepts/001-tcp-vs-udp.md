---
concept_id: 1
slug: tcp-vs-udp
title: "TCP vs UDP"
tease: "When each protocol actually fits."
section: "Foundations"
status: live
---

TCP makes the network feel like a phone call: a connection opens, bytes arrive in order, nothing gets lost. UDP makes the network feel like a postcard: you drop a message in the mail and hope. Both run on the same wires. They give you different promises.

## The problem they solve

The internet is unreliable. Packets get lost. They arrive out of order. They get duplicated. Routers drop traffic when they are busy. None of this is rare; it happens millions of times per second on a normal day.

Most applications cannot deal with this directly. You want to write `send("hello")` on one side and read `"hello"` on the other side, in order, exactly once. That is a lot of plumbing.

TCP gives you that plumbing for free. UDP says "no thanks, I will handle it myself."

## The picture in your head

```mermaid
flowchart TB
    subgraph TCP["TCP — connection-oriented, ordered, reliable"]
        direction LR
        TC(["Client"]):::client
        TS[("Server")]:::server
        TC -->|"1 . SYN"| TS
        TS -->|"2 . SYN-ACK"| TC
        TC -->|"3 . ACK"| TS
        TC ==>|"ordered byte stream<br/>auto-retransmits on loss"| TS
    end

    subgraph UDP["UDP — connectionless, unordered, lossy"]
        direction LR
        UC(["Client"]):::client
        US[("Server")]:::server
        UC -.->|"datagram 1"| US
        UC -.->|"datagram 2  (lost)"| US
        UC -.->|"datagram 3"| US
    end

    classDef client fill:#dbeafe,stroke:#1e40af,color:#1e3a8a,stroke-width:1.5px
    classDef server fill:#dcfce7,stroke:#15803d,color:#14532d,stroke-width:1.5px
```

TCP opens a connection with a handshake, then guarantees that whatever you send arrives in order. Lost packets get retransmitted automatically. UDP just throws datagrams over the wall. Some arrive. Some do not. Some arrive in the wrong order. The application gets to deal with it (or not).

## What TCP gives you, and what it costs

**You get:**

- Ordered delivery (byte 1 arrives before byte 2).
- Reliable delivery (the protocol retries lost packets).
- Flow control (the sender slows down if the receiver cannot keep up).
- Congestion control (the sender slows down if the network is busy).

**You pay for it:**

- A handshake before any data can flow (one round trip of latency).
- Head-of-line blocking: if packet 5 is lost, packets 6, 7, 8 sit in a buffer waiting, even if you do not care about packet 5 anymore.
- Slower recovery on lossy networks (mobile, satellite) because TCP assumes loss means congestion and backs off.

## What UDP gives you, and what it costs

**You get:**

- Send and forget. No handshake. No retries. No backoff.
- One round trip less of latency on the first message.
- Independent messages: losing packet 5 does not block packet 6.

**You pay for it:**

- Lost data stays lost unless you handle it yourself.
- Out-of-order arrival is your problem.
- No flow control. You can blow up a slow receiver.
- Firewalls are more suspicious of UDP.

## When to pick each

Pick TCP when **losing data is worse than waiting for it**:

- HTTP, gRPC, WebSocket.
- SSH, database connections.
- Anything where one missing byte makes the rest of the message useless.

Pick UDP when **waiting for data is worse than losing it**, or when **you have your own reliability layer**:

- Live audio and video calls (Zoom, WebRTC). A dropped frame from 80ms ago is just noise; better to skip it than to stall.
- Online games. The player's position 200ms ago is worthless.
- DNS lookups. Tiny message, fast retry, no point opening a connection.
- QUIC (which HTTP/3 sits on top of) uses UDP and builds its own ordering and retries, smarter than TCP.

## Two scenarios

**Scenario one: a chat app.**

User sends "are you free at 7?". This must arrive. It must arrive in one piece. If it arrives 200ms later than the next message, the conversation is confusing. TCP, no debate.

**Scenario two: a live video call.**

A frame from 50ms ago is irrelevant. You want frame 51 to arrive now, not frame 50 to be retransmitted and arrive late. The codec is built to handle small amounts of loss gracefully. UDP, every time. The application layer might add its own selective retransmit, but it would never pay TCP's strict-ordering tax.

## What this connects to

- **HTTP/3 chose UDP.** It runs on QUIC, which is "UDP plus our own faster, smarter version of TCP." See [HTTP/2 and HTTP/3](/practice/system-design/concepts/002-http2-and-http3/).
- **Latency vs throughput.** TCP's handshake costs you one round trip; on a 100ms cross-region link that is a lot. See [Latency, throughput, bandwidth](/practice/system-design/concepts/004-latency-throughput-bandwidth/).

## Common mistakes

- **Using TCP for tiny, frequent, stateless lookups.** DNS is over UDP for a reason: the message is small, retrying is cheap, and a handshake per lookup would melt the internet.
- **Reaching for UDP for "speed" without owning the reliability problem.** You will reinvent TCP, badly. If you are not actively dropping data on purpose, you probably want TCP.
- **Assuming TCP is "always reliable."** TCP guarantees in-order, no-loss delivery between two endpoints while the connection is alive. If the connection drops, your application still has to handle that (and idempotency, see [Idempotency](/practice/system-design/concepts/021-idempotency/)).
- **Forgetting the firewall.** Many corporate and CGNAT networks block or rate-limit UDP. If your client is behind one of those, your fancy UDP-based protocol will not work and you will not know why.

## Quick recap

- TCP: ordered, reliable, slower to start, head-of-line blocked.
- UDP: fast, independent, lossy, application's problem.
- TCP for almost everything you write at work.
- UDP for real-time media, gaming, DNS, and as the substrate for things like QUIC.

This concept sits in **Stage 1 (Foundations)** of the [System Design Roadmap](/practice/system-design/roadmap/).
