# 1. Deliver new alerts over SSE (no Durable Object, fetch-based client)

- Status: Accepted
- Date: 2026-07-22

## Context

The station dashboard shows the most recent alerts for an organization. Today
the SPA (`src/views/HomeView.vue`) discovers new alerts by **polling**
`GET /api/org/:key/alerts` on a fixed `setInterval` (default 30s). New alerts are
produced out of band by `AlertWorkflow` (email → generate text → TTS → R2 →
insert row); the client only learns an alert exists on its next tick.

The concrete use case is an **in-station audio dashboard**: a single, always-on,
always-focused kiosk per station whose job is to *speak* new alerts as they
arrive. It is not a per-person notifier — staff notifications are handled by a
separate application. That shape has two consequences:

- Worst-case latency of a full poll interval (~30s) is poor for an audio
  dispatch aid.
- There is exactly one long-lived client per station, so "many clients hammering
  the database" is a non-issue, and a persistent connection is the natural fit.

The overriding selection criterion the maintainer chose was **billing impact**.
The app runs on Cloudflare Workers Paid ($5/mo, already sunk because Workflows is
a paid feature), and Workers bill **CPU time, not wall-clock** (Standard usage
model — the default for this Worker's compatibility date). A connection held
open while idle therefore costs essentially nothing.

## Decision

Add a **Server-Sent Events** endpoint, `GET /api/org/:key/alerts/stream`, that
holds the request open and streams new alerts to the kiosk. On the server the
handler tails the database with `alertsSince(orgId, cursor)` on a short interval
(~3s) and emits each new alert as an SSE `alert` event, plus a periodic `ping`
heartbeat. The connection is capped (~5 min) and the client reconnects, so no
single request lives forever.

Two deliberate sub-decisions, both of which reject the "obvious" approach:

### 1. No Durable Object — server-side tail inside a plain Worker

The obvious way to do push on Cloudflare is a Durable Object per org that holds
connections and is poked by the workflow after each insert. We are **not** doing
that, for cost reasons:

- A non-hibernatable stream (SSE) held in a DO keeps the DO **resident in
  memory**, which bills **duration (GB-s)**. One always-on DO (~128 MB) is
  ~324k GB-s/month — right at the 400k included — so the **second** always-on
  station-org would start incurring ~$3/month, and it scales per org from there.
- DO duration is only avoidable with the **WebSocket Hibernation API**, which is
  WebSocket-only. That would mean adopting WebSockets *and* a DO purely to dodge
  a charge we can avoid entirely.
- A plain Worker holding the SSE stream bills only CPU time. The idle open
  connection is ~free, and an efficient `timestamp >= cursor` tail reads ~0
  billable D1 rows when nothing is new. At one kiosk per station this stays
  comfortably inside every included allowance → **$0 marginal**.

The cost is latency: alerts surface within the ~3s tail interval rather than
instantly. For an audio dashboard that is an acceptable trade for a $0 bill and
zero new infrastructure.

### 2. fetch-based SSE client, not the native `EventSource`

The obvious SSE client is the browser's `EventSource`. We are **not** using it.

`EventSource` cannot set request headers, and API auth is a Bearer `access_key`
shared secret sent in the `Authorization` header (`src/api/client.ts`). The only
ways to authenticate an `EventSource` are to put the secret in the URL query
string or in a cookie. Putting the secret in the URL contradicts an existing
security posture in this codebase — the secret is kept out of URLs and logs on
purpose, and Worker observability is enabled, so a query-string secret would be
captured in request logs.

Instead the client consumes the stream over `fetch()` with a `ReadableStream`
reader, which **does** allow the `Authorization` header. The price is that
reconnection and `Last-Event-ID` resume are implemented by hand rather than
provided by `EventSource` — a small, contained amount of code that also gives us
explicit control over backoff and fallback.

## Consequences

- **New store method** `alertsSince(orgId, since)` on the `AlertStore` seam
  (D1 + in-memory adapters).
- **A migration is required after all** (`0003_alert_updated_at.sql`). The tail
  was first written to cursor on `alerts.timestamp` and reuse the existing
  `idx_latest_alerts_for_org` index. That column is deliberately *not* touched
  when a follow-up email revises an incident — the alert keeps its place in the
  recent list — so a revision could never surface on the stream, a regression
  against the poll this replaces. Alerts therefore carry a second clock,
  `updated_at`: equal to `timestamp` on insert, bumped on every update, and
  indexed by `idx_alerts_updated_for_org`. `timestamp` answers "when did the
  incident happen" (ordering); `updated_at` answers "when did this row last
  change" (the replication cursor). SSE event ids are `updated_at` values.
- **No new Cloudflare binding, no `wrangler.jsonc` change.** The design adds no
  new billable primitive; the bill stays at the $5 base.
- **A revision re-sends the whole alert** under its existing `alert_id`, so the
  client merges it in place rather than appending a row. It does *not* currently
  re-speak — auto-play is gated on the id being new. Whether a revised nature
  ("sick person" → "cardiac arrest") deserves a second announcement is an open
  product question, not something this decision settles.
- **Gap-free reconnect.** The client sends the last event id it saw as
  `Last-Event-ID`; the server resumes the tail from that timestamp, so an alert
  that lands during a brief disconnect is replayed rather than missed. The
  cursor is timestamp-based and can re-send a same-millisecond boundary alert;
  the client deduplicates by `alert_id`.
- **Graceful degradation.** After three consecutive failed attempts the client
  reports the stream `unavailable` and falls back to the pre-existing interval
  poll (`refreshInterval` in the settings store), so the kiosk keeps working even
  if streaming is blocked by an intermediary. Reconnection continues underneath,
  so a stream that recovers stops the poll on its own. Polled alerts run through
  the same merge-and-auto-play path as streamed ones — a kiosk that has silently
  stopped speaking is not "still working" — and the setting is surfaced as
  "Fallback Poll Interval" to say what it actually governs.
  A connection that is accepted but delivers no frames counts as a failure:
  treated as a clean close it would reconnect with no backoff, spinning at full
  speed while never crossing the threshold. `connected` therefore means frames
  are flowing, not that the request returned 200.
- **Latency** improves from up to ~30s to ~3s. If instant push is ever required,
  the migration path is WebSockets + a Durable Object **with Hibernation** (to
  keep DO duration near zero) — explicitly not SSE + DO, which is the one
  combination that costs money at this scale.
- **Assumption to hold:** the Worker must stay on the **Standard usage model**.
  On the legacy Bundled/Unbound model, wall-clock duration is billed and a
  long-open connection would stop being free, invalidating the cost rationale.
- **Every live path offers alerts to the same announcer.** The stream, the
  fallback poll, and the catch-up after a pause all merge through one handler, so
  an alert nobody has heard yet is offered regardless of which path delivered it,
  and the `alert_id` dedup means it is offered only once. The initial load and
  the manual Refresh button stay silent — both are "show me what is there now".
- **Only the latest alert is read out, and only within five minutes.** A backlog
  is not a playlist: past that window the call has been handled or the moment has
  passed, and reading it talks over whatever is happening now. So at most one
  alert is ever waiting to be spoken, always the newest offered, dropped if it is
  stale. An alert already playing is allowed to finish rather than being cut off.
  In the steady state — one call at a time — this is simply "speak each new
  alert"; the rule only bites on a burst or a backlog.
- **Out of scope:** browser autoplay policy. A kiosk still needs a prior user
  gesture (or a Chrome launch flag) to play audio; this decision does not change
  that.
