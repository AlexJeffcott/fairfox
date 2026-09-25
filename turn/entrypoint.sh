#!/bin/sh
# Boot coturn with config interpolated from env. Three vars matter:
#
#   TURN_SHARED_SECRET   (required) shared with the relay; the relay
#                        mints HMAC-SHA1 creds against this so coturn
#                        can validate them stateless.
#   TURN_REALM           (optional, default "fairfox") authentication realm.
#   EXTERNAL_IP_V4       (required for IPv4 clients) the app-level
#                        public IPv4 coturn should advertise as its
#                        relay address. On Fly: `fly ips list --app
#                        <name>` → the dedicated v4 row. NOT Fly's
#                        FLY_PUBLIC_IP env, which is the per-Machine
#                        IPv6 — that varies per Machine and would
#                        break session affinity if multiple Machines
#                        existed. Pin to the app-level address.
#   EXTERNAL_IP_V6       (optional) same for IPv6 — the app-level
#                        dedicated v6 from `fly ips list`.
#   PORT                 (Railway-injected) primary listening port.
#                        Coturn binds UDP and TCP on the same number.
#
# Anything else is hard-coded — fairfox doesn't need TLS-on-coturn
# (the client is over WSS to the relay; TURN itself stays plain because
# Railway terminates TLS at its edge), DTLS, or the admin CLI.

set -e

if [ -z "$TURN_SHARED_SECRET" ]; then
  echo "[turn] TURN_SHARED_SECRET is required" >&2
  exit 1
fi

LISTEN_PORT="${PORT:-3478}"
REALM="${TURN_REALM:-fairfox}"

# Relay-port range that the platform's services config forwards.
# Constraining coturn to the same range keeps relay traffic on ports
# we know are reachable from the public internet.
#
# 16 ports is well above household concurrency. The narrower window is
# also a deliberate test: Fly's `[[services]]` range syntax with
# `start_port`/`end_port` deploys cleanly but appears not to actually
# forward UDP across the whole range, so the deployed fly.toml now
# enumerates each port explicitly. Widen by enumerating more ports
# there if a deployment ever hits "out of relay ports" warnings.
RELAY_MIN="${TURN_RELAY_MIN_PORT:-49152}"
RELAY_MAX="${TURN_RELAY_MAX_PORT:-49167}"

if [ -z "$EXTERNAL_IP_V4" ] && [ -z "$EXTERNAL_IP_V6" ]; then
  echo "[turn] WARNING: neither EXTERNAL_IP_V4 nor EXTERNAL_IP_V6 set" >&2
  echo "[turn]   coturn will auto-discover from container interfaces," >&2
  echo "[turn]   which on managed hosts is a private address peers can't reach." >&2
fi

# Fly delivers UDP to the address `fly-global-services`, and only packets
# sent from that address leave with the app's public IPv4. coturn left to
# itself binds relay sockets on every private address; an allocation on
# another one sends from an address the peer never gave permission to, and
# the peer drops its packets (step 0c, check 1, red on 2026-09-26). So the
# relay binds to fly-global-services alone, and external-ip maps that one
# address to the public one. No fallback: off Fly, the name does not resolve.
RELAY_IP=$(getent hosts fly-global-services | awk '{ print $1; exit }')
if [ -z "$RELAY_IP" ]; then
  echo "[turn] fly-global-services does not resolve: this relay runs on Fly only" >&2
  exit 1
fi
if [ -z "$EXTERNAL_IP_V4" ]; then
  echo "[turn] EXTERNAL_IP_V4 is required: the app's dedicated IPv4 from fly ips list" >&2
  exit 1
fi

CONF=/tmp/turnserver.conf
{
  echo "listening-port=${LISTEN_PORT}"
  echo "min-port=${RELAY_MIN}"
  echo "max-port=${RELAY_MAX}"
  echo "fingerprint"
  echo "lt-cred-mech"
  echo "use-auth-secret"
  echo "static-auth-secret=${TURN_SHARED_SECRET}"
  echo "realm=${REALM}"
  echo "no-tls"
  echo "no-dtls"
  echo "no-cli"
  echo "no-loopback-peers"
  echo "no-multicast-peers"
  echo "log-file=stdout"
  # One relay address, mapped to the public IPv4. No IPv6 line: Fly takes
  # no UDP over public IPv6, and coturn refused a second external-ip.
  echo "relay-ip=${RELAY_IP}"
  echo "external-ip=${EXTERNAL_IP_V4}/${RELAY_IP}"
} > "$CONF"

echo "[turn] coturn :${LISTEN_PORT} relay=${RELAY_IP}:${RELAY_MIN}-${RELAY_MAX} external=${EXTERNAL_IP_V4} realm=${REALM}"
exec turnserver -c "$CONF"
