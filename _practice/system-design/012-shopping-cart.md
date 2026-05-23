---
layout: practice-problem
track: system-design
problem_id: 12
title: Design a Shopping Cart Service
slug: 012-shopping-cart
category: Session State
difficulty: Easy
topics: [session, persistence, idempotency, inventory check, abandoned cart]
source_url: "https://github.com/shiningflash/system-design/tree/main/problems/012-shopping-cart"
solution_lang: markdown
---

{% raw %}
## Scene

The interviewer slides their laptop towards you.

> *"We are building a small e-commerce site. Shoes, mostly. About 500 customers a day right now. We want a shopping cart. The kind that lets you add things, change quantities, leave for two hours, come back, and still have your cart. Design that. We expect to grow."*

They lean back. "Easy one. Or it should be."

This is the trap. The shopping cart looks like a CRUD problem with three endpoints and a database table. It is not. The real questions hide under the floorboards: where does the cart actually live (the cookie, the server, both), what happens when a guest user logs in and already has a cart in their account, what does "in stock" even mean when the cart is updated five minutes before checkout and inventory changes by the second, and how do you keep all of this fast for a million users without melting your database.

We are going to walk this from a 500-customer startup to a 1M-active-user marketplace. At each stage something cracks. Naming what cracks is half the exercise.

## Step 1: clarify before you design

Take 5 minutes. Do not start drawing. What would you ask the interviewer? Aim for 8 questions that meaningfully change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Guest vs logged-in.** "Do anonymous users have carts, or do we force login first?" Almost every real site allows guest carts. This single answer determines whether you have one cart model or two, and whether merging carts at login is part of the design.
2. **Cart persistence horizon.** "If I add an item and close the tab, how long does my cart live? An hour? A day? Forever?" Drives whether the cart lives in memory, in a cookie, or in durable storage. Forever-carts (Amazon-style) need a database. Session-only carts can live in Redis with a TTL.
3. **Multi-device sync.** "If I add a shoe on my phone, do I see it on my laptop when I log in?" This forces server-side state for logged-in users. Without it, you can get away with cookie-only carts.
4. **Inventory accuracy.** "When the cart says 'in stock', does that mean reserved for me, or just visible to me, or last-known-stock-from-five-minutes-ago?" Three very different answers, each with very different complexity. Reservation needs a TTL hold; optimistic is simpler but causes occasional checkout failures; eventual is the cheapest and most painful for users.
5. **Cart size limits.** "Is there a max items per cart? Max quantity per item?" Without limits, scrapers and bots stuff carts with 50,000 items and break your DB. 100 distinct items, 99 units per item, is a typical bound.
6. **Price drift.** "Item was $50 when added, store changed it to $55 by checkout. Whose price wins?" Almost always the current price wins, with a UI banner. But you need to capture the snapshot for fraud detection and customer disputes.
7. **Promotions.** "Are coupons and discounts applied at cart-time or checkout-time? Are they part of this service or a separate one?" Coupons are usually a separate service. The cart holds the coupon code, the pricing engine evaluates it.
8. **Checkout boundary.** "Is checkout part of this design or downstream? Where does the cart end and the order begin?" The cart usually ends when the user clicks 'Place Order'. After that, an order record is created and the cart is cleared (or marked converted).

Bonus questions a senior asks:

- **Abandoned cart recovery.** "Do we send 'you left this in your cart' emails? After how long?" Drives the need for an analytics path on cart state.
- **B2B / large carts.** "Any customers with carts of 500+ SKUs?" If yes, your storage decision changes significantly.

If you walked into the interview asking only "how many users" you would miss the merge logic, the inventory question, and the price drift question. Those three are where the design actually lives.

</details>

## Step 2: capacity estimates

Two scales. The interviewer gives you the small numbers; you derive the big ones from the growth target.

**Small startup (today):**

- 500 daily active users
- 30% of visits add at least one item to cart
- Average cart: 3 items, edited 2 times before checkout
- 60% of carts are abandoned (industry standard)

**One million active users (target):**

- 1M daily active users
- Same conversion behavior
- Peak hour: 3x sustained
- Cart can persist up to 30 days for logged-in users

Compute (do this on paper before revealing):

1. Cart writes per second at both scales
2. Cart reads per second at both scales (every page load with cart-icon shows count)
3. Active carts at any moment
4. Storage for cart data at the 1M scale
5. Inventory check QPS at peak

<details>
<summary><b>Reveal: the math</b></summary>

**Small startup:**

- Carts created: 500 × 30% = 150 carts/day. About 6/hour.
- Edits: 150 × 2 = 300 cart writes/day. ~0.003 writes/sec. *Negligible.*
- Reads: every page load shows cart count. Average 10 pages/visit × 500 = 5000 reads/day. ~0.06 reads/sec.
- Active carts at any time: ~50 (most are inactive for hours).
- Storage: 150 carts/day × 3 items × ~200 bytes = 90KB/day. After a year, ~33MB.

You could build this with one Postgres table, one app server, and walk away. A laptop running locally would handle the load.

**One million users:**

- Carts created: 1M × 30% = 300k/day. Sustained ~3.5/sec. Peak ~10/sec.
- Edits per cart: 2. So 600k cart writes/day. Sustained ~7/sec. Peak ~21/sec.
- Reads: 10M page loads/day × cart-count-on-every-page = 10M reads/day. Sustained ~115/sec. Peak ~350/sec.
- Active carts at any moment: 1M × 30% × (avg 2 hour active window / 24 hour day) ≈ 25k active carts at any moment.
- Storage at 30-day retention: 300k × 30 × 3 items × 200 bytes = ~5.5GB of cart_items. Plus carts header: 300k × 30 × ~150 bytes = ~1.3GB. Total ~7GB live. Easy.
- Inventory check QPS: every cart add and every cart-page-load re-checks stock. ~7/sec for add, ~350/sec for read. Peak inventory check load: ~400/sec.

**Key insights from the math:**

- Even at 1M users, write QPS is *tiny* (~20/sec peak). The cart is a low-write system.
- Reads dominate by 20x. Caching the read path is the whole game.
- Active carts at any moment (25k) is the metric that matters for memory sizing of a cache layer.
- The big cost is not the cart store. It is the *inventory check* fan-out to a downstream inventory service, which probably handles dozens of other read patterns. The cart becomes a noisy neighbor on inventory.
- Storage is trivial. 7GB fits on any modern Postgres. The system is small.

The architecture exists not for throughput but for **correctness around merges, inventory consistency, and price drift**.

</details>

## Step 3: where does the cart live?

This is the single most-debated design decision in cart systems. Four candidates: in-browser cookie only, in-memory server session, durable database, and the hybrid Redis+DB pattern. Each has a real trade-off.

Sketch a comparison table. For each storage option, name: who can see it, what happens on device change, what happens on server restart, what happens at high scale, and what it costs.

<details>
<summary><b>Reveal: comparison and recommended choice</b></summary>

| Storage | How it works | Pros | Cons | When to use |
|---------|--------------|------|------|-------------|
| **Cookie only** | Cart serialized into a cookie (JSON or signed token), sent on every request | Zero server state. Survives server restart. Works for anonymous users. | Limited to ~4KB cookie size (~30 items max). No cross-device sync. Cart visible to the user (so signing required to prevent tampering). Lost if browser cookies cleared. | Truly small sites, prototype only. |
| **In-memory server session** | Cart in app server memory keyed by session ID | Fastest possible reads. No external dependency. | Lost on server restart. Sticky sessions required. Does not scale past one server. | Never in production. Mentioned to be dismissed. |
| **Database (Postgres)** | Cart rows in a `carts` and `cart_items` table | Durable. Queryable for analytics ("abandoned carts > 24h"). ACID transactions. Survives anything. | One DB read per cart-icon load. At 350 reads/sec, the DB notices. Not as fast as memory. | Default choice for small-to-medium sites and as the source of truth for any scale. |
| **Redis cache + DB write-through** | Active cart in Redis hash per user. DB holds source-of-truth. Read from Redis, write to both. | Sub-ms cart reads. Scales reads horizontally. DB still has the durable record for analytics and recovery. | Two systems to keep in sync. Cache invalidation logic. More moving parts. | The right answer at 100k+ DAU or whenever DB reads start being noticeable. |

**The recommendation:**

- Anonymous users: cart stored server-side keyed by an anonymous cart token (UUID in a `cart_token` cookie). Not just in the cookie itself, because we want multi-device potential and bigger carts.
- Logged-in users: cart stored server-side keyed by user ID.
- Backend storage: start with Postgres only. Add Redis as a read-through cache when DB read load becomes noticeable (in practice, ~10k DAU and up).

