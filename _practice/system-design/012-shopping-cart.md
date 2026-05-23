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

> *"We're building a small e-commerce site. Shoes, mostly. About 500 customers a day right now. We want a shopping cart. The kind that lets you add things, change quantities, leave for two hours, come back, and still have your cart. Design that. We expect to grow."*

They lean back. "Easy one. Or it should be."

This is the trap. The cart looks like a CRUD problem with three endpoints and a database table. It isn't. The real questions hide under the floorboards: where does the cart actually live (cookie, server, both), what happens when a guest logs in and already has a cart in their account, what does "in stock" even mean when the cart was updated five minutes before checkout and inventory changes by the second, and how do you keep all of this fast for a million users without melting your database.

We're going to walk this from a 500-customer startup to a 1M-user marketplace. At each stage, something cracks. Naming what cracks is half the exercise.

## Step 1: clarify before you design

Take 5 minutes. Don't start drawing. What would you ask the interviewer? Aim for 8 questions that actually change the design.

<details>
<summary><b>Reveal: questions a strong candidate asks</b></summary>

1. **Guest vs logged-in.** Do anonymous users have carts, or do we force login first? Almost every real site allows guest carts. This single answer determines whether you have one cart model or two, and whether merging carts at login is part of the design.

2. **Cart persistence horizon.** If I add an item and close the tab, how long does my cart live? An hour? A day? Forever? Drives whether the cart lives in memory, in a cookie, or in durable storage. Forever-carts (Amazon-style) need a database. Session-only carts can live in Redis with a TTL.

3. **Multi-device sync.** If I add a shoe on my phone, do I see it on my laptop when I log in? This forces server-side state for logged-in users. Without it, you can get away with cookie-only carts.

4. **Inventory accuracy.** When the cart says "in stock", does that mean reserved for me, visible to me, or last-known-stock-from-five-minutes-ago? Three very different answers, each with very different complexity. Reservation needs a TTL hold; optimistic is simpler but causes occasional checkout failures; eventual is the cheapest and most painful for users.

5. **Cart size limits.** Is there a max items per cart? Max quantity per item? Without limits, scrapers and bots stuff carts with 50,000 items and break your DB. 100 distinct items, 99 units per item, is a typical bound.

6. **Price drift.** Item was $50 when added, store changed it to $55 by checkout. Whose price wins? Almost always the current price, with a UI banner. But you need to capture the snapshot for fraud detection and customer disputes.

7. **Promotions.** Are coupons applied at cart-time or checkout-time? Are they part of this service or a separate one? Coupons are usually a separate service. The cart holds the coupon code; the pricing engine evaluates it.

8. **Checkout boundary.** Is checkout part of this design or downstream? Where does the cart end and the order begin? The cart usually ends when the user clicks "Place Order". After that, an order record is created and the cart is cleared (or marked converted).

Bonus questions a senior asks:

- **Abandoned cart recovery.** Do we send "you left this in your cart" emails? After how long? Drives the need for an analytics path on cart state.
- **B2B / large carts.** Any customers with carts of 500+ SKUs? If yes, your storage decision changes significantly.

If you walked in asking only "how many users", you'd miss the merge logic, the inventory question, and the price drift question. Those three are where the design actually lives.

</details>

## Step 2: capacity estimates

Two scales. The interviewer gives you the small numbers; you derive the big ones from the growth target.

**Small startup (today):**

- 500 daily active users
- 30% of visits add at least one item
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

- Carts created: 500 × 30% = 150/day. About 6/hour.
- Edits: 150 × 2 = 300 cart writes/day. ~0.003 writes/sec. *Negligible.*
- Reads: every page load shows cart count. ~10 pages/visit × 500 = 5000 reads/day. ~0.06/sec.
- Active carts at any moment: ~50.
- Storage: 150 carts/day × 3 items × ~200 bytes = 90KB/day. After a year, ~33MB.

You could build this with one Postgres table, one app server, and walk away. A laptop running locally would handle the load.

**One million users:**

- Carts created: 1M × 30% = 300k/day. Sustained ~3.5/sec, peak ~10/sec.
- Edits per cart: 2. So 600k cart writes/day. Sustained ~7/sec, peak ~21/sec.
- Reads: 10M page loads/day × cart-count-on-every-page = 10M reads/day. Sustained ~115/sec, peak ~350/sec.
- Active carts at a moment: 1M × 30% × (avg 2h active / 24h day) ≈ 25k.
- Storage at 30-day retention: 300k × 30 × 3 items × 200 bytes = ~5.5GB of cart_items. Plus carts header: ~1.3GB. Total ~7GB live.
- Inventory check QPS: every cart add and every cart-page-load re-checks stock. Peak ~400/sec.

**What the numbers tell you:**

- Even at 1M users, write QPS is tiny (~20/sec peak). The cart is a low-write system.
- Reads dominate by 20x. Caching the read path is the whole game.
- Active carts (25k) is the metric that matters for memory sizing of a cache layer.
- The big cost isn't the cart store. It's the inventory-check fan-out to a downstream service that handles dozens of other read patterns. The cart becomes a noisy neighbor on inventory.
- Storage is trivial. 7GB fits on any modern Postgres.

The architecture exists not for throughput but for correctness around merges, inventory consistency, and price drift.

</details>

## Step 3: where does the cart live?

This is the single most-debated decision in cart systems. Four candidates: in-browser cookie only, in-memory server session, durable database, and the hybrid Redis+DB pattern. Each has a real trade-off.

Sketch a comparison table. For each option, name: who can see it, what happens on device change, what happens on server restart, what happens at high scale, and what it costs.

<details>
<summary><b>Reveal: comparison and recommended choice</b></summary>

| Storage | How it works | Pros | Cons | When to use |
|---------|--------------|------|------|-------------|
| Cookie only | Cart serialized into a cookie (JSON or signed token), sent on every request | Zero server state. Survives server restart. Works for anonymous. | ~4KB cookie limit (~30 items max). No cross-device sync. Visible to user (signing required). Lost if cookies cleared. | Truly small sites, prototype only. |
| In-memory server session | Cart in app server memory keyed by session ID | Fastest possible reads. No external dependency. | Lost on server restart. Sticky sessions required. Does not scale past one server. | Never in production. Mentioned to be dismissed. |
| Database (Postgres) | Cart rows in `carts` and `cart_items` tables | Durable. Queryable for analytics. ACID transactions. Survives anything. | One DB read per cart-icon load. At 350 reads/sec, the DB notices. Not as fast as memory. | Default for small-to-medium sites and as source of truth at any scale. |
| Redis cache + DB write-through | Active cart in Redis hash per user. DB holds truth. Read from Redis, write to both. | Sub-ms cart reads. Scales reads horizontally. DB has the durable record for analytics and recovery. | Two systems to keep in sync. Cache invalidation logic. More moving parts. | The right answer at 100k+ DAU or whenever DB reads start being noticeable. |

