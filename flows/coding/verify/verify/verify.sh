#!/usr/bin/env bash
set -uo pipefail

# The automated evaluation gate. Emits a structured verification result that the
# downstream confirm-verify step presents to a human. Always exits 0; pass/fail is
# carried in the output, not the exit code.

npm run build >/dev/null 2>&1
build_passed=$?
npm test >/dev/null 2>&1
test_passed=$?

build_ok=false
test_ok=false
[ "$build_passed" -eq 0 ] && build_ok=true
[ "$test_passed" -eq 0 ] && test_ok=true

printf '{"outcome":"succeeded","output":{"build":{"passed":%s},"tests":{"passed":%s}}}\n' \
  "$build_ok" \
  "$test_ok"
