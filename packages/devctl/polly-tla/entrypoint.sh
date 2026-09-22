#!/bin/sh
# The entry point of the polly-tla image. polly runs
#   docker run --rm -v <specs/tla/generated>:/work polly-tla:latest tlc <TLC flags> <Spec>.tla
# and reads what TLC prints, but keeps it only when a run fails, so a green run
# cannot be seen to have completed. When /work holds .keep-tlc-log, which
# devctl verify writes before each run, TLC's whole output also goes to
# /work/tlc.log for devctl verify to read. Without it, this image runs TLC as
# polly's own does, with the garbage collector TLC asks for.
set -u
if [ "${1:-}" = "tlc" ]; then
  shift
fi
if [ ! -e /work/.keep-tlc-log ]; then
  exec java -XX:+UseParallelGC -jar /opt/tla2tools.jar "$@"
fi
# Java runs as a child, so the signal docker passes on at the time limit is sent on to it.
java -XX:+UseParallelGC -jar /opt/tla2tools.jar "$@" > /work/tlc.log 2>&1 &
pid=$!
trap 'kill -TERM "$pid" 2>/dev/null' TERM INT
wait "$pid"
code=$?
# A signal ends the first wait early; this one waits for Java to exit.
wait "$pid" 2>/dev/null
cat /work/tlc.log
exit "$code"
