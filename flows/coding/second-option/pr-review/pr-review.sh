#!/usr/bin/env bash
set -euo pipefail

# Reads the pull request status and comments, then emits a decision label that the
# flow routes on. Set GH_PR to a specific PR number or URL, or leave it unset to use
# the PR for the current branch.
#
# Output is a single JSON line, e.g.:
#   {"outcome":"succeeded","label":"ready"}
#   {"outcome":"succeeded","label":"rework"}

PR="${GH_PR:-}"

if [ -z "$PR" ]; then
  PR="$(gh pr view --json number --jq -r .number 2>/dev/null || true)"
fi

if [ -z "$PR" ] || [ "$PR" = "null" ]; then
  printf '{"outcome":"succeeded","label":"rework"}\n'
  exit 0
fi

state="$(gh pr view "$PR" --json state --jq -r .state 2>/dev/null || echo UNKNOWN)"
comments="$(gh pr view "$PR" --json comments --jq '.comments | length' 2>/dev/null || echo 0)"
approvals="$(gh pr view "$PR" --json reviews --jq '[.reviews[] | select(.state == "APPROVED")] | length' 2>/dev/null || echo 0)"

if [ "$state" = "APPROVED" ] || [ "$state" = "MERGED" ] || [ "$approvals" -gt 0 ] 2>/dev/null; then
  printf '{"outcome":"succeeded","label":"ready"}\n'
else
  printf '{"outcome":"succeeded","label":"rework"}\n'
fi