**Why not cookie-only:**

Cookies are limited to ~4KB. They are sent on every request, so a fat cookie slows every page. They are visible to the user (which is fine, but means you must sign them to prevent tampering). They do not sync across devices. They get wiped when users clear cookies. The only thing they are good for is the anonymous cart *token* (a 36-byte UUID pointing at a server-side record).

**Why not in-memory session:**

This is the answer a junior engineer gives because it is fast and easy in local dev. It dies the moment you have two app servers and a load balancer. Mention it once, then move on.

</details>

## Step 4: incomplete architecture diagram

Here is an intentionally incomplete diagram. Fill in the five `[ ? ]` placeholders. Think about: who sits at the edge, where the cart actually lives, what speeds up reads, what the cart depends on, and what consumes its events.

```
                  Client (web, mobile)
                          │
                          ▼
                  ┌─────────────────┐
                  │    [ ? ]        │  (sits at edge, terminates TLS, auth)
                  └────────┬────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │  Cart Service   │  (stateless, horizontally scalable)
                  └──┬──────┬──┬────┘
                     │      │  │
              read   │      │  │ writes events
                     │      │  │
                     ▼      │  │
              ┌──────────┐  │  │
              │  [ ? ]   │  │  │  (fast read cache for active carts)
              └─────┬────┘  │  │
                    │       │  │
                    ▼       ▼  │
              ┌────────────────┐│
              │   [ ? ]        ││  (source of truth for cart data)
              └────────────────┘│
                                │
                                ▼
                         ┌────────────┐
                         │  [ ? ]     │  (event stream for downstream)
                         └────────────┘

           Sync calls out:
                  ┌────────────┐
                  │  [ ? ]     │  (tells the cart whether items are still in stock)
                  └────────────┘
```

<details>
<summary><b>Reveal: complete architecture</b></summary>

```
                  Client (web, mobile)
                          │
                          ▼
                  ┌──────────────────┐
                  │  API Gateway     │  (TLS, auth, rate limit,
                  │  + Auth          │   anonymous cart_token cookie
                  │                  │   handling)
                  └────────┬─────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  Cart Service    │  (stateless, horizontally
                  │                  │   scalable; merge logic;
                  │                  │   price snapshot; size limits)
                  └──┬──────┬──┬─────┘
                     │      │  │
              read   │      │  │ writes events
                     │      │  │
                     ▼      │  │
              ┌──────────┐  │  │
              │  Redis   │  │  │  (cart per user: hash of items;
              │  (active │  │  │   TTL 30 days; primary read path)
              │  carts)  │  │  │
              └─────┬────┘  │  │
                    │       │  │
                    │write- │  │
                    │through│  │
                    ▼       ▼  │
              ┌────────────────┐│
              │  Postgres      ││  (source of truth: carts,
              │  (carts,       ││   cart_items, carts_merged
              │   cart_items)  ││   audit table)
              └────────────────┘│
                                │
                                ▼
                         ┌──────────────┐
                         │  Kafka       │  cart.item.added
                         │  cart.*      │  cart.item.removed
                         │              │  cart.merged
                         │              │  cart.abandoned
                         └──────┬───────┘
                                │
                  Consumers: abandoned-cart-notifier,
                             analytics, recommendation engine,
                             fraud detection

           Sync calls out:
                  ┌─────────────────┐
                  │ Inventory       │  (returns availability per SKU;
                  │ Service         │   cart calls on add and on read;
                  │                 │   own DB, own cache, own scaling)
                  └─────────────────┘
                  ┌─────────────────┐
                  │ Catalog /       │  (returns name, image, price;
                  │ Pricing Service │   cart joins this for display)
                  └─────────────────┘
```

Why each piece is here:

- **API Gateway + Auth.** First because the cart is exposed to the web. Handles TLS, rate limits abusive clients, and resolves the user (either authenticated user_id or anonymous cart_token from cookie).
- **Cart Service.** Stateless, scales horizontally. Holds the merge logic, size limits, and orchestrates inventory/pricing calls.
- **Redis (active carts).** The active read tier. Stored as a hash per user: `cart:{user_id}` → `{sku_a: 2, sku_b: 1}`. Sub-millisecond reads. TTL is the cart retention period.
- **Postgres (source of truth).** Durable. Used on Redis miss, for analytics queries (abandoned carts), and recovery if Redis dies.
- **Kafka.** The cart emits events but does not block on them. Downstream consumers handle abandoned-cart emails, analytics, recommendation training, and fraud signals.
- **Inventory Service.** Separately owned. The cart asks "is SKU X available in qty Y?" Cart never writes to inventory directly (that happens at checkout, in a different service). Inventory check is the bottleneck once you hit scale.
- **Catalog / Pricing Service.** Returns display data (name, image) and current price. The cart stores SKU + quantity + the snapshot price at add-time, and resolves the current price on read.

</details>

## Step 5: anonymous to logged-in cart merge

This is the trickiest part of cart design and the one most candidates flunk.

A guest user adds 3 items to their cart over 20 minutes. They then click "Log in" and authenticate. The system discovers this user *already has* a cart in their account from a session two days ago: 2 different items. What does the merged cart contain? What if there is overlap (same SKU in both carts at different quantities)?

Sketch the merge logic. Consider these cases:

- Anonymous cart has SKU A (qty 1), SKU B (qty 2). Account cart is empty.
- Anonymous cart has SKU A (qty 1). Account cart has SKU C (qty 1).
- Anonymous cart has SKU A (qty 2). Account cart has SKU A (qty 1). What is the final quantity?
- Anonymous cart has SKU A. Account cart has SKU A but A is now discontinued.
- Anonymous cart is empty. Account cart has SKU C. What shows up after login?

What do you do with the anonymous cart's `cart_token` after the merge?

<details>
<summary><b>Reveal: merge rules and the algorithm</b></summary>

**The merge policy (take a stance, defend it):**

For overlapping SKUs, the right default is **max(anonymous_qty, account_qty)**, not sum.

Why max and not sum: if a user added 2 of SKU A on their phone (anonymous), and they remembered they already had 1 in their account cart from yesterday, they almost certainly wanted "make sure I have 2", not "I want 3". Summing surprises users; max is conservative. The exception: items that are explicitly "additive" (digital downloads, gift cards) sum, but those are special-cased per category.

Some teams choose "anonymous wins" (overwrite account cart with the just-built session). Defensible: the user's last intent is most recent. Easier to explain. But you lose the older session's items if it had things the user still wanted.

Whichever you pick, write it down somewhere user-visible: "We combined your guest cart with your saved cart." Surface what changed.

**The full algorithm:**

```python
def merge_carts(anonymous_token, user_id):
    """Called on successful login when an anonymous cart_token cookie is present."""
    with db.transaction():
        anon_cart = cart_store.get_by_token(anonymous_token)
        user_cart = cart_store.get_by_user(user_id)

        if anon_cart is None:
            return user_cart                    # nothing to merge

        if user_cart is None:
            # Just rebind the anonymous cart to the user
            cart_store.rebind(anon_cart.id, user_id=user_id, clear_token=True)
            audit_merge(user_id, anon_cart.id, source="rebind")
            return cart_store.get_by_user(user_id)

        # Both exist. Merge.
        merged_items = {}
        for sku, item in user_cart.items.items():
            merged_items[sku] = item.copy()

        for sku, anon_item in anon_cart.items.items():
            if not catalog.is_available(sku):
                continue                        # skip discontinued items
            if sku in merged_items:
                merged_items[sku].qty = max(anon_item.qty, merged_items[sku].qty)
                merged_items[sku].qty = min(merged_items[sku].qty, MAX_QTY_PER_ITEM)
            else:
                merged_items[sku] = anon_item

        # Enforce cart size limit (100 distinct items)
        if len(merged_items) > MAX_CART_ITEMS:
            merged_items = trim_to_limit(merged_items, MAX_CART_ITEMS)

        cart_store.replace(user_cart.id, merged_items)
        cart_store.delete(anon_cart.id)         # anonymous cart consumed
        audit_merge(user_id, anon_cart.id, source="merge",
                    rules={"qty": "max", "trimmed": ...})

        return cart_store.get_by_user(user_id)
```

**Key implementation details:**

1. **Idempotency.** A user might double-click "Log in". The merge endpoint must be idempotent: if the anonymous cart has already been consumed (deleted), the second call is a no-op. Achieve this by checking `anon_cart is None` early; the cart_token is cleared from the cookie after first merge.

