#!/usr/bin/env bash
# End-to-end smoke test of a built workspace: package the app, boot the jar,
# curl every endpoint class (happy path, 404, 400, 405).
# Usage: smoke.sh <workspace> [port]
set -uo pipefail

ws="$1"; port="${2:-18099}"
cd "$ws/app" || { echo "SMOKE FAIL: no app/ in $ws"; exit 1; }

mvn -q package -DskipTests >/dev/null 2>&1 || mvn -q package >/dev/null 2>&1 \
  || { echo "SMOKE FAIL: mvn package failed"; exit 1; }

jar=$(ls target/*.jar 2>/dev/null | grep -v original- | head -1)
[ -n "$jar" ] || { echo "SMOKE FAIL: no jar in target/"; exit 1; }

PORT=$port java -jar "$jar" >/dev/null 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null' EXIT
sleep 2

base="http://127.0.0.1:$port/todos"
fails=0
check() { # check <expected-code> <description> <curl args...>
  local want="$1" desc="$2"; shift 2
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' "$@")
  if [ "$got" != "$want" ]; then
    echo "SMOKE FAIL: $desc → $got (want $want)"; fails=$((fails+1))
  fi
}

id=$(curl -s -X POST "$base" -d '{"title":"smoke"}' \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null)
[ -n "$id" ] || { echo "SMOKE FAIL: POST did not return an id"; exit 1; }

check 200 "GET list"          "$base"
check 200 "GET by id"         "$base/$id"
check 200 "PUT update"        -X PUT "$base/$id" -d '{"title":"x","completed":true}'
check 204 "DELETE"            -X DELETE "$base/$id"
check 404 "GET deleted"       "$base/$id"
check 400 "POST blank title"  -X POST "$base" -d '{"title":"  "}'
check 405 "PATCH collection"  -X PATCH "$base"

if [ "$fails" -eq 0 ]; then echo "SMOKE OK"; else exit 1; fi
