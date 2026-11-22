#!/usr/bin/env bash
# Model-checks the download queue of app/src/main/manager.js with TLC.
#
#   bash formal/check.sh                       runs every config in formal/
#   bash formal/check.sh faithful-max1.cfg     runs one config and prints all TLC says
#
# A faithful-*.cfg passes when TLC finds no error. A bug-*.cfg puts one past or
# likely mistake back into the model, and it passes only when TLC reports the
# invariant on its INVARIANT line as violated. So one run shows that the model
# holds and that each property can still fail.
#
# Needs Java 11 or later, curl, and sha256sum or shasum. The TLA+ tools jar is
# downloaded once to ~/.cache/downy-tla, or to $DOWNY_TLA_CACHE when set.
set -euo pipefail

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
CACHE="${DOWNY_TLA_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/downy-tla}"
JAR="$CACHE/tla2tools-$TLA_VERSION.jar"

cd "$(dirname "$0")"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}

if [ ! -f "$JAR" ] || [ "$(sha256 "$JAR")" != "$TLA_SHA256" ]; then
  mkdir -p "$CACHE"
  echo "Downloading tla2tools.jar $TLA_VERSION"
  curl -sSfL --retry 3 -o "$JAR.download" "$TLA_URL"
  got="$(sha256 "$JAR.download")"
  if [ "$got" != "$TLA_SHA256" ]; then
    rm -f "$JAR.download"
    echo "The downloaded tla2tools.jar has SHA-256 $got, not $TLA_SHA256." >&2
    exit 1
  fi
  mv "$JAR.download" "$JAR"
fi

meta="$(mktemp -d)"
trap 'rm -rf "$meta"' EXIT

# TLC keeps its state files in $meta, not in formal/. Without the FPSet flag TLC
# 2.19 picked MSBDiskFPSet on Java 25, and then its report at the end of a run
# without errors threw "Division by zero". OffHeapDiskFPSet does not.
tlc() {
  java -XX:+UseParallelGC -XX:MaxDirectMemorySize=512m \
    -Dtlc2.tool.fp.FPSet.impl=tlc2.tool.fp.OffHeapDiskFPSet \
    -cp "$JAR" tlc2.TLC -workers "$2" -metadir "$meta/$(basename "$1" .cfg)" \
    -config "$1" JobLifecycle.tla
}

# Runs one config and prints one line about it. With "full" it also prints all
# that TLC said, and it does that anyway when the config does not pass.
check() {
  local cfg="$1" full="${2:-}" name workers out code=0 states expect
  name="$(basename "$cfg" .cfg)"
  # One worker searches level by level, so a bug config gets the shortest counterexample.
  case "$name" in faithful-*) workers=auto ;; *) workers=1 ;; esac
  out="$(tlc "$cfg" "$workers" 2>&1)" || code=$?
  [ -n "$full" ] && printf '%s\n' "$out"
  states="$(printf '%s\n' "$out" | sed -n 's/.* \([0-9,]*\) distinct states found.*/\1/p' | tail -n 1)"
  case "$name" in
    faithful-*)
      if [ "$code" -eq 0 ] && grep -q '^Model checking completed. No error has been found.' <<<"$out"; then
        echo "pass  $name: no error in ${states:-?} distinct states"
        return 0
      fi
      [ -z "$full" ] && printf '%s\n' "$out"
      echo "FAIL  $name: TLC found an error in the faithful model (exit $code). Read the trace above." >&2
      return 1
      ;;
    *)
      expect="$(awk '$1 == "INVARIANT" { sub(/\r$/, "", $2); print $2 }' "$cfg")"
      if grep -q "^Error: Invariant $expect is violated." <<<"$out"; then
        echo "pass  $name: TLC reports $expect violated after $(grep -c '^State [0-9]*:' <<<"$out") states"
        return 0
      fi
      [ -z "$full" ] && printf '%s\n' "$out"
      echo "FAIL  $name: expected TLC to report $expect violated (exit $code)." >&2
      return 1
      ;;
  esac
}

if [ $# -gt 0 ]; then
  check "$(basename "$1")" full
  exit
fi

failed=0
for cfg in faithful-*.cfg bug-*.cfg; do
  check "$cfg" || failed=1
done
exit "$failed"