2. **Audit trail.** Insert a row into `carts_merged` capturing `(merge_id, user_id, anonymous_token, anonymous_items, account_items, merged_items, rule_applied, occurred_at)`. This rescues you from "my cart is wrong after I logged in" support tickets.

3. **Cookie cleanup.** After merge, clear the `cart_token` cookie (`Set-Cookie: cart_token=; Max-Age=0`). Otherwise the next page load may attempt to merge again (and find nothing, but generate a log line).

4. **Discontinued items.** Skip them silently in the merge, but surface a banner: "Some items in your guest cart are no longer available."

5. **Size limit.** A user with 80 items in their account cart and 80 in their guest cart can blow the 100-item limit. Trim with a deterministic rule (favor most-recently-added) and tell them.

6. **Race condition.** User logs in on two devices nearly simultaneously. Both call merge. Solve with a unique `cart_token` value: the first merge consumes the token (delete row), the second merge finds nothing to merge.

**Common mistake:** doing the merge client-side. The client cannot be trusted; it does not see the account cart history; it cannot enforce limits. The merge must be a single server-side operation in one transaction.

</details>

## Step 6: inventory consistency

The cart shows "in stock" when the user adds an item. Twenty minutes later, they click checkout. The item is gone. Or worse: the user successfully checks out, takes payment, and then your warehouse tells you there is no shoe to ship.

There are three approaches. None of them is perfect.

**A. No reservation (optimistic).** The cart shows the last-known inventory state. Checkout re-checks. If gone, surface "this item is no longer available" and require the user to adjust their cart.

**B. Soft reservation with TTL.** Adding to cart places a temporary hold on the inventory (15 minutes). If the user does not check out, the hold expires and the inventory is released. If they do check out, the hold is converted to a permanent commitment.

**C. No checks at all (overselling accepted).** Take the order. Charge the card. If the warehouse cannot fulfill, refund and apologize.

For each approach, walk through:
- What does the user experience look like in the common case?
- What goes wrong in the rare case?
- What does this cost engineering-wise?
- For what kind of business is each appropriate?

<details>
<summary><b>Reveal: the comparison and recommended approach</b></summary>

| Approach | Common case | Rare case | Engineering cost | Right for |
|----------|-------------|-----------|------------------|-----------|
| **Optimistic (re-check at checkout)** | Cart shows available; checkout succeeds. | Cart says available but item ran out between add and checkout. User sees "no longer available", has to remove and retry. ~1-3% of checkouts in normal commerce; higher on hot drops. | Low. No write to inventory at cart time. Just a read. | Most general-purpose e-commerce. Default choice. |
| **Soft reservation (TTL hold)** | Add to cart, item is reserved for 15 minutes. Checkout converts hold to commit. User never sees "out of stock" mid-checkout. | If user abandons, hold expires and other users see the item again. Inventory shows artificially low during the hold window. Hot products get worse: many holds, real users locked out. | High. Inventory service must support holds with TTLs. State synchronization. Holds must be released on cart deletion, cart-item removal, hold expiry, and checkout failure. | Live-event ticketing, limited drops (sneaker drops, concert tickets), B2B carts where checkout is a multi-step approval. |
| **No checks (oversell, refund later)** | Always succeeds at checkout. Warehouse fulfills or does not. | Customer gets an "out of stock, refund issued" email the next day. Brand damage, support cost, possibly chargebacks. | Almost zero from the cart's perspective. | Pre-orders. Print-on-demand. Anything with effectively infinite supply. |

**The recommendation: optimistic with TTL holds only for explicitly-marked SKUs.**

The default is optimistic. The cart reads inventory at add-time (shows green check) and again at cart-page-load (refreshes the badge: "in stock", "only 2 left", "out of stock"). At checkout, the order service does the authoritative re-check and atomic deduction.

For high-contention SKUs (limited drops, event tickets), the catalog marks the SKU as `requires_reservation=true`. The cart calls the inventory service to place a TTL hold; the hold token is stored in the cart_item row. If the user removes the item or the hold expires, the cart releases the hold. This adds engineering cost only where it earns its keep.

**Why not soft-reservation by default:**

Every cart abandonment becomes an artificial inventory shortage. Industry average is 60-70% abandonment. If every add-to-cart held inventory for 15 minutes, you would show "out of stock" to many real buyers while ghost carts sit on the inventory. This is the right behavior for a Taylor Swift concert (limited supply, high intent) and wrong for shoes (deep supply, casual browsing).

**Why not overselling by default:**

Refunds and "we cannot fulfill your order" emails destroy customer trust quickly. Only acceptable when supply is genuinely unlimited (digital goods, print-on-demand) or when over-commitments are expected as a business model (airline overselling with bumping policies).

**Where the check actually happens:**

- **On add-to-cart:** read-only check against the Inventory Service. Display state to user. No writes.
- **On cart load:** re-check (cached briefly, ~30s). User sees current state.
- **On checkout:** authoritative. The order service places an atomic `try_reserve(sku, qty)` against inventory. This is a *write*. If it fails, the order does not complete; user sees the failure.

The atomic reserve at checkout is the only consistency guarantee. Everything before it is best-effort display.

**Common mistake:** trying to make the cart "guarantee" the user gets the item. That guarantee belongs at checkout, not at the cart. The cart's job is to show good information; the order service's job is to commit.

</details>

## Follow-up questions

Try answering each in 2-3 sentences before reading the solution.

1. **Cart bloat from bots.** A scraper adds 10,000 items to a single anonymous cart to stress-test your endpoints. What goes wrong, and how do you prevent it?

2. **Multi-device sync delay.** User adds an item on their phone. Opens laptop 5 seconds later. Cart shows the old state. How long is acceptable? What is the mechanism?

3. **Redis dies mid-cart.** All active carts in Redis are lost. What does the user see? How do you recover without anyone noticing (much)?

4. **Price drift.** User added a shoe at $50 last week. Today it is $55. They click checkout. What price do they pay? What do they see?

5. **Cart abandonment detection.** You want to send "you left this in your cart" emails after 6 hours of inactivity. How do you detect this efficiently without scanning all carts every minute?

6. **Anonymous cart TTL.** Anonymous carts pile up forever. How and when do you garbage collect? What if a user comes back after 90 days with their old cart_token cookie still set?

7. **Cart shared with a partner.** Two people log into the same shared account from different cities at the same time. Both add items. How does the cart behave?

8. **Currency and locale.** User adds an item priced in USD. Switches their site language to EUR. What happens to the cart?

9. **Item becomes restricted.** User adds an item legal in their state. Later the item is restricted from shipping there (regulation change). They go to check out. What does your system do?

10. **Save for later.** User wants to "move to wishlist" from cart. Is this part of the cart service? Where does the wishlist live?

## Related problems

- **[Approval Management (011)](../011-approval-management/question.md)**. Different domain, same patterns: state per user, event stream on changes, audit trail of modifications. The cart's `carts_merged` audit table follows the same logic as approval's `audit_log`.
- **[Coupon Redemption (014)](../014-coupon-redemption/question.md)**. The cart holds the coupon code; the coupon service validates and applies discounts. The integration boundary is similar to inventory.
- **[Read-Heavy System Patterns (017)](../017-read-heavy-patterns/question.md)**. The cart-icon read on every page load is the read-heavy edge of this design. The Redis + DB tiering pattern there applies directly.
- **[Write-Heavy System Patterns (018)](../018-write-heavy-patterns/question.md)**. At scale, the cart-event Kafka topic and the abandoned-cart analytics consumer become a write-heavy stream. The patterns from that problem describe how to keep them durable.
- **[Help Desk Ticketing (019)](../019-helpdesk-ticketing/question.md)**. "My cart is wrong" support tickets are common; the `carts_merged` audit table is what helps the agent resolve them.
{% endraw %}

<div class="pr-solution-divider"></div>

{% raw %}
## Solution: Shopping Cart Service

### TL;DR

A shopping cart is a per-user state store with three things that make it interesting: where the state actually lives (cookie vs server vs both), what happens when a guest cart meets a logged-in cart at login time, and how you display "in stock" honestly when inventory changes by the second.

The right design starts as one Postgres table behind a stateless service, adds a Redis read cache once dashboard reads become noticeable, and emits events to Kafka for downstream consumers (abandoned-cart emails, analytics, recommendations). Cart writes are tiny in QPS terms even at a million users; the interesting load is the cart-icon read on every page view, and the inventory-check fan-out for every cart load.

