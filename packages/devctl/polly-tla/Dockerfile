# The TLC image polly verify runs: polly-tla:latest, the name polly gives it.
# devctl verify builds it before every run, from pinned inputs that
# packages/devctl/src/tlc.ts passes in: Java by digest, and the tla2tools.jar
# devctl tlc checks by hash. polly 0.82.1 runs whatever image has that tag and
# never rebuilds it; its own Dockerfile takes Java by tag and downloads the jar
# with no hash check.
ARG JAVA_IMAGE
FROM ${JAVA_IMAGE}
ARG TLA_JAR
COPY --from=tools ${TLA_JAR} /opt/tla2tools.jar
COPY --chmod=0755 entrypoint.sh /usr/local/bin/polly-tla-entrypoint
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/polly-tla-entrypoint"]
