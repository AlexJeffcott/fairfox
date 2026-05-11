# fairfox-turn — coturn for the fairfox mesh

A standalone Railway service that runs [coturn](https://github.com/coturn/coturn)
in `use-auth-secret` mode. The fairfox web service mints short-lived
HMAC-SHA1 credentials against the same shared secret and hands them
to clients via `/turn-credentials`.

## Why this exists

WebRTC peers behind symmetric NAT (CGNAT, corporate firewalls) cannot
exchange bytes via STUN alone — they need a TURN relay. Browser↔CLI
pairs on the same LAN also fail without TURN, because Chrome obfuscates
local IPs as `<random>.local` mDNS hostnames that werift in the CLI
can't resolve.

## Deploying on Railway

1. Create a new Railway service in the same project as `fairfox-web`.
2. Set its **root directory** to `turn/`.
3. Add a **TCP proxy** for port `3478` (Railway → Settings → Networking).
   UDP support varies — if available, expose UDP/3478 too. TCP-only
   TURN works for `$meshState` sync (Automerge ops) at the cost of
   ~10–30ms extra latency, which is invisible for non-realtime data.
4. Set env vars:
   - `TURN_SHARED_SECRET` — a long random string. Same value on the
     `fairfox-web` service as `FAIRFOX_TURN_SHARED_SECRET`. Easiest
     via a Railway shared variable so both services see the same value.
   - `EXTERNAL_IP` *(optional)* — Railway's outbound public IPv4 for
     this service. Without it coturn auto-discovers, which usually
     works on Railway's setup.
5. On `fairfox-web`, set:
   - `FAIRFOX_TURN_URL` — `turn:<railway-domain>:3478`. The Railway
     TCP proxy gives you a hostname to use here.
   - `FAIRFOX_TURN_SHARED_SECRET` — same value as `TURN_SHARED_SECRET`
     on this service.
   - `FAIRFOX_TURN_TTL_SECONDS` *(optional, default 600)* — credential
     lifetime.

## Verifying

Once deployed, hit `https://<fairfox-web-domain>/turn-credentials`. It
should return:

```json
{
  "iceServers": [
    { "urls": "stun:stun.cloudflare.com:3478" },
    { "urls": "turn:<your-turn-host>:3478", "username": "...", "credential": "..." }
  ],
  "ttlSeconds": 600
}
```

If the `turn:` entry is missing, check that `FAIRFOX_TURN_URL` and
`FAIRFOX_TURN_SHARED_SECRET` are both set on `fairfox-web`.

Then confirm peers actually connect via TURN. From a fresh Chrome
profile (mDNS still on, default config) running an `add device` flow
plus a local `fairfox chat serve`, the relay heartbeat should show
`peers=1 sync(rx>0)` within a few seconds. If `peers=0` persists,
the TURN entry is being returned but the candidate isn't reachable —
walk back through Railway's networking config.