The interesting engineering is at the edges: merging anonymous carts into account carts atomically with sensible quantity rules, choosing between optimistic and reservation-based inventory consistency, handling price drift gracefully between add-time and checkout-time, and garbage-collecting the millions of abandoned cart rows that accumulate without anyone caring about most of them.

### 1. Clarifying questions recap

Already covered in `question.md`. The eight questions you must ask: guest vs logged-in, persistence horizon, multi-device sync, inventory accuracy, cart size limits, price drift, promotions, checkout boundary. Of these, **inventory accuracy** and **multi-device sync** are the two that most change the design. Skip either and your design will get challenged in the first follow-up.

### 2. Capacity estimates (full working)

**Small startup (500 DAU):**

- 500 × 30% conversion = 150 carts created/day. 6/hour. Sustained ~0.002 writes/sec.
- Edits: 150 × 2 edits/cart = 300/day. ~0.003 writes/sec total.
- Reads: 5000 cart-icon page loads/day = ~0.06/sec.
- Active carts at a moment: ~50.
- Storage at a year: ~33MB.

One Postgres + one app server handles this with two orders of magnitude headroom.

**One million DAU:**

- Carts created: 1M × 30% = 300k/day. Sustained ~3.5/sec, peak ~10/sec.
- Edits: 600k/day. Sustained ~7/sec, peak ~21/sec.
- Cart-icon reads: 10M page loads/day = ~115/sec sustained, ~350/sec peak.
- Active carts at a moment: ~25k.
- Storage with 30-day retention: ~7GB live (carts + cart_items).
- Inventory check load: ~400/sec at peak.

**Key insights:**

- Writes are *small* even at 1M DAU. Postgres handles 20 writes/sec without breathing.
- Reads are 20-50x writes. The cart-icon shown on every page is the hot read.
- Active carts (25k) fits trivially in Redis. ~200 bytes × 25k = 5MB. A single Redis node is overkill.
- The actual bottleneck is the inventory service, which gets called by the cart on every add and every cart-page-load. Inventory is the dependency to watch.

### 3. API design

**Create or get current cart (idempotent):**

```
GET /api/v1/cart
Authorization: Bearer <token>          # if logged in
Cookie: cart_token=<uuid>              # if anonymous

Response 200:
{
  "cart_id": "crt_abc123",
  "user_id": "usr_42",
  "items": [
    {
      "sku": "shoe-blue-42",
      "qty": 2,
      "snapshot_price_cents": 5000,
      "current_price_cents": 5500,
      "availability": "in_stock",
      "name": "Blue Runner Size 42",
      "image_url": "..."
    }
  ],
  "updated_at": "2026-05-23T10:15:00Z",
  "expires_at": "2026-06-22T10:15:00Z"
}
```

**Add item:**

```
POST /api/v1/cart/items
Idempotency-Key: <uuid>
{
  "sku": "shoe-blue-42",
  "qty": 1
}
```

Responses:

| Status | Meaning | Body |
|--------|---------|------|
| 201 Created | Item added | full cart |
| 200 OK | Item already in cart, qty increased | full cart |
| 400 Bad Request | qty out of range, sku malformed | `{"error": "invalid_qty"}` |
| 404 Not Found | SKU does not exist in catalog | `{"error": "sku_not_found"}` |
| 409 Conflict | SKU is restricted (region, age) | `{"error": "sku_restricted", "reason": "..."}` |
| 410 Gone | SKU is discontinued | `{"error": "sku_discontinued"}` |
| 422 Unprocessable | Cart at size limit (100 items) | `{"error": "cart_full"}` |

**Update qty:**

```
PATCH /api/v1/cart/items/{sku}
{
  "qty": 3                              # 0 = remove
}
```

**Remove item:**

```
DELETE /api/v1/cart/items/{sku}
```

**Merge cart (called on login):**

```
POST /api/v1/cart/merge
{
  "anonymous_token": "<uuid from cookie>"
}

Response 200: the merged cart
```

**Checkout (returns a checkout session; checkout itself is a separate service):**

```
POST /api/v1/cart/checkout
Idempotency-Key: <uuid>

Response 200:
{
  "checkout_session_id": "ckt_xyz",
  "items_snapshot": [...],              # frozen at this moment
  "total_cents": 11000,
  "expires_at": "2026-05-23T10:30:00Z"  # 15 min to complete payment
}
```

**Notes on the API:**

- **Idempotency-Key on writes.** Mobile clients retry on flaky networks. Without an idempotency key, double-tapping "Add" gives you qty 2 when the user wanted 1.
- **GET /cart returns hydrated data.** The cart service joins the bare cart (SKU + qty) with the catalog (name, image, current price) and inventory (availability) at read time. Hydration happens server-side, never on the client.
- **Snapshot price vs current price.** Always return both. The snapshot is what they saw when they added; the current price is what they will be charged. UI shows current; analytics needs the diff.
- **Checkout returns a session, not an order.** The order is created downstream by the checkout/payment service. The cart is consumed once that session converts.

### 4. Data model

```sql
-- One row per cart. A user has at most one cart (anonymous or authenticated).
CREATE TABLE carts (
    cart_id          UUID PRIMARY KEY,
    user_id          BIGINT,                       -- NULL for anonymous
    cart_token       UUID,                         -- non-NULL for anonymous
    status           SMALLINT NOT NULL DEFAULT 1,  -- 1=active, 2=converted, 3=abandoned, 4=expired, 5=merged
    item_count       INT NOT NULL DEFAULT 0,       -- denormalized for fast cart-icon reads
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ,                  -- 30 days from last update by default
    CHECK ((user_id IS NULL) <> (cart_token IS NULL))   -- exactly one of the two is set
);

CREATE UNIQUE INDEX idx_carts_user ON carts (user_id) WHERE status = 1 AND user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_carts_token ON carts (cart_token) WHERE status = 1 AND cart_token IS NOT NULL;
CREATE INDEX idx_carts_expires ON carts (expires_at) WHERE status = 1;
CREATE INDEX idx_carts_abandoned ON carts (updated_at) WHERE status = 1;

-- One row per (cart, sku).
CREATE TABLE cart_items (
    cart_id              UUID NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    sku                  TEXT NOT NULL,
    qty                  INT NOT NULL CHECK (qty > 0 AND qty <= 99),
    snapshot_price_cents INT NOT NULL,
    added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hold_token           TEXT,                     -- if SKU required a reservation
    PRIMARY KEY (cart_id, sku)
);

CREATE INDEX idx_cart_items_sku ON cart_items (sku);  -- for analytics ("how many carts have SKU X")

-- Audit table for merges. Critical for support tickets.
CREATE TABLE carts_merged (
    merge_id          UUID PRIMARY KEY,
    user_id           BIGINT NOT NULL,
    anonymous_token   UUID,
    anonymous_items   JSONB NOT NULL,             -- snapshot
    account_items     JSONB NOT NULL,             -- snapshot
    merged_items      JSONB NOT NULL,             -- snapshot
    rule_applied      TEXT NOT NULL,              -- "qty:max" | "anon_wins" | "rebind"
    trimmed_items     JSONB,                      -- if size-limit forced drops
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merged_user ON carts_merged (user_id, occurred_at DESC);
```

**Choices and why:**

- **`cart_id` is UUID.** Cart IDs are exposed in logs and APIs; sequential IDs leak business volume. UUIDs are unguessable.
- **Exactly one of `user_id` or `cart_token`.** Enforced by the CHECK constraint. A cart is either anonymous or owned by a user. After merge, the anonymous row is deleted; never demoted.
- **Partial unique indexes.** A user has at most one *active* cart; carts in other statuses can pile up for audit. Same for cart_token.
- **`item_count` denormalized on `carts`.** The cart-icon on every page only needs the count. One Postgres row read instead of a JOIN. Updated transactionally with item changes.
- **`snapshot_price_cents` on cart_items, not carts.** Each item snapshots its price at add time. The cart's "total" is computed at checkout; never stored stale.
- **`hold_token` on cart_items.** When a SKU requires reservation, the inventory service returns a hold token; storing it on the cart_item lets us release the hold cleanly on remove.
- **`status` smallint not enum.** Easy to add new statuses without migrations. `5=merged` recorded for audit even though the row could be deleted.
- **`carts_merged` is critical.** When a user emails support saying "my cart disappeared", you query this table by user_id and reconstruct what happened.

