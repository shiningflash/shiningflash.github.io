---
title: "What Non-Technical Teams Taught Me About Being a Better Data Engineer"
date: 2026-01-12 13:47 +0600
categories: [English, Programming, Experience]
tags: [experience, backend-development, tech-talk, career-growth]
author: amirulislam
---

In my first years as a **data engineer**, I thought my job was simple: move data from A to B, clean it, and make sure nothing breaks.

If the pipeline ran and dashboards loaded, I went home relaxed.

Then real work started.

---

### When "Correct" Isn't Enough

We were building a system that pulled data from hundreds of devices—different vendors, different formats, different network qualities. Some devices sent data every second, some every minute, some skipped hours and then dumped everything at once.

One day, the operations team told me:

> "Yesterday we clearly produced more energy than what the dashboard shows."

Not an angry message. Just confusion.

I looked at the pipeline. No failures. No missing files. Everything looked **correct**.

The problem was logic. We were deduplicating by timestamp and device ID. But some devices, after losing network, resent old data with slightly changed timestamps. My logic accepted them as new. Other times it dropped real data because timestamps collided.

Technically reasonable. In reality, misleading.

That day I realized something: **data is messy because life is messy**. And pipelines don't see it that way—people do.

---

### Speed vs. Accuracy: A Lesson from Business

Another time, the business team told me:

> "We make decisions in the morning. If your data arrives late, we guess."

I told them: "But we wait for late data to be accurate."

They said: **"We don't need perfect. We need usable."**

So we changed the design. We published early numbers fast, even if they were incomplete, and final numbers later. Same data, two stages, two purposes.

That changed how people worked.

---

### The Finance Team's Frustration

Then finance came with a different kind of frustration.

> "Every time we export a report, the numbers change two days later. We lose credibility."

From my side, that was normal—late data, corrections, reprocessing.

From their side, it felt like chaos.

So we started **labeling data clearly**: this is early, this is settling, this is final. We explained what moves and what doesn't.

After that, nobody complained about changing numbers. They knew what to expect.

---

### The Real Lesson

Non-technical teams never taught me SQL or Kafka. They taught me that **data is not about correctness alone. It is about trust.**

A system can be technically perfect and still be useless. A number can be mathematically right and still be wrong for the moment.

Being a better data engineer didn't come from learning more tools. It came from understanding how my work touches real people making real decisions.

What's your experience working across technical and non-technical teams? I'd love to hear your story—feel free to email me at **amirulislamalmamun@gmail.com**. Let's connect and grow together! 🚀
