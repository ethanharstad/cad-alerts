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
  (D1 + in-memory adapters). It reuses the existing
  `idx_latest_alerts_for_org` index, so **no database migration is required**.
- **No new Cloudflare binding, no `wrangler.jsonc` change.** The design adds no
  new billable primitive; the bill stays at the $5 base.
- **Gap-free reconnect.** The client sends the last event id it saw as
  `Last-Event-ID`; the server resumes the tail from that timestamp, so an alert
  that lands during a brief disconnect is replayed rather than missed. The
  cursor is timestamp-based and can re-send a same-millisecond boundary alert;
  the client deduplicates by `alert_id`.
- **Graceful degradation.** If the stream fails repeatedly the client can fall
  back to the pre-existing interval poll (`refreshInterval` in the settings
  store), so the kiosk keeps working even if streaming is blocked by an
  intermediary.
- **Latency** improves from up to ~30s to ~3s. If instant push is ever required,
  the migration path is WebSockets + a Durable Object **with Hibernation** (to
  keep DO duration near zero) — explicitly not SSE + DO, which is the one
  combination that costs money at this scale.
- **Assumption to hold:** the Worker must stay on the **Standard usage model**.
  On the legacy Bundled/Unbound model, wall-clock duration is billed and a
  long-open connection would stop being free, invalidating the cost rationale.
- **Out of scope:** browser autoplay policy. A kiosk still needs a prior user
  gesture (or a Chrome launch flag) to play audio; this decision does not change
  that.