**Choice: Postgres, not DynamoDB or Cassandra.** ACID matters here: merging two carts is one transaction, removing an item plus releasing a hold is one transaction. The data volume is small (7GB at 1M DAU). Postgres is the right answer.

### 5. Core algorithms

#### Cart state on the read path

```python
def get_cart(user_id=None, cart_token=None):
    key = f"cart:user:{user_id}" if user_id else f"cart:token:{cart_token}"

    # 1. Try Redis.
    raw = redis.hgetall(key)
    if raw:
        cart = deserialize(raw)
    else:
        # 2. Redis miss. Fall through to DB.
        cart = db.fetch_cart(user_id=user_id, cart_token=cart_token)
        if cart is None:
            return None
        # Repopulate Redis.
        redis.hset(key, serialize(cart))
        redis.expire(key, CART_TTL_SECONDS)

    # 3. Hydrate from catalog + inventory in parallel.
    skus = [item.sku for item in cart.items]
    catalog_data, inventory_data = parallel_fetch(
        catalog.get_many(skus),
        inventory.check_many(skus)
    )

    # 4. Compose response with snapshot vs current pricing.
    for item in cart.items:
        item.name = catalog_data[item.sku].name
        item.image_url = catalog_data[item.sku].image_url
        item.current_price_cents = catalog_data[item.sku].price_cents
        item.availability = inventory_data[item.sku].status

    return cart
```

Key properties:

- **Redis is read-through.** First call after a miss populates Redis from the DB; subsequent reads are fast.
- **Catalog and inventory fetched in parallel.** Both are independent; the latency floor is `max(catalog_latency, inventory_latency)`, not the sum.
- **Catalog and inventory results are NOT cached in the cart's Redis entry.** They change too fast. Cache them inside their respective services if needed. Cart Redis holds the small, slowly-changing part: SKU + qty + snapshot_price + hold_token.

#### Merge logic (core algorithm)

```python
def merge_carts(anonymous_token, user_id):
    with db.transaction(isolation="serializable"):
        anon_cart = db.fetch_cart(cart_token=anonymous_token, lock_for_update=True)
        user_cart = db.fetch_cart(user_id=user_id, lock_for_update=True)

        if anon_cart is None:
            return user_cart

        if user_cart is None:
            # Rebind: just promote the anonymous cart to the user.
            db.update(anon_cart.id,
                      user_id=user_id,
                      cart_token=None,
                      updated_at=NOW())
            audit_merge(user_id, anonymous_token,
                        anon=anon_cart.items, account=[], merged=anon_cart.items,
                        rule="rebind")
            invalidate_redis(f"cart:token:{anonymous_token}")
            invalidate_redis(f"cart:user:{user_id}")
            emit_event("cart.merged", {...})
            return db.fetch_cart(user_id=user_id)

        # Both exist. Merge with max-qty rule.
        merged = {item.sku: item.copy() for item in user_cart.items}
        trimmed = []
        for anon_item in anon_cart.items:
            if not catalog.is_available(anon_item.sku):
                trimmed.append({"sku": anon_item.sku, "reason": "discontinued"})
                continue

            if anon_item.sku in merged:
                merged[anon_item.sku].qty = min(
                    max(anon_item.qty, merged[anon_item.sku].qty),
                    MAX_QTY_PER_ITEM
                )
            else:
                if len(merged) >= MAX_CART_ITEMS:
                    trimmed.append({"sku": anon_item.sku, "reason": "size_limit"})
                    continue
                merged[anon_item.sku] = anon_item

        db.replace_items(user_cart.id, merged.values())
        db.delete(anon_cart.id)                # consumed
        audit_merge(user_id, anonymous_token,
                    anon=anon_cart.items, account=user_cart.items,
                    merged=list(merged.values()), rule="qty:max", trimmed=trimmed)

        invalidate_redis(f"cart:token:{anonymous_token}")
        invalidate_redis(f"cart:user:{user_id}")
        emit_event("cart.merged", {...})

        return db.fetch_cart(user_id=user_id)
```

Key properties:

- **Serializable isolation.** Two simultaneous merges of the same anonymous cart cannot both succeed. The second one finds anon_cart already deleted and returns the user cart unchanged.
- **Catalog availability check inline.** Discontinued items are dropped silently in the merge but recorded in `trimmed_items` for the audit row.
- **Audit always written.** Whether rebind, merge, or no-op, the audit captures what happened. Storage is cheap; support tickets are not.

#### Abandonment detection

```sql
-- Run every 15 minutes. Find carts that look abandoned.
SELECT cart_id, user_id, updated_at
FROM carts
WHERE status = 1
  AND user_id IS NOT NULL                       -- only for known users we can email
  AND updated_at < NOW() - INTERVAL '6 hours'
  AND updated_at > NOW() - INTERVAL '6 hours 15 minutes'  -- this batch only
  AND NOT EXISTS (
    SELECT 1 FROM cart_abandonment_emails
    WHERE cart_id = carts.cart_id
  );
```

For each row, emit a `cart.abandoned` event to Kafka. The notification service consumes and sends the email. Recording in `cart_abandonment_emails` is the dedup: we will not email twice for the same cart.

Don't scan all carts every minute; use the time-window batching above. At 25k active carts and a 15-minute job, the query touches ~600 rows per run. Trivial.

### 6. Architecture (recap from question.md, deeper)

Component responsibilities:

| Component | Stateful? | Scaling story |
|-----------|-----------|---------------|
| API Gateway | No | Horizontal pods. Handles TLS, auth, anon-cookie issuance. |
| Cart Service | No (state in Redis + DB) | Horizontal pods. No sticky session needed (cart_id resolves the same row everywhere). |
| Redis (active carts) | Yes | Single node up to ~100k DAU. Shard by hash(user_id) past that. Replicated for HA. |
| Postgres | Yes | Primary + read replicas. Partition by user_id only past 10M+ carts. |
| Kafka | Yes | Standard cluster. Topics: `cart.item.added`, `cart.item.removed`, `cart.merged`, `cart.abandoned`, `cart.converted`. |
| Inventory Service | Owned elsewhere | Cart treats as a dependency. Cart's call pattern: read-heavy on cart load. |
| Catalog/Pricing | Owned elsewhere | Same. Heavy use of catalog's own cache. |
| Abandonment worker | Stateless | One pod runs the timed query; events flow through Kafka. |

### 7. Read and write paths

**Write path (add item):**

1. Client → API Gateway. Auth (user_id) or anon cookie (cart_token).
2. Cart Service: idempotency-key check.
3. Cart Service: catalog lookup for SKU validity, current price.
4. Cart Service: inventory check (read-only) for availability.
5. If SKU requires reservation: call inventory service `place_hold(sku, qty, ttl=15min)`. Get hold_token.
6. In one DB transaction:
   - `INSERT ... ON CONFLICT (cart_id, sku) DO UPDATE SET qty = qty + ?, updated_at = NOW()` on cart_items.
   - `UPDATE carts SET item_count = item_count + ?, updated_at = NOW()` on carts.
7. Update Redis hash for the cart.
8. Emit `cart.item.added` event to Kafka (fire-and-forget).
9. Return 201 with hydrated cart.

P99 target: 150ms. Bottleneck is inventory/catalog network call; both should be P99 <50ms in their own service.

**Read path (GET /cart):**

1. Client → API Gateway → Cart Service.
2. Cart Service: try Redis. Hit (~95% in steady state): return bare cart in <2ms.
3. Redis miss: read from Postgres. Repopulate Redis with 30-day TTL.
4. In parallel: call Catalog (current price, name, image), call Inventory (current availability).
5. Compose response.
6. Return 200.

P99 target: 80ms. Most time is in the parallel hydration calls.

**Read path (cart-icon count only):**

1. Client → API Gateway → Cart Service: `GET /api/v1/cart/count`.
2. Cart Service: try Redis hash key `cart:user:{uid}:count` (kept in sync with items).
3. Cache miss: read `item_count` from Postgres `carts` row.
4. Return `{"count": 3}`.

P99 target: 20ms. This is the call that runs on every page load and dominates QPS. Keep it lean.

**Merge path:** covered in section 5.

### 8. Scaling journey: 10 to 1M users

This is the section the interviewer cares about most. At every scale we name what *just* broke and what fixes it.

#### Stage 1: 10 to 100 users (a tiny store)

**What you build:**
- One Postgres (db.t3.micro, 1GB RAM). The `carts` and `cart_items` tables.
- One Node/Go/Python app server running the Cart Service. Talks directly to Postgres.
- No Redis. No Kafka. No abandonment emails.
- Anonymous carts: a `cart_token` cookie pointing to a row.
- Inventory check: a synchronous query against the product table in the same DB. There is no separate inventory service yet; the cart and the product catalog are the same app.