**The recommendation:**

- Anonymous users: cart stored server-side keyed by an anonymous cart token (UUID in a `cart_token` cookie). Not in the cookie itself, because we want multi-device potential and bigger carts.
- Logged-in users: cart stored server-side keyed by user ID.
- Backend storage: start with Postgres only. Add Redis as a read-through cache when DB reads become noticeable (in practice, ~10k DAU and up).

**Why not cookie-only.** Cookies cap at ~4KB. They're sent on every request, so a fat cookie slows every page. They're visible to the user, which is fine but means you must sign them. They don't sync across devices. They get wiped when users clear cookies. The only thing they're good for is the anonymous cart *token* (a 36-byte UUID pointing at a server-side record).

**Why not in-memory session.** This is the answer a junior gives because it's fast and easy in local dev. It dies the moment you have two app servers and a load balancer. Mention it once, then move on.

</details>

## Step 4: incomplete architecture diagram

Here's an intentionally incomplete diagram. Fill in the five `[ ? ]` placeholders. Think about: who sits at the edge, where the cart actually lives, what speeds up reads, what the cart depends on, and what consumes its events.

```
                Client (web, mobile)
                        |
                        v
                ┌─────────────────┐
                │    [ ? ]        │  (sits at edge, terminates TLS, auth)
                └────────┬────────┘
                         |
                         v
                ┌─────────────────┐
                │  Cart Service   │  (stateless, horizontally scalable)
                └──┬──────┬──┬────┘
                   |      |  |
            read   |      |  | writes events
                   v      |  |
            ┌──────────┐  |  |
            │  [ ? ]   │  |  |  (fast read cache for active carts)
            └─────┬────┘  |  |
                  |       |  |
                  v       v  |
            ┌────────────────┐|
            │   [ ? ]        ││  (source of truth for cart data)
            └────────────────┘|
                              |
                              v
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
                        |
                        v
                ┌──────────────────┐
                │  API Gateway     │  TLS, auth, rate limit,
                │  + Auth          │  anonymous cart_token cookie
                └────────┬─────────┘
                         |
                         v
                ┌──────────────────┐
                │  Cart Service    │  stateless, horizontally
                │                  │  scalable; merge logic;
                │                  │  price snapshot; size limits
                └──┬──────┬──┬─────┘
                   |      |  |
            read   |      |  | writes events
                   v      |  |
            ┌──────────┐  |  |
            │  Redis   │  |  |  cart per user: hash of items
            │  (active │  |  |  TTL 30 days, primary read path
            │  carts)  │  |  |
            └─────┬────┘  |  |
                  | write |  |
                  | through  |
                  v       v  |
            ┌────────────────┐|
            │  Postgres      ||  source of truth: carts,
            │  (carts,       ||  cart_items, carts_merged
            │   cart_items)  ||  audit table
            └────────────────┘|
                              |
                              v
                       ┌──────────────┐
                       │  Kafka       │  cart.item.added
                       │  cart.*      │  cart.item.removed
                       │              │  cart.merged
                       │              │  cart.abandoned
                       └──────┬───────┘
                              |
                Consumers: abandoned-cart-notifier,
                           analytics, recommendation engine,
                           fraud detection

         Sync calls out:
                ┌─────────────────┐
                │ Inventory       │  availability per SKU
                │ Service         │  cart calls on add and on read
                │                 │  own DB, own cache, own scaling
                └─────────────────┘
                ┌─────────────────┐
                │ Catalog /       │  name, image, price
                │ Pricing Service │  cart joins this for display
                └─────────────────┘
```

Why each piece is here:

- **API Gateway + Auth.** First because the cart is exposed to the web. TLS, rate limits, and resolves the user (authenticated user_id or anonymous cart_token from cookie).
- **Cart Service.** Stateless, scales horizontally. Owns merge logic, size limits, and orchestrates inventory/pricing calls.
- **Redis (active carts).** The active read tier. `cart:{user_id}` → `{sku_a: 2, sku_b: 1}`. Sub-millisecond reads. TTL is the cart retention period.
- **Postgres (source of truth).** Durable. Used on Redis miss, for analytics queries (abandoned carts), and recovery if Redis dies.
- **Kafka.** Cart emits events but doesn't block on them. Downstream handles abandoned-cart emails, analytics, recommendation training, fraud signals.
- **Inventory Service.** Separately owned. Cart asks "is SKU X available in qty Y?" Cart never writes to inventory directly (that happens at checkout, in a different service). Inventory check is the bottleneck once you hit scale.
- **Catalog / Pricing Service.** Returns display data and current price. Cart stores SKU + qty + snapshot price at add-time, resolves current price on read.

</details>

## Step 5: anonymous to logged-in cart merge

This is the trickiest part and the one most candidates flunk.

A guest user adds 3 items over 20 minutes. They click "Log in" and authenticate. The system discovers this user *already has* a cart in their account from a session two days ago: 2 different items. What does the merged cart contain? What if there's overlap (same SKU in both carts at different quantities)?

Sketch the merge logic. Consider these cases:

- Anonymous cart has SKU A (qty 1), SKU B (qty 2). Account cart is empty.
- Anonymous cart has SKU A (qty 1). Account cart has SKU C (qty 1).
- Anonymous cart has SKU A (qty 2). Account cart has SKU A (qty 1). What's the final quantity?
- Anonymous cart has SKU A. Account cart has SKU A but A is now discontinued.
- Anonymous cart is empty. Account cart has SKU C. What shows up after login?

What do you do with the anonymous cart's `cart_token` after the merge?

<details>
<summary><b>Reveal: merge rules and the algorithm</b></summary>

**The merge policy (take a stance, defend it):**

For overlapping SKUs, the right default is **max(anonymous_qty, account_qty)**, not sum.

If a user added 2 of SKU A on their phone (anonymous), and they remembered they already had 1 in their account cart from yesterday, they almost certainly wanted "make sure I have 2", not "I want 3". Summing surprises users; max is conservative. The exception: items that are explicitly additive (digital downloads, gift cards) sum, but those are special-cased per category.

Some teams choose "anonymous wins" (overwrite account with the just-built session). Defensible: the user's most recent intent is most accurate. Easier to explain. But you lose items from the older session that the user still wanted.

