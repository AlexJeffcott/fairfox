# TLA+ model-checking environment for fairfox specs. Mirrors polly's
# tools/verify/specs/Dockerfile (eclipse-temurin + tla2tools.jar) so
# `bun run tla:check` runs in a known-good container regardless of
# the host's java setup.

FROM eclipse-temurin:11-jre

RUN apt-get update && apt-get install -y curl && \
    curl -L https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar \
         -o /opt/tla2tools.jar && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

RUN echo '#!/bin/bash' > /usr/local/bin/tlc && \
    echo 'java -jar /opt/tla2tools.jar "$@"' >> /usr/local/bin/tlc && \
    chmod +x /usr/local/bin/tlc

WORKDIR /specs
CMD ["tail", "-f", "/dev/null"]
