# Phase 4 — Live Learning (Zoom)

## Goal

Zoom integration for live sessions. (CONTEXT.md §13, Phase 4; §6 for full details.)

Implement the primary Zoom REST API session creation and participant registration flow, the Zoom Server-to-Server OAuth service, the embedded web Zoom interface with mobile native app fallback, and the persistent WebSocket event consumer with compound event key deduplication.

## Proposed approach

1. **Pre-Phase Technical Spike:**
   - Verify the academy's Zoom plan supports Server-to-Server OAuth, REST meeting registration, and WebSocket event subscriptions.
   - Inspect live Zoom event payloads to confirm exact event fields for compound `event_key` deduplication and client type detection (web vs. native app).
2. **Zoom REST API Integration (Primary Session Creation Flow):**
   - When Admin schedules a session, the system calls the Zoom REST API to create the meeting.
   - Automatically register the teacher and assigned students.
   - Store the generated participant-specific join URLs and registrant IDs in `Sessions` and `SessionStudents`.
3. **Session Experience (Embedded Web + Native Mobile Fallback):**
   - Provide an embedded Zoom interface on the website where supported (via Zoom Meeting SDK Web).
   - Display a responsive "Launch in Zoom App" button on mobile devices and as a fallback to open the native Zoom client.
4. **Server-to-Server OAuth Token Manager:**
   - Acquire tokens via `account_credentials` grant.
   - Automatically refresh tokens prior to hourly expiration.
5. **Persistent WebSocket Event Consumer:**
   - Long-running worker process connected to `ZOOM_WEBSOCKET_URL`.
   - Maintain 30-second heartbeat ping/pong.
   - Automatic reconnect with exponential backoff on network interruption.
6. **Compound Event Key Deduplication & Persistence:**
   - Ingest events into `ZoomEvents` table.
   - Enforce database uniqueness on `event_key`:
     - Meeting-level: `${meeting_uuid}:${event_type}`
     - Participant-level: `${meeting_uuid}:${event_type}:${participant_uuid}:${event_time}`
   - Store with `processed_at = NULL` to enable atomic retry processing in downstream phases.

## Tasks

- [ ] Execute Zoom technical spike (verify API plan capabilities & payload schemas)
- [ ] Add Prisma schema: `ZoomEvents` table with unique `event_key` constraint
- [ ] Run migration
- [ ] Implement Zoom Server-to-Server OAuth token service with proactive auto-refresh
- [ ] Implement Zoom REST API client: create meeting + register participants + fetch join links
- [ ] Integrate session creation UI with Zoom REST API provisioning
- [ ] Implement embedded web Zoom client view for desktop browsers
- [ ] Implement "Launch in Zoom App" responsive button for mobile participants
- [ ] Implement WebSocket client: connect, 30s heartbeat, automatic reconnect
- [ ] Implement compound `event_key` generation and Zod validation for Zoom payloads
- [ ] Build Admin view for raw `ZoomEvents` inspection and debugging
- [ ] Write tests: token auto-refresh, event key uniqueness, duplicate rejection, reconnect handling

## Execution log (updated as soon as real work happens)

(empty for now)
