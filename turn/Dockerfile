FROM coturn/coturn:alpine

# Drop the entrypoint baked into the upstream image so we can run our
# tiny shell wrapper that interpolates env vars into a turnserver.conf
# at boot. coturn doesn't accept a shared secret via flag in
# `use-auth-secret` mode — it has to come from a config file.
USER root

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 3478 is the canonical TURN/STUN port for both UDP (preferred) and TCP
# (fallback for networks that block UDP). 49152–50175 is the dynamic
# relay-port window coturn allocates per-session for actual data
# traffic; constrained to that range by `--min-port`/`--max-port` in
# entrypoint.sh so Fly's services config can mirror it.
EXPOSE 3478/udp 3478/tcp 49152-50175/udp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
