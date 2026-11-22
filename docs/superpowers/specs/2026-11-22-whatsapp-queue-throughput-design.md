# WhatsApp Queue Throughput Design

## Intent
Increase the throughput of ordinary queued WhatsApp notifications so a full worker
batch is more likely to finish within one polling interval.

## Scope and constraints
- Reduce the shared worker send spacing from 1,500 ms to 1,000 ms.
- Keep the ordinary worker batch limit at 50 jobs.
- This is an application-side target, not a guarantee of OpenWA or WhatsApp capacity.
- Keep transient OpenWA 429 retry behavior; do not retry permanent failures.

## Non-goals
- Do not change the generic API request limit (120 requests/minute), invoice-link
  anti-repeat rules, direct Admin message route quota, or announcement quotas.
- Do not change WhatsApp account tier or any provider-enforced limit.

## Approaches
1. **One-second shared spacing, batch 50 (selected):** Raises ordinary queue
   throughput conservatively while preserving the existing per-batch ceiling.
   Actual throughput depends on OpenWA and worker/database latency.
2. **Half-second spacing and batch 100:** Higher potential throughput, but raises
   OpenWA 429 and account-restriction risk; not selected.
3. **Increase batch size only:** Does not address send spacing and can make a tick
   run longer, so it is not an effective throughput improvement.

## Verification
Add or update focused worker coverage for the ordinary send spacing and batch
behavior, run the focused worker tests, and run scoped lint/typecheck. Confirm the
existing transient 429 retry path and announcement-specific limits remain unchanged.

## Remaining implementation call
The builder should change only the shared ordinary-send interval and its directly
related test coverage; no unrelated throttles should be altered.
