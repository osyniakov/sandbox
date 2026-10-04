#!/usr/bin/env bash
# Create a fresh, standalone git workspace for one variant.
# Usage: seed-workspace.sh <variant>   → prints the workspace path
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
v="$1"
ws="$root/experiments/workspaces/$v"

rm -rf "$ws"
mkdir -p "$ws"
cp "$here/SPEC.md" "$ws/SPEC.md"
printf 'target/\n' > "$ws/.gitignore"

git -C "$ws" init -q -b main
git -C "$ws" config user.email "harness@example.com"
git -C "$ws" config user.name "Harness"
git -C "$ws" add -A
git -C "$ws" commit -q -m "seed: SPEC"

echo "$ws"