**Why this is enough:**
- ~10 carts/day. ~50 cart-icon reads/day. Postgres yawns at this load.
- No need for cache; the working set is a handful of rows.
- No need for events; nothing downstream is listening yet.

**What you do *not* build:**
- No Kafka.
- No Redis.
- No reservation system; everything is optimistic; checkout re-checks.
- No multi-region.
- No abandoned-cart emails. Founders read DB reports manually.

**Total cost:** ~$30/month for the DB. You ship in three days.

#### Stage 2: 1k users (a growing Shopify-style store)

**What just broke:**

- Marketing wants abandoned-cart emails. They are the highest-ROI campaign in e-commerce.
- The product catalog is now big enough that it deserves its own service (separate from the cart). The cart should not query product tables directly.
- "I added a shoe on my phone and now I am on my laptop, where is it?" Mostly works because both devices hit the same DB, but anonymous carts on two devices don't merge.
- The cart-icon read on every page is starting to be a measurable fraction of DB load. ~30 reads/sec.

**What you add:**

- **Inventory and Catalog become separate services.** Cart calls them via HTTP. Adds latency but decouples scaling.
- **Login-time cart merge.** Implement the merge endpoint. Add the `carts_merged` audit table. Now anonymous carts properly fold into account carts.
- **Abandoned-cart job.** A nightly cron query finds carts inactive >6h and enqueues an email via the email service. No Kafka yet; a simple `pending_emails` table polled by a worker.
- **Cart size and qty limits.** 100 items, 99 qty per item. Surface as 422 errors.

**What you do *not* yet build:**

- No Redis. Postgres still handles all reads with one read replica added.
- No Kafka. The events table polled by workers is enough.
- No reservation system. Optimistic with re-check at checkout.

**Why this is enough:**
- 1k DAU × 30% = 300 cart writes/day plus a few hundred edits. Postgres yawns.
- Cart-icon reads: ~10k/day. Even at peak, Postgres can serve this if you have an index on `carts.user_id` and read the denormalized `item_count` column.

**New cost:** ~$150/month (slightly bigger DB, read replica, email service usage).

#### Stage 3: 100k users (a real e-commerce business)

**What just broke:**

- Cart-icon reads are now ~12 reads/sec. Across other DB load, the carts table is showing up in slow query logs.
- Postgres is doing fine but you notice cart-page-load latency creeping up because each load joins with the catalog over HTTP for 5+ items.
- One day your inventory service has a 30-second blip. All cart adds fail because you were blocking on inventory checks. Customers complain.
- A flash sale on a limited-edition sneaker. 5000 users add the same SKU to cart in 60 seconds. Inventory shows it as available to all 5000, but you only have 100 pairs. 4900 of them get "out of stock" at checkout. Brand damage.
- Marketing wants real-time signals for recommendations: "show shoes like the one this user added 5 minutes ago." Polling the DB doesn't cut it.

**What you add:**

- **Redis as the cart cache.** Active carts live in Redis as a hash per user (`cart:user:{uid}` → `{sku_a: 2, sku_b: 1}`). Read path checks Redis first; falls through to Postgres on miss. Writes are write-through (Postgres first, then Redis update). 95%+ hit rate on active users.
- **Inventory check becomes best-effort with graceful degradation.** If inventory service times out, fall back to "show as available, re-check at checkout." Cart adds never fail because inventory is down. Surface a "we'll confirm at checkout" badge.
- **Reservation-only-for-special-SKUs.** Catalog flags some SKUs as `requires_reservation=true`. For those, the cart calls `inventory.place_hold(sku, qty, ttl=15min)` on add. Hold_token stored on cart_item. Released on remove or cart abandonment.
- **Kafka for cart events.** Replaces the `pending_emails` polling. Topics: `cart.item.added`, `cart.item.removed`, `cart.merged`, `cart.abandoned`. Consumers: notification service, analytics, recommendations.
- **Read replica for Postgres.** Cart reads (on miss) go to the read replica. Writes go to primary. Replication lag <1s acceptable here.
- **Garbage collection of old carts.** Nightly job deletes anonymous carts where `expires_at < NOW() - 30 days`. Without this, the table grows forever.

**Why this is enough:**

- 100k DAU × 30% = 30k carts/day. ~0.5 writes/sec. Trivial.
- Cart-icon reads: 1M/day = ~12/sec. Redis handles this without noticing.
- Active carts in Redis: ~2500. Memory: ~500KB. One node, replicated.
- Inventory dependency now properly decoupled with timeouts and fallbacks.

**New cost:** ~$1-2k/month (bigger DB, replica, Redis, Kafka, more compute).

#### Stage 4: 1M users (a real marketplace)

**What just broke:**

- 350 cart-icon reads/sec at peak. Redis still fine but you want HA: if Redis dies you lose 25k active carts and customers see "cart empty." Bad day.
- One Redis instance is now serving ~400 ops/sec total. Not the bottleneck yet, but you want headroom.
- 21 cart writes/sec at peak. Postgres still fine, but write contention on the `carts` row (item_count update) is occasionally surfacing in `pg_stat_activity`.
- A scraper-bot adds 50 items/sec to thousands of anonymous carts. The bot grinds against the inventory service which is what actually melts.
- You expand to a second region for European customers. EU shoppers want sub-100ms cart loads.
- Multiple customers complain about price drift: "I added at $50, you charged $55." Some are within the law; some are not.

**What you add:**