Whichever you pick, write it down user-visible: "We combined your guest cart with your saved cart." Surface what changed.

**The full algorithm:**

```python
def merge_carts(anonymous_token, user_id):
    """Called on successful login when an anonymous cart_token cookie is present."""
    with db.transaction():
        anon_cart = cart_store.get_by_token(anonymous_token)
        user_cart = cart_store.get_by_user(user_id)

        if anon_cart is None:
            return user_cart

        if user_cart is None:
            cart_store.rebind(anon_cart.id, user_id=user_id, clear_token=True)
            audit_merge(user_id, anon_cart.id, source="rebind")
            return cart_store.get_by_user(user_id)

        merged_items = {}
        for sku, item in user_cart.items.items():
            merged_items[sku] = item.copy()

        for sku, anon_item in anon_cart.items.items():
            if not catalog.is_available(sku):
                continue
            if sku in merged_items:
                merged_items[sku].qty = max(anon_item.qty, merged_items[sku].qty)
                merged_items[sku].qty = min(merged_items[sku].qty, MAX_QTY_PER_ITEM)
            else:
                merged_items[sku] = anon_item

        if len(merged_items) > MAX_CART_ITEMS:
            merged_items = trim_to_limit(merged_items, MAX_CART_ITEMS)

        cart_store.replace(user_cart.id, merged_items)
        cart_store.delete(anon_cart.id)
        audit_merge(user_id, anon_cart.id, source="merge",
                    rules={"qty": "max", "trimmed": ...})

        return cart_store.get_by_user(user_id)
```

**Key details:**

1. **Idempotency.** A user might double-click "Log in". The merge endpoint must be idempotent: if the anonymous cart has already been consumed, the second call is a no-op. Achieve this by checking `anon_cart is None` early; clear the cart_token cookie after the first merge.

2. **Audit trail.** Insert a row into `carts_merged` capturing `(merge_id, user_id, anonymous_token, anonymous_items, account_items, merged_items, rule_applied, occurred_at)`. Rescues you from "my cart is wrong after I logged in" support tickets.

3. **Cookie cleanup.** After merge, clear the `cart_token` cookie (`Set-Cookie: cart_token=; Max-Age=0`). Otherwise the next page load attempts to merge again.

4. **Discontinued items.** Skip them silently in the merge, but surface a banner: "Some items in your guest cart are no longer available."

5. **Size limit.** A user with 80 items in their account cart and 80 in their guest cart blows the 100-item limit. Trim with a deterministic rule (favor most-recently-added) and tell them.

6. **Race condition.** User logs in on two devices nearly simultaneously. Both call merge. Solve with a unique `cart_token` value: the first merge consumes the token (delete row), the second finds nothing to merge.

**Common mistake:** doing the merge client-side. The client can't be trusted; it doesn't see the account cart history; it can't enforce limits. The merge must be a single server-side operation in one transaction.

</details>

## Step 6: inventory consistency

The cart shows "in stock" when the user adds an item. Twenty minutes later, they click checkout. The item is gone. Or worse: the user successfully checks out, takes payment, and then your warehouse tells you there's no shoe to ship.

Three approaches. None of them is perfect.

**A. No reservation (optimistic).** The cart shows the last-known inventory state. Checkout re-checks. If gone, surface "this item is no longer available" and require the user to adjust their cart.

**B. Soft reservation with TTL.** Adding to cart places a temporary hold on the inventory (15 minutes). If the user doesn't check out, the hold expires and the inventory is released. If they do check out, the hold is converted to a permanent commitment.

**C. No checks at all (overselling accepted).** Take the order. Charge the card. If the warehouse can't fulfill, refund and apologize.

For each approach, walk through:
- What does the user experience look like in the common case?
- What goes wrong in the rare case?
- What does this cost engineering-wise?
- For what kind of business is each appropriate?

<details>
<summary><b>Reveal: the comparison and recommended approach</b></summary>

| Approach | Common case | Rare case | Engineering cost | Right for |
|----------|-------------|-----------|------------------|-----------|
| Optimistic (re-check at checkout) | Cart shows available; checkout succeeds. | Cart says available but item ran out between add and checkout. User sees "no longer available", has to remove and retry. ~1-3% of checkouts in normal commerce; higher on hot drops. | Low. No write to inventory at cart time. Just a read. | Most general-purpose e-commerce. Default choice. |
| Soft reservation (TTL hold) | Add to cart, item is reserved for 15 minutes. Checkout converts hold to commit. User never sees "out of stock" mid-checkout. | If user abandons, hold expires and other users see the item again. Inventory shows artificially low during the hold window. Hot products get worse: many holds, real users locked out. | High. Inventory service must support holds with TTLs. State synchronization. Holds must be released on cart deletion, item removal, hold expiry, and checkout failure. | Live-event ticketing, limited drops (sneakers, concerts), B2B carts where checkout is a multi-step approval. |
| No checks (oversell, refund later) | Always succeeds at checkout. Warehouse fulfills or doesn't. | Customer gets an "out of stock, refund issued" email the next day. Brand damage, support cost, possibly chargebacks. | Almost zero from the cart's perspective. | Pre-orders. Print-on-demand. Anything with effectively infinite supply. |

**The recommendation: optimistic with TTL holds only for explicitly-marked SKUs.**

The default is optimistic. The cart reads inventory at add-time (green check) and again at cart-page-load (refreshes the badge). At checkout, the order service does the authoritative re-check and atomic deduction.

For high-contention SKUs (limited drops, event tickets), the catalog marks the SKU as `requires_reservation=true`. The cart calls the inventory service to place a TTL hold; the hold token is stored in the cart_item row. If the user removes the item or the hold expires, the cart releases the hold. This adds engineering cost only where it earns its keep.

**Why not soft-reservation by default.** Every cart abandonment becomes an artificial inventory shortage. Industry average is 60-70% abandonment. If every add-to-cart held inventory for 15 minutes, you'd show "out of stock" to many real buyers while ghost carts sit on the inventory. Right behavior for a Taylor Swift concert (limited supply, high intent). Wrong for shoes (deep supply, casual browsing).

**Why not overselling by default.** Refunds and "we can't fulfill your order" emails destroy customer trust quickly. Only acceptable when supply is genuinely unlimited (digital goods, print-on-demand) or when over-commitments are expected (airline overselling).

**Where the check actually happens:**