- **Sharded Redis by `hash(user_id) % N`.** Each shard owns a slice of users. Cart Service computes shard at request time. Scales reads and writes horizontally. 4 shards comfortably handle 1M DAU; can grow to 16 if needed.
- **Redis replication per shard.** Each shard has 1 primary + 1 replica. On primary failure, fail over to replica. Cart reads degrade for ~10s during failover; writes pause for the same window. Acceptable.
- **Postgres logical sharding by `user_id`.** Not yet physical sharding (load doesn't require it); just logical separation so future sharding is straightforward.
- **Regional deployment.** EU region has its own Cart Service, Redis cluster, Postgres replica. Writes still go to primary region (US), but reads serve from regional replica. Replication lag <2s acceptable for cart reads. Active EU shoppers see fast reads.
- **Async checkout pipeline.** Checkout no longer does everything synchronously. Cart Service emits `cart.checkout_started` to Kafka with a frozen snapshot; the Order Service consumes, does the payment + atomic inventory reserve, emits `order.created` or `order.failed`. The user sees a "processing" page that polls. This decouples cart from order processing and absorbs traffic spikes (Black Friday).
- **Rate limit on add-to-cart per IP and per cart_token.** Caps the bot scenario. 30 adds/minute per anonymous cart is generous for humans, lethal for bots.
- **Price drift policy enforced.** On checkout, if any item's current price differs from snapshot by >10% or >$5, the checkout response shows a "price changed" banner with the new total; user must explicitly confirm before payment. Audit row records the drift acknowledgement.
- **Cart event hub for analytics.** Kafka topics tier into ClickHouse for "abandoned cart funnel" dashboards.

**What is now the bottleneck (the next problem):**

The cart itself is comfortable. The new bottleneck is the **inventory service**: every cart-page-load fans out to inventory for N SKUs. At 350 cart reads/sec × ~3 SKUs each, inventory sees ~1000 lookups/sec. Inventory has its own scaling story (caching, sharding, hot SKU mitigation) which is a separate design problem.

**Why this is enough:**

- 1M DAU at 10-21 cart writes/sec is still small per shard.
- Cart reads: 350/sec ÷ 4 Redis shards = 87/sec per shard. Comfortable.
- Active carts: 25k ÷ 4 shards = ~6k per shard. Memory ~1.5MB per shard.
- Regional split halves cross-Atlantic latency for EU users.

**Cost:** ~$10-20k/month (multi-region, sharded Redis, Kafka cluster, larger Postgres, analytics tier).

#### What you would do at 10M+ users

At 10M DAU you are Amazon-scale. Honestly the cart design barely changes; what changes is everything around it:

- Cart shards: 16 or 32 Redis shards. Postgres physically sharded by `user_id`.
- The cart team becomes its own service team with on-call rotation.
- Inventory becomes the primary integration challenge: hot SKUs, regional inventory, "ship from store" complexity.
- The cart is no longer the most interesting system in the building.

The point: the cart's architecture stops evolving past stage 4. The action moves to inventory, checkout, fulfillment, and personalization.

### 9. Reliability

**Redis dies mid-cart.** Two flavors:

- *Single shard dies.* The shard's primary fails over to replica in ~10s. During the window: cart reads for affected users go to Postgres (slow but works); writes are queued in the app and retried (or 503 if the failover takes >30s). Users with carts on healthy shards are unaffected.
- *Entire Redis cluster goes down.* Cart Service falls through to Postgres for every read. Postgres can handle 350 reads/sec for a while; degraded latency (~80ms instead of ~5ms). Writes proceed normally. The "active cart cache" is now cold; first read for each user repopulates it once Redis is back. Users notice slower page loads; no one notices missing carts.

**Postgres primary dies.** Standard failover: promote a replica (30-60s). During the window: writes fail (cart adds return 503 with `Retry-After`). Reads continue from replicas. After recovery, queued writes retry.

**Inventory service down.** Best-effort: cart shows last-known availability or "we will confirm at checkout." Cart adds proceed. The risk: more "out of stock at checkout" surprises. Acceptable for the duration of an outage.

**Checkout starts but payment fails.** The order service handles this; the cart's role is to *not* clear the cart until it receives a `cart.converted` event from the order service. If payment fails, the order service emits `cart.checkout_failed` and the cart goes back to the regular state (any inventory holds are released). User can edit and retry.

**Race: user removes item while checkout is starting.** Checkout took a frozen snapshot of the cart. The removal happens in the live cart but does not affect the in-flight checkout. If checkout succeeds, the converted items in the snapshot are deducted from inventory; the cart's current state (which may have other items) remains for further shopping. If checkout fails, the user's edit is preserved.

**Network partition between regions.** EU region cannot reach US-region Postgres primary. EU cart reads continue from EU replica (stale by up to a few seconds). EU cart writes queue locally and retry; if the partition lasts more than a minute, surface a generic "we're having trouble saving your cart" banner.

### 10. Observability

| Metric | Why |
|--------|-----|
| `cart.read.p99` regional | The headline SLO for cart-page-load |
| `cart.write.p99` | If this spikes, DB contention is back |
| `cart.icon_count.p99` | Even tighter SLO; runs on every page |
| `cart.redis.hit_rate` | Should be >95%. Drop = repopulation storm or shard imbalance |
| `cart.merge.rate` | Sudden spike: someone broke auth (re-merging on every request) |
| `cart.merge.size_trimmed.rate` | If this is non-zero often, raise the size limit |
| `inventory.timeout.rate` | Drives the "show as available, re-check at checkout" fallback |
| `cart.checkout_started.rate` | Conversion funnel metric |
| `cart.abandonment.rate` | Marketing's headline; alert on big jumps |
| `cart.size.p99` | Detects bot-stuffed carts. If p99 jumps past 50 items, investigate |
| `cart.add.rate_limit_hits` | Bot detection signal |
| `cart.price_drift.acknowledgements` | Compliance and customer-experience metric |
| `kafka.cart_events.lag` | If this lags, abandonment emails stop arriving |
| `db.replication_lag.p99` | Read replicas must stay <1s |

Alerts:
- Page on: cart.read.p99 > 200ms for 5min, redis.hit_rate < 80% for 5min, kafka.lag > 5min, cart.write error rate > 2%.
- Ticket on: merge.rate sudden spike, size_trimmed.rate sudden spike, inventory.timeout.rate > 5%.

### 11. Common gotchas

1. **Timezones for "abandoned" detection.** "After 6 hours of inactivity" must be in UTC; never in the user's local time. Otherwise users in time zones with daylight-savings transitions get double-emailed or skipped during the shift. Store all `updated_at` as `TIMESTAMPTZ`; compute "6 hours ago" in UTC.

2. **Cart bloat from edge cases.** Coupon spam, repeated-add via bot, scraper testing rate limits. Enforce size limits hard. 100 items, 99 qty per item. Surface `cart_full` errors. Add per-IP and per-cart_token rate limits on add.

3. **Bot carts skewing analytics.** A scraper that opens 10k anonymous carts daily will pollute your "average cart size" metric. Flag carts where `cart_token` was created and never accessed from a real session. Exclude from headline metrics.

4. **Price drift between add and checkout.** Always show both prices in the UI. At checkout, if the difference exceeds a threshold (10% or $5), require explicit user confirmation. Record the acknowledgement in audit. Some jurisdictions (EU consumer law) require this anyway.

5. **Currency mismatch.** User browsing in USD adds an item, switches to EUR. Cart should re-display in EUR using current exchange rates. The snapshot price stays in the original currency (for audit); the display computes the converted price. Never silently change the user's expected total without showing them.

6. **Restricted items at checkout.** An item legal to ship at add-time becomes restricted (regulation change, shipping address differs from billing). At checkout, the order service re-validates each item against shipping rules; restricted items are surfaced with "cannot ship to this address; remove or change address."

7. **Multi-tab cart edits.** User has cart open in two tabs. Edits in tab A. Tab B has stale state. Solution: use ETags on cart responses; PATCH requests include `If-Match: <etag>`; conflicts return 409 with the latest cart. UI shows "Your cart was updated elsewhere; refreshing."

8. **Anonymous cart cookies that never die.** Browser keeps the `cart_token` cookie forever. After 30 days the cart is gone (GC'd), but the cookie still points at nothing. On cart read, treat "cookie present, no row found" as "issue a new cart_token." Don't surface an error.

9. **Decimal places on price.** Use integer cents everywhere internally. Never store `9.99` as a float. Floats break promo math eventually.

10. **The "cart from before our system existed" migration.** When you migrate from an older cart system, old `cart_id`s collide or have different formats. Run dual-write during migration; resolve conflicts user-by-user with a written rule.

### 12. Follow-up answers

**1. Cart bloat from bots.**

Symptoms: a single anonymous cart with 10k items, or a cart pattern of "add → remove → add → remove" at 50/sec.

Defenses (layered):
- Per-cart size limit (100 items) enforced as a 422 error.
- Per-qty limit (99) per item.
- Rate limit on `POST /cart/items`: 30/min per IP, 60/min per authenticated user. Configurable per-account for B2B customers who legitimately bulk-add.
- WAF rules at the edge for obvious bot user-agents.
- Bot detection: anonymous carts created from IPs that never load a product page are flagged for shorter TTL (1 day instead of 30).

For determined attackers: nothing in the cart layer alone stops them. Push detection upstream (CAPTCHA at suspicious checkout patterns, account-level fraud detection).

**2. Multi-device sync delay.**

User adds an item on their phone. Sync to laptop should be visible by next page load on the laptop. Mechanism:

- Phone's add writes to Redis + DB. Both reflect immediately.
- Laptop's next page load fetches from Redis (or DB if Redis miss). Sees the new state.

There is no push to laptop; the user has to interact. If they have the cart page open on laptop, they see stale data until they refresh. To make it live: WebSocket subscription per user that pushes cart-change events. Cost: more infrastructure, real-time delivery. For most e-commerce this is unnecessary.

Acceptable latency: visible on the next page load. Sub-100ms after request reaches Redis.

**3. Redis dies mid-cart.**

Scenario: entire Redis cluster goes down for 5 minutes during peak.

User experience:
- First cart-page-load after Redis dies: cart fetches from Postgres. Latency goes from ~10ms to ~50ms. User does not notice.
- Cart writes continue normally (writes go to DB first, Redis update silently fails; the next read repopulates).
- Once Redis is back, the first cart-load for each user repopulates the Redis hash. Cold start; ~30s to warm up to normal hit rate.

Internally:
- Cart Service detects Redis failures via a circuit breaker. After N consecutive failures, switch to "DB-only" mode for ~30s; skip Redis writes (would just queue and fail). Re-probe Redis periodically.
- Metric `cart.redis.hit_rate` drops to 0 during the outage; alerts fire.

What you do *not* do: try to serve stale data from anywhere else. The DB is the source of truth; if it is up, you are fine. Redis is purely an accelerator.

**4. Price drift.**

User added at $50 last week. Today's price is $55.

UI on cart page: shows current ($55) with a small annotation "was $50 when added." Cart total uses current prices.

At checkout:
- The checkout request returns the live total with current prices.
- If the difference for any item exceeds a threshold (configurable, often 10% or $5), the response includes a `price_change_required_acknowledgement: true` flag.
- The UI surfaces a banner: "Some prices have changed. Please review your cart before paying."
- User clicks "Confirm changes" → second checkout call with `price_change_acknowledged: true`.
- Audit row captures the original snapshot price and the confirmed current price.

What you pay: always the current price (the snapshot is informational and audit-only). The exception is "price guarantee" promotions, which are a separate feature and explicitly track guaranteed-prices in their own table.

**5. Cart abandonment detection.**

Naive approach: every minute, scan all carts where `status = 'active' AND updated_at < NOW() - 6h`. At 100k+ active carts this becomes slow.

Right approach: time-window batching.

```sql
SELECT cart_id, user_id FROM carts
WHERE status = 1
  AND user_id IS NOT NULL
  AND updated_at >= NOW() - INTERVAL '6 hours 15 minutes'
  AND updated_at <  NOW() - INTERVAL '6 hours'
  AND NOT EXISTS (SELECT 1 FROM cart_abandonment_emails WHERE cart_id = carts.cart_id);
```

This finds carts that *just crossed* the 6-hour threshold in this 15-minute job run. The query touches a small slice of rows. Index on `(status, updated_at)` is the partial index that supports it.

For each result, emit `cart.abandoned` to Kafka. Notification service consumes and sends email. Record in `cart_abandonment_emails` for dedup.

Alternative at scale: maintain a Redis sorted set of `cart_id` by `updated_at` and zrange-pop expired entries every minute. More efficient, more moving parts.

**6. Anonymous cart TTL and the returning user.**

Anonymous carts default to 30-day TTL (`expires_at = updated_at + 30 days`). Nightly GC job:

```sql
DELETE FROM carts
WHERE status = 1
  AND user_id IS NULL
  AND expires_at < NOW();
```

A user comes back after 90 days with their old `cart_token` cookie. The cookie still has the token; the row is gone. On `GET /cart`:
- Lookup by token returns nothing.
- Cart Service issues a new `cart_token`, sets the cookie, returns an empty cart.
- No error; the user just sees an empty cart.

If the user logs in: no anonymous cart to merge; account cart loads normally.

**7. Shared account, simultaneous edits.**

Two people on the same account, both adding items.

The cart's primary key is `cart_id`, but the active cart for a user is found via the unique index on `user_id WHERE status = 1`. Both sessions resolve to the same cart row.

- Adds use `INSERT ... ON CONFLICT (cart_id, sku) DO UPDATE SET qty = qty + ?`. Concurrent adds for the same SKU sum correctly (this is the case where sum is right, not max, because each is an explicit user action).
- Removes use straight DELETE. Race: both click remove; first succeeds, second affects zero rows. No error.
- The `carts.item_count` is incremented/decremented in the same transaction.
- Both users see each other's edits on their next page load.

There is no real-time push; if you want to support it, add a WebSocket per session subscribed to `cart:{user_id}` events. Niche feature.

**8. Currency and locale.**

The cart stores `sku`, `qty`, and `snapshot_price_cents` in the original transaction currency. The catalog returns prices in a configurable currency at hydration time.

When the user switches locale, the cart's display is recomputed against the current currency's prices (which the catalog/pricing service maintains, typically based on FX rate refresh hourly). The snapshot stays in original; the displayed prices change. UI shows "Prices shown in EUR; original prices were in USD."

At checkout, the user is charged in the currently-displayed currency. The order record captures both currencies for accounting.

**9. Item becomes restricted before checkout.**

A user added vape juice (legal at add-time). Their state passed a regulation; the item is no longer shippable to their ZIP.

At cart-page-load:
- Catalog/Inventory returns availability flagged as `restricted_in_region`.
- Cart Service displays the item with a "cannot ship to your address" badge and disables the checkout button until removed.

At checkout (if the user somehow bypassed the cart display):
- Order Service re-validates each item against the shipping address.
- Restricted items are returned in the error: `{"error": "items_restricted", "restricted_skus": [...]}`.
- Checkout fails atomically; payment is not attempted.

User sees: "Some items in your cart cannot be shipped to this address. Remove them or change your address."

**10. Save for later.**

"Move to wishlist" is part of a separate Wishlist Service, not the cart. The cart's responsibility is items the user intends to buy; the wishlist is items they intend to remember.

The interaction: a button in the cart UI calls:
1. `POST /wishlist/items {sku: "..."}` to add to wishlist.
2. `DELETE /cart/items/{sku}` to remove from cart.

The two calls are not atomic. If the wishlist add succeeds but the cart delete fails, the item is in both places (annoying, not broken). UI retries the cart delete in the background.

Alternative: a single `POST /cart/items/{sku}/move_to_wishlist` endpoint in the Cart Service that does both. More cohesive UX; couples the two services. For a small site, fine. For a large site, the wishlist is owned by another team and the two-call dance is the contract.

### 13. Trade-offs and what a senior would mention

- **Cookie vs DB vs Redis.** Cookie alone is too small and does not sync; in-memory session does not scale; DB alone gets slow on cart-icon reads at scale; Redis+DB is the right combination once DB reads become noticeable. Start with DB-only; add Redis when metrics demand it. Never start with Redis-only because you lose durability.
- **Eager vs lazy inventory check.** Eager (reservation on add) burns inventory headroom for ghost carts; lazy (re-check at checkout) sometimes disappoints users at the last step. Default lazy; eager only for explicitly-marked SKUs. Mixing the two by SKU is the senior answer.
- **Sync vs async checkout.** Sync checkout (cart waits for payment + inventory deduction) is simpler but couples cart latency to all downstream systems. Async checkout (cart emits event, order service handles, user polls) absorbs spikes and isolates failure modes; trade-off is a worse UX (the "processing" page). At small scale sync is fine; at Black Friday scale async is required.
- **Why one cart per user, not many.** Some sites support multiple carts ("birthday cart", "work cart"). Adds significant complexity (which is active? merge across them? share with family?). Don't build it until customers ask. Most never ask.
- **Why Postgres, not a NoSQL store.** ACID transactions for merge and add-on-conflict; analytical queries for abandonment; small data volume. Postgres covers all three. DynamoDB would force you to build your own transaction layer for merge and your own scan layer for abandonment.
- **What I would revisit at 10M+ users.**
  - Physically shard Postgres by user_id.
  - Move from Redis-as-cache to Redis-as-source-of-truth for active carts, with periodic flushes to a durable store. Reduces DB load further.
  - Push more of the cart logic to the edge (CDN-near workers like Cloudflare Workers) for sub-50ms global cart reads.
  - Pre-aggregate the abandoned-cart funnel in ClickHouse; the cart service no longer powers analytics queries directly.

### 14. Common interview mistakes

1. **"Just store the cart in localStorage."** Misses multi-device sync, misses bot/scraper concerns, misses the merge problem on login. localStorage is fine for the very smallest sites but loses you the design problem.

2. **One unified cart for anonymous and logged-in with magical "user_id might be null" everywhere.** The two flows have different lifecycles, different TTLs, different sync requirements. Model both explicitly; merge is its own operation.

3. **No discussion of merge.** The merge problem is the second-most asked follow-up after inventory. Walk into the interview with a stance: max-qty, audit row, idempotent, single transaction.

4. **"We will reserve inventory on add to cart."** A common junior answer. Then the interviewer asks about abandonment rate (60-70%) and ghost holds and your design unravels. The correct answer is "optimistic by default, reservation only for special SKUs."

5. **Ignoring price drift.** "Whatever was in the cart is what they pay" is wrong (and sometimes illegal). Snapshot vs current price, surface the difference, require acknowledgement at the threshold.

6. **Putting checkout in the cart service.** Checkout is its own service: payment, address validation, atomic inventory reserve, order creation, post-purchase events. Cart hands off via a frozen snapshot.

7. **Forgetting the cart-icon read.** Every page on the site loads the cart count. That single endpoint dominates QPS. Optimize it (denormalized `item_count` column, Redis cache, ~20ms p99).

8. **Treating the cart as a synchronous coupling to inventory.** If inventory is down, cart adds should not fail. Show a fallback badge; let checkout do the authoritative check.

9. **Designing for huge write throughput.** Even at 1M DAU you only see ~20 writes/sec. Don't propose Cassandra or Spanner because "carts are write-heavy." They are not.

10. **No audit trail on merge.** Without `carts_merged`, every "my cart is wrong" support ticket is unsolvable. The table is cheap; the data is irreplaceable.

If you can hit 7 of these 10, you are interviewing at senior level. The three most senior signals are: a confident merge policy, the optimistic-by-default inventory stance with named exceptions, and the explicit handling of price drift. Those three are what separate a thoughtful cart design from a generic "design a CRUD app" answer.
{% endraw %}