- **On add-to-cart:** read-only check against the Inventory Service. Display state to user. No writes.
- **On cart load:** re-check (cached briefly, ~30s). User sees current state.
- **On checkout:** authoritative. Order service places an atomic `try_reserve(sku, qty)` against inventory. This is a *write*. If it fails, the order doesn't complete.

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

A shopping cart is a per-user state store. What makes it interesting is not the throughput (it's tiny) but three judgment calls: where the state actually lives (cookie, server, both), what happens when a guest cart meets a logged-in cart at login, and how you show "in stock" honestly when inventory moves by the second.

The design starts as one Postgres table behind a stateless service. Once dashboard reads start showing up in your slow query logs, you put Redis in front of it. Events flow to Kafka for the people downstream who care: abandoned-cart emails, analytics, recommendations. Cart writes stay tiny even at a million users. The actual hot path is the cart-icon count that loads on every page and the inventory fan-out on every cart view.

The interesting engineering lives at the edges. Merging an anonymous cart into an account cart with a sensible quantity rule. Picking between optimistic and reservation-based inventory checks. Handling price drift between add-time and checkout-time without breaking trust or breaking the law. And quietly garbage-collecting the millions of abandoned carts nobody is ever coming back to.

### 1. The clarifying questions that mattered

Of the eight from `question.md`, two reshape the design: inventory accuracy (optimistic, reservation, or no-check?) and multi-device sync (does the cart need to follow the user across devices?). Skip either and the first follow-up question will catch you out.

### 2. Capacity, with the math

**Small startup, 500 DAU.** 30% conversion gives you 150 carts a day. About six an hour. Edits push it to roughly 300 writes a day. Cart-icon reads run around 5000 a day. Active carts at any moment: maybe 50. Storage after a year: ~33MB.

A single Postgres handles this with two orders of magnitude to spare. A laptop running locally would handle it.

**One million DAU.** 300k carts created a day, sustained 3.5/sec, peak 10/sec. Edits push writes to ~7/sec sustained, 21/sec peak. Cart-icon reads jump to ~115/sec sustained, 350/sec peak. Active carts at any moment: ~25k. Storage at 30-day retention: ~7GB live. Inventory check load at peak: ~400/sec.

A few things jump out. Writes are still tiny even at a million users; Postgres handles 20 writes/sec without breathing. Reads beat writes 20-to-1, and the cart-icon on every page is the read that matters. The 25k active carts fit in Redis with room to spare (about 5MB). And the real bottleneck isn't the cart at all; it's the inventory service getting hammered on every cart load.

### 3. API

The shape that carries the whole product.

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

```
POST /api/v1/cart/items
Idempotency-Key: <uuid>
{ "sku": "shoe-blue-42", "qty": 1 }
```

| Status | Meaning |
|--------|---------|
| 201 | Item added |
| 200 | Item already in cart, qty increased |
| 400 | qty out of range, sku malformed |
| 404 | SKU does not exist |
| 409 | SKU restricted (region, age) |
| 410 | SKU discontinued |
| 422 | Cart at size limit (100 items) |

```
PATCH /api/v1/cart/items/{sku}      # qty: 0 removes
DELETE /api/v1/cart/items/{sku}
POST /api/v1/cart/merge             # called on login, body: {"anonymous_token": "<uuid>"}
POST /api/v1/cart/checkout          # returns a checkout session, not an order
```

The checkout response gives you a session id and a frozen snapshot good for 15 minutes. The actual order is created by a different service when payment clears.

A handful of choices that look small but aren't:

Idempotency-Key on writes is required. Mobile retries on a flaky network and double-tapping "Add" without an idempotency key gets you qty 2 when the user wanted 1.

`GET /cart` returns hydrated data. The cart service joins the bare cart (SKU + qty) with the catalog (name, image, current price) and inventory (availability) server-side. Never push that join to the client.

Both snapshot price and current price come back on every read. The snapshot is what they saw when they added; the current price is what they pay. UI shows current; analytics needs the diff.

Checkout returns a session, not an order. The cart only clears once the checkout/payment service confirms conversion.

### 4. Data model

Three tables. Two operational, one for audit.

```sql
-- One row per cart. A user has at most one active cart.
CREATE TABLE carts (
    cart_id          UUID PRIMARY KEY,
    user_id          BIGINT,                       -- NULL for anonymous
    cart_token       UUID,                         -- non-NULL for anonymous
    status           SMALLINT NOT NULL DEFAULT 1,  -- 1=active, 2=converted, 3=abandoned, 4=expired, 5=merged
    item_count       INT NOT NULL DEFAULT 0,       -- denormalized for fast cart-icon reads
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ,                  -- 30 days from last update
    CHECK ((user_id IS NULL) <> (cart_token IS NULL))   -- exactly one is set
);

CREATE UNIQUE INDEX idx_carts_user ON carts (user_id) WHERE status = 1 AND user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_carts_token ON carts (cart_token) WHERE status = 1 AND cart_token IS NOT NULL;
CREATE INDEX idx_carts_expires ON carts (expires_at) WHERE status = 1;
CREATE INDEX idx_carts_abandoned ON carts (updated_at) WHERE status = 1;

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

CREATE INDEX idx_cart_items_sku ON cart_items (sku);

-- Audit table for merges. Saves you from support tickets.
CREATE TABLE carts_merged (
    merge_id          UUID PRIMARY KEY,
    user_id           BIGINT NOT NULL,
    anonymous_token   UUID,
    anonymous_items   JSONB NOT NULL,
    account_items     JSONB NOT NULL,
    merged_items      JSONB NOT NULL,
    rule_applied      TEXT NOT NULL,              -- "qty:max" | "anon_wins" | "rebind"
    trimmed_items     JSONB,                      -- if size-limit forced drops
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merged_user ON carts_merged (user_id, occurred_at DESC);
```

A few choices worth defending:

The CHECK constraint that exactly one of `user_id` or `cart_token` is set keeps the model honest. A cart is either anonymous or owned by a user. After merge, the anonymous row is deleted; never demoted.

`item_count` is denormalized on the carts row because the cart-icon on every page only needs the count. One row read instead of a JOIN. Updated in the same transaction as item changes, so it never drifts.

`snapshot_price_cents` lives on cart_items, not carts. Each item snapshots its price at add time. The cart total is computed at checkout; never stored stale.

`carts_merged` is the table that saves you when a user emails support saying "my cart disappeared after I logged in." Query by user_id and you can reconstruct exactly what happened.

Postgres, not DynamoDB or Cassandra. Merging two carts is one transaction. Removing an item and releasing its hold is one transaction. The data volume is small. ACID matters here; Postgres gives you all of it.

### 5. Architecture

Here's the whole picture on one screen.

```
                Client (web, mobile)
                        |
                        v
                ┌──────────────────┐
                │  API Gateway     │  TLS, auth, rate limit,
                │  + Auth          │  anonymous cart_token cookie
                └────────┬─────────┘
                         |
                         v
                ┌──────────────────┐
                │  Cart Service    │  stateless pods
                │                  │  merge logic, size limits,
                │                  │  price snapshot
                └──┬──────┬──┬─────┘
                   |      |  |
            read   |      |  | emit events
                   v      |  |
            ┌──────────┐  |  |
            │  Redis   │  |  |  cart:user:{uid} -> hash
            │  (active │  |  |  TTL 30 days
            │  carts)  │  |  |
            └─────┬────┘  |  |
                  | write |  |
                  | through  |
                  v       v  |
            ┌────────────────┐|
            │  Postgres      ||  carts, cart_items,
            │  (source of    ||  carts_merged
            │   truth)       ||
            └────────────────┘|
                              |
                              v
                       ┌──────────────┐
                       │  Kafka       │  cart.item.added
                       │  cart.*      │  cart.item.removed
                       │              │  cart.merged
                       │              │  cart.abandoned
                       └──────┬───────┘
                              |
                +-------------+------------+----------+
                v             v            v          v
        ┌────────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐
        │ Abandoned  │ │ Analytics  │ │ Recs    │ │ Fraud    │
        │ cart       │ │ (ClickHouse│ │ engine  │ │ detection│
        │ emails     │ │  funnel)   │ │         │ │          │
        └────────────┘ └────────────┘ └─────────┘ └──────────┘

       Sync calls out:
                ┌─────────────────┐
                │ Inventory       │  is SKU X available in qty Y?
                │ Service         │  cart asks on add and on read
                └─────────────────┘
                ┌─────────────────┐
                │ Catalog /       │  name, image, current price
                │ Pricing Service │
                └─────────────────┘
```

A few things worth noticing.

The cart service never writes to inventory. It only reads. The authoritative inventory deduction happens at checkout, in a different service. This separation is what lets you survive an inventory outage without breaking the add-to-cart button.

Catalog and inventory are called in parallel on cart read. The latency floor is `max(catalog, inventory)`, not the sum.

Redis holds the small, slowly-changing part: SKU + qty + snapshot_price + hold_token. Catalog and inventory results are *not* cached in the cart's Redis entry. They change too fast and have their own caches in their respective services.

Notifications, analytics, recommendations all sit downstream of Kafka. If the notifier is down, carts still work; the emails just queue up.

### 6. What an add looks like, end to end

```
   Client      Gateway      Cart Svc     Catalog     Inventory     Postgres     Redis      Kafka
     |            |            |            |            |            |          |          |
     | POST /items|            |            |            |            |          |          |
     +----------->|            |            |            |            |          |          |
     |            | idempotency|            |            |            |          |          |
     |            +----------->|            |            |            |          |          |
     |            |            | validate sku & price    |            |          |          |
     |            |            +----------->|            |            |          |          |
     |            |            |<-----------+            |            |          |          |
     |            |            | check availability      |            |          |          |
     |            |            +------------------------>|            |          |          |
     |            |            |<------------------------+            |          |          |
     |            |            |  (if requires_reservation: place_hold)         |          |
     |            |            |                                                            |
     |            |            | BEGIN TX                             |          |          |
     |            |            +------------------------------------->|          |          |
     |            |            | INSERT cart_items ON CONFLICT ...    |          |          |
     |            |            | UPDATE carts SET item_count += ?     |          |          |
     |            |            | COMMIT                               |          |          |
     |            |            |<-------------------------------------+          |          |
     |            |            |                                                            |
     |            |            | HSET cart:user:{uid}                 |          |          |
     |            |            +------------------------------------------------>|          |
     |            |            |                                                            |
     |            |            | emit cart.item.added                                       |
     |            |            +----------------------------------------------------------->|
     |            | 201 OK     |                                                            |
     |            |<-----------+                                                            |
     | 201 OK     |            |                                                            |
     |<-----------+            |                                                            |
```

Reads look much shorter. Gateway routes to Cart Service, Redis hit returns the bare cart in single-digit ms, then catalog and inventory get called in parallel for hydration. Cold miss falls through to Postgres and repopulates Redis on the way back.

Target latencies: cart-icon count P99 ~20ms (this runs on every page; keep it lean). Full cart read P99 ~80ms (most of the time is in the parallel hydration). Add item P99 ~150ms (bottleneck is the inventory round-trip).

### 7. The merge problem

This is the part most candidates flunk. A guest user adds three items over twenty minutes, then logs in and discovers they already had two items in their account cart from a session two days ago. What's the merged result?

The right default is **max(anonymous_qty, account_qty) per overlapping SKU**, not sum. If a user added 2 of SKU A on their phone (anonymous) and they had 1 in their account cart from yesterday, they almost certainly meant "I want 2", not "I want 3". Summing surprises users; max is conservative. The exception is explicitly additive items (digital downloads, gift cards), which sum and are special-cased per category.

Some teams pick "anonymous wins" instead. Defensible: the most recent intent is most accurate. Easier to explain. But you lose items from the older session that the user still wants. Whichever you pick, show the user what happened: "We combined your guest cart with your saved cart."

```python
def merge_carts(anonymous_token, user_id):
    with db.transaction(isolation="serializable"):
        anon_cart = db.fetch_cart(cart_token=anonymous_token, lock_for_update=True)
        user_cart = db.fetch_cart(user_id=user_id, lock_for_update=True)

        if anon_cart is None:
            return user_cart

        if user_cart is None:
            # Just rebind the anonymous cart to the user.
            db.update(anon_cart.id, user_id=user_id, cart_token=None, updated_at=NOW())
            audit_merge(user_id, anonymous_token, [], anon_cart.items, anon_cart.items, "rebind")
            invalidate_redis_keys(anonymous_token, user_id)
            emit_event("cart.merged", ...)
            return db.fetch_cart(user_id=user_id)

        # Both exist. Merge with max-qty.
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
        db.delete(anon_cart.id)
        audit_merge(user_id, anonymous_token, user_cart.items, anon_cart.items,
                    list(merged.values()), "qty:max", trimmed=trimmed)
        invalidate_redis_keys(anonymous_token, user_id)
        emit_event("cart.merged", ...)
        return db.fetch_cart(user_id=user_id)
```

Three things make this safe:

Serializable isolation means two simultaneous merges of the same anonymous cart can't both succeed. The second finds the anon cart already deleted and returns the user cart unchanged. Double-clicking "Log in" is a no-op the second time.

The audit row always gets written. Whether rebind, merge, or no-op, you capture what happened. Storage is cheap; support tickets are not.

The cookie gets cleared after merge (`Set-Cookie: cart_token=; Max-Age=0`). Otherwise the next page load tries to merge again and finds nothing to do, but generates noise in your logs.

The classic mistake is doing the merge client-side. The client can't be trusted, doesn't see the account cart history, and can't enforce limits. The merge has to be one server-side transaction.

### 8. Inventory consistency

Three approaches, none of them perfect.

**Optimistic (re-check at checkout).** Cart shows the last-known state. Checkout does the authoritative re-check and atomic deduction. Common case: works fine. Rare case: 1-3% of checkouts hit "no longer available" between cart and pay. Engineering cost: low. Right for: most general-purpose e-commerce.

**Soft reservation with TTL.** Adding to cart places a 15-minute hold on inventory. Checkout converts it to a permanent commitment; abandonment releases it. Common case: user never sees "out of stock" mid-checkout. Rare case: hot products show artificially low inventory because ghost carts hold them. Engineering cost: high (inventory service needs hold/release/expire logic). Right for: limited drops, event tickets, B2B with multi-step approvals.

**No checks (oversell, refund later).** Always succeeds at checkout. Warehouse figures it out. Common case: fast. Rare case: "we couldn't fulfill, here's a refund" email destroys customer trust. Right for: pre-orders, print-on-demand, anything with effectively infinite supply.

The recommendation: **optimistic by default, reservation only for explicitly-marked SKUs.** The cart reads inventory at add-time (green check), again on cart load (refresh badge), and the order service does the authoritative reserve at checkout. For SKUs the catalog flags `requires_reservation=true` (limited sneaker drops, concert tickets), the cart places a TTL hold and stores the `hold_token` on the cart_item row.

Why optimistic by default: industry abandonment rates run 60-70%. If every add-to-cart held inventory for 15 minutes, you'd show "out of stock" to real buyers while ghost carts sit on the inventory. Right for a Taylor Swift concert. Wrong for shoes.

The point most candidates miss: the cart's job is to show good information, not to guarantee the user gets the item. That guarantee belongs at checkout.

### 9. Scaling journey: 10 to 1M users

The part interviewers care about most. Build nothing preemptively. Name what just broke and what fixes it.

**Stage 1: 10 to 100 users.** One Postgres, one app server. The cart and the product catalog are the same app. Anonymous carts use a `cart_token` cookie pointing at a row. No Redis, no Kafka, no abandonment emails. Inventory check is a SELECT against the products table. About $30/month. You ship in three days.

You see ten carts a day. Postgres yawns. Anything more is over-engineering.

**Stage 2: 1k users.** Marketing wants abandoned-cart emails (highest-ROI campaign in e-commerce). The catalog is big enough to deserve its own service. People add things on their phone and want to see them on their laptop.

Split inventory and catalog out as separate services. Implement the login-time merge endpoint and the `carts_merged` audit table. Add a nightly cron job that finds carts inactive >6h and enqueues an email via the email service (a simple `pending_emails` table polled by a worker; no Kafka yet). Enforce cart size limits (100 items, 99 qty). About $150/month.

Still no Redis. Postgres handles all reads with one read replica added. Still no Kafka. The polled events table is fine at this scale.

**Stage 3: 100k users.** Several things break at once. Cart-icon reads (~12/sec) start showing up in slow query logs. Cart-page-load latency creeps up because each load joins with the catalog over HTTP for 5+ items. One day inventory has a 30-second blip and every cart add fails because you were blocking on it. A flash sale on a limited-edition sneaker shows "available" to 5000 users when you only have 100 pairs.

Fixes, in order: Redis as cart cache (active carts live as a hash per user, write-through, 95%+ hit rate). Inventory check becomes best-effort with graceful degradation (timeout falls back to "show as available, re-check at checkout"). Reservation-only-for-special-SKUs (catalog flags it, cart places hold). Kafka replaces the polling pattern. Postgres read replica for cart reads on miss. Nightly GC job deletes anonymous carts past their expiry. About $1-2k/month.

**Stage 4: 1M users.** New problems: you need HA on Redis (a single-node outage means 25k empty carts and angry customers). Write contention on the `carts` row's item_count update is occasionally surfacing. A scraper-bot adds 50 items/sec across thousands of anonymous carts and melts the inventory service. You expand to a European region. Customers complain about price drift legally (some jurisdictions require notification).

Shard Redis by `hash(user_id) % N` with 1 primary + 1 replica per shard. Logically shard Postgres by user_id (not physically yet; load doesn't demand it). Regional deployment for EU with local Redis and Postgres replica; writes still go to US primary. Async checkout pipeline (cart emits `cart.checkout_started` with a frozen snapshot; order service does payment + atomic reserve; user polls). Rate limit add-to-cart per IP and per cart_token. Price drift policy: if any item's current price differs from snapshot by >10% or >$5, the checkout response shows a banner and the user must explicitly confirm. About $10-20k/month.

The cart itself is comfortable at this point. The new bottleneck is inventory, which has its own scaling story.

**At 10M+ users.** Honestly, the cart's architecture stops evolving. 16 or 32 Redis shards, physical Postgres sharding by user_id, the cart team becomes its own service team. The action moves to inventory, checkout, fulfillment, personalization. The cart stops being the most interesting system in the building.

### 10. Reliability

Redis dies mid-cart. Two flavors. A single shard fails over to replica in ~10s; cart reads for affected users go to Postgres (slow but works), writes queue and retry. Entire cluster down: cart falls through to Postgres for every read at ~80ms instead of ~5ms. Users notice slightly slower page loads; nobody notices missing carts because Postgres is the source of truth.

Postgres primary dies. Standard failover (30-60s). Writes return 503 with `Retry-After` during the window. Reads continue from replicas. After recovery, queued writes retry.

Inventory service down. Cart shows last-known availability or "we'll confirm at checkout." Cart adds proceed. The risk is more "out of stock at checkout" surprises, acceptable for the duration of an outage.

Checkout starts but payment fails. The order service handles it; the cart does *not* clear until it receives a `cart.converted` event. If payment fails, the order service emits `cart.checkout_failed`, any inventory holds are released, and the user can edit and retry.

Race: user removes an item while checkout is starting. Checkout took a frozen snapshot of the cart. The removal hits the live cart but doesn't affect the in-flight checkout. If checkout succeeds, the snapshot items are deducted; the cart's current state (minus what was bought) remains for further shopping.

Network partition between regions. EU cart reads continue from EU replica (stale by a few seconds). EU writes queue locally and retry; if the partition lasts more than a minute, surface "we're having trouble saving your cart."

### 11. Observability

| Metric | Why it matters |
|--------|----------------|
| `cart.read.p99` regional | Headline SLO for cart-page-load |
| `cart.write.p99` | Spike = DB contention is back |
| `cart.icon_count.p99` | Even tighter SLO; runs on every page |
| `cart.redis.hit_rate` | Should be >95%; drop = repopulation storm or shard imbalance |
| `cart.merge.rate` | Sudden spike = someone broke auth (re-merging on every request) |
| `cart.merge.size_trimmed.rate` | Often non-zero = raise the size limit |
| `inventory.timeout.rate` | Drives the fallback path |
| `cart.checkout_started.rate` | Conversion funnel |
| `cart.abandonment.rate` | Marketing's headline; alert on big jumps |
| `cart.size.p99` | Detects bot-stuffed carts; alert if p99 > 50 items |
| `cart.add.rate_limit_hits` | Bot detection signal |
| `cart.price_drift.acknowledgements` | Compliance + customer experience |
| `kafka.cart_events.lag` | If this lags, abandonment emails stop arriving |
| `db.replication_lag.p99` | Read replicas must stay <1s |

Page on: cart.read.p99 > 200ms for 5min, redis.hit_rate < 80% for 5min, kafka.lag > 5min, cart.write error rate > 2%. Ticket on: merge.rate or size_trimmed.rate sudden spike, inventory.timeout.rate > 5%.

### 12. Gotchas the senior interviewer is listening for

**Abandonment timezones.** "After 6 hours of inactivity" runs in UTC, never in the user's local time. Daylight savings transitions otherwise double-email or skip users. Store `updated_at` as TIMESTAMPTZ; compute "6 hours ago" in UTC.

**Cart bloat from edge cases.** Coupon spam, bot-adds, scrapers. Hard size limits (100 items, 99 qty). Per-IP and per-cart_token rate limits on add. Surface `cart_full` as 422.

**Bot carts skewing analytics.** A scraper that opens 10k anonymous carts daily pollutes your "average cart size" metric. Flag carts where `cart_token` was created but never accessed from a real session. Exclude from headline metrics.

**Price drift.** Show both prices in the UI. At checkout, if the difference exceeds the threshold, require explicit acknowledgement. Record it in audit. EU consumer law requires this; other jurisdictions may too.

**Currency mismatch.** User in USD adds an item, switches to EUR. Re-display in EUR with current FX. Snapshot stays in original; display computes converted. Never silently change the expected total.

**Restricted items at checkout.** Item legal at add-time becomes restricted (regulation change, shipping address differs). Order service re-validates against shipping rules; restricted items surface as "cannot ship; remove or change address."

**Multi-tab edits.** ETags on cart responses; PATCH includes `If-Match`. Conflicts return 409 with the latest cart. UI shows "your cart was updated elsewhere."

**Anonymous cookies that never die.** Browser keeps `cart_token` forever. After 30 days the cart is gone but the cookie still points at nothing. On read, treat "cookie present, no row" as "issue a new token." Don't surface an error.

**Decimal places.** Integer cents everywhere internally. Never store `9.99` as a float. Floats break promo math eventually.

**Migration from a legacy cart system.** Run dual-write during migration; resolve conflicts user-by-user with a written rule.

### 13. Follow-up answers

**1. Cart bloat from bots.** Symptoms: a single anonymous cart with 10k items, or a cart that does add/remove/add/remove at 50/sec.

Layered defenses: per-cart size limit (100) as a 422, per-qty limit (99), rate limit on `POST /cart/items` (30/min per IP, 60/min per authenticated user; configurable up for legit B2B bulk-add), WAF rules at the edge for obvious bot user-agents, bot detection (anonymous carts from IPs that never load a product page get shorter TTL).

For determined attackers, nothing in the cart layer alone stops them. Push detection upstream: CAPTCHA on suspicious checkout patterns, account-level fraud detection.

**2. Multi-device sync delay.** Phone's add writes to Redis + DB. Both reflect immediately. Laptop's next page load sees the new state. No push to laptop; the user has to interact. If they have the cart page open on laptop, they see stale data until they refresh.

To make it live: WebSocket subscription per user pushing cart-change events. Cost: more infrastructure for a marginal UX win. Most e-commerce skips it.

Acceptable latency: visible on next page load. Sub-100ms after request reaches Redis.

**3. Redis dies mid-cart.** Entire cluster down for 5 minutes during peak.

User experience: first cart-load after Redis dies fetches from Postgres at ~50ms instead of ~10ms. User doesn't notice. Cart writes continue normally (DB first, Redis update silently fails; next read repopulates). Once Redis is back, first cart-load for each user repopulates the hash. Cold start; ~30s to warm up to normal hit rate.

Internally: circuit breaker switches to "DB-only" mode after N consecutive Redis failures. Re-probes periodically. Metric `cart.redis.hit_rate` drops to 0 during the outage; alerts fire.

What you do *not* do: try to serve stale data from somewhere else. The DB is truth. Redis is purely an accelerator.

**4. Price drift.** User added at $50 last week. Today's price is $55.

Cart page: shows current ($55) with "was $50 when added." Total uses current prices. At checkout: response returns live total. If any item's difference exceeds threshold (10% or $5), response includes `price_change_required_acknowledgement: true`. UI shows a banner. User clicks "Confirm changes", second checkout call carries `price_change_acknowledged: true`. Audit row captures original snapshot and confirmed current price.

What they pay: always current. The snapshot is informational and audit-only. The exception is "price guarantee" promotions, which are a separate feature with their own tracking.

**5. Cart abandonment detection.** Naive: scan all carts every minute where `status = active AND updated_at < NOW() - 6h`. At 100k+ active carts that's slow.

Right approach: time-window batching.

```sql
SELECT cart_id, user_id FROM carts
WHERE status = 1
  AND user_id IS NOT NULL
  AND updated_at >= NOW() - INTERVAL '6 hours 15 minutes'
  AND updated_at <  NOW() - INTERVAL '6 hours'
  AND NOT EXISTS (SELECT 1 FROM cart_abandonment_emails WHERE cart_id = carts.cart_id);
```

Finds carts that just crossed the 6-hour threshold in this 15-minute job run. Touches a small slice. Index on `(status, updated_at)` is the partial index that supports it. For each result, emit `cart.abandoned` to Kafka; notification service consumes and sends. Record in `cart_abandonment_emails` for dedup.

At scale, swap the SQL for a Redis sorted set of `cart_id` by `updated_at`, zrange-pop expired entries every minute. More efficient, more moving parts.

**6. Anonymous cart TTL and the returning user.** Anonymous carts get 30-day TTL. Nightly GC:

```sql
DELETE FROM carts WHERE status = 1 AND user_id IS NULL AND expires_at < NOW();
```

User comes back after 90 days with their old `cart_token` cookie. Lookup returns nothing. Cart Service issues a new token, sets the cookie, returns an empty cart. No error.

If they log in: nothing to merge; account cart loads normally.

**7. Shared account, simultaneous edits.** Two people on the same account, both adding items.

Both sessions resolve to the same `cart_id` via the unique index on `user_id WHERE status = 1`. Adds use `INSERT ON CONFLICT (cart_id, sku) DO UPDATE SET qty = qty + ?`. Concurrent adds for the same SKU sum correctly (each is an explicit user action; sum is the right rule here, unlike merge). Removes use straight DELETE; race resolves to first-wins, second sees zero rows. `carts.item_count` is updated in the same transaction. Both users see each other's edits on their next page load.

No real-time push by default. If you want it, WebSocket per session subscribed to `cart:{user_id}` events. Niche feature.

**8. Currency and locale.** Cart stores `sku`, `qty`, and `snapshot_price_cents` in the original transaction currency. Catalog returns prices in a configurable currency at hydration time.

User switches locale: cart's display recomputes against the current currency's prices (catalog refreshes FX hourly). Snapshot stays in original; displayed prices change. UI shows "Prices shown in EUR; original prices were in USD." At checkout, user is charged in the currently-displayed currency. Order record captures both for accounting.

**9. Item becomes restricted before checkout.** User added vape juice (legal at add-time). Their state passed a regulation; item is no longer shippable to their ZIP.

At cart load: catalog/inventory returns availability as `restricted_in_region`. Cart Service displays the item with "cannot ship to your address" badge; checkout button disabled until removed. At checkout, if the user bypassed: Order Service re-validates each item against the shipping address. Restricted items return in the error; checkout fails atomically; no payment attempted.

User sees: "Some items in your cart cannot be shipped to this address. Remove them or change your address."

**10. Save for later.** "Move to wishlist" belongs to a separate Wishlist Service. The cart holds items the user intends to buy; the wishlist holds items they want to remember.

The interaction: UI button calls `POST /wishlist/items {sku}` then `DELETE /cart/items/{sku}`. Two calls, not atomic. If wishlist add succeeds but cart delete fails, the item is in both places (annoying, not broken). UI retries the cart delete in the background.

Alternative: single `POST /cart/items/{sku}/move_to_wishlist` endpoint that does both. More cohesive UX; couples the two services. Fine for a small site; large sites usually own the two services separately and stick with the two-call dance.

### 14. Trade-offs worth saying out loud

**Cookie vs DB vs Redis.** Cookie alone is too small and doesn't sync. In-memory session doesn't scale past one server. DB alone gets slow on cart-icon reads at scale. Redis+DB is the right combination once DB reads become noticeable. Start with DB-only; add Redis when metrics demand it. Never start with Redis-only because you lose durability.

**Eager vs lazy inventory check.** Eager (reservation on add) burns inventory headroom for ghost carts. Lazy (re-check at checkout) sometimes disappoints users at the last step. Default lazy; eager only for explicitly-marked SKUs. Mixing the two by SKU is the senior answer.

**Sync vs async checkout.** Sync is simpler but couples cart latency to all downstream systems. Async absorbs spikes and isolates failure modes; trade-off is a worse UX (the "processing" page). At small scale sync is fine; at Black Friday scale async is required.

**Why one cart per user, not many.** Some sites support multiple carts ("birthday cart", "work cart"). Adds significant complexity (which is active? merge across them? share with family?). Don't build it until customers ask. Most never ask.

**Why Postgres, not NoSQL.** ACID for merge and add-on-conflict; analytical queries for abandonment; small data volume. Postgres covers all three. DynamoDB would force you to build your own transaction layer for merge and your own scan layer for abandonment.

**What you'd revisit at 10M+ users.** Physically shard Postgres by user_id. Move from Redis-as-cache to Redis-as-source-of-truth for active carts with periodic flushes to durable store. Push cart logic to the edge (CDN-near workers) for sub-50ms global cart reads. Pre-aggregate the abandonment funnel in ClickHouse so the cart service doesn't power analytics queries directly.

### 15. Common interview mistakes

**"Just store the cart in localStorage."** Misses multi-device sync, bot/scraper concerns, the merge problem on login. Fine for the smallest sites; loses you the design problem.

**One unified cart for anonymous and logged-in with magical "user_id might be null" everywhere.** The two flows have different lifecycles, different TTLs, different sync requirements. Model both explicitly; merge is its own operation.

**No discussion of merge.** Second-most asked follow-up after inventory. Walk in with a stance: max-qty, audit row, idempotent, single transaction.

**"We'll reserve inventory on add to cart."** A common junior answer. Then the interviewer asks about 60-70% abandonment, ghost holds, and your design unravels. The right answer is "optimistic by default, reservation only for special SKUs."

**Ignoring price drift.** "Whatever was in the cart is what they pay" is wrong and sometimes illegal. Snapshot vs current, surface the difference, require acknowledgement at the threshold.

**Putting checkout in the cart service.** Checkout is its own service: payment, address validation, atomic inventory reserve, order creation, post-purchase events. Cart hands off via a frozen snapshot.

**Forgetting the cart-icon read.** Every page loads the cart count. That single endpoint dominates QPS. Optimize it (denormalized `item_count`, Redis cache, ~20ms p99).

**Treating the cart as a synchronous coupling to inventory.** If inventory is down, cart adds shouldn't fail. Show a fallback badge; let checkout do the authoritative check.

**Designing for huge write throughput.** Even at 1M DAU you see ~20 writes/sec. Don't propose Cassandra or Spanner because "carts are write-heavy." They aren't.

**No audit trail on merge.** Without `carts_merged`, every "my cart is wrong" support ticket is unsolvable. Cheap to add; the data is irreplaceable.

If you can hit seven of these ten, you're interviewing at senior level. The three most senior signals: a confident merge policy, optimistic-by-default inventory with named exceptions, and explicit handling of price drift. Those three separate a thoughtful cart design from a generic CRUD answer.
{% endraw %}
