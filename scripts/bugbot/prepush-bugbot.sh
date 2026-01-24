#!/usr/bin/env bash
set -euo pipefail

# BugBot pre-push gate for TestifiAI (Vite React + Express)
# Produces artifacts under ./test_artifacts/<timestamp> and blocks push on failures.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TS="$(date +"%Y%m%d_%H%M%S")"
OUT_DIR="$ROOT_DIR/test_artifacts/$TS"
RAW_DIR="$OUT_DIR/raw"
mkdir -p "$RAW_DIR"

FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/loveable}"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"

ALLOW_PUSH_WITH_FAILURES="${ALLOW_PUSH_WITH_FAILURES:-false}"

log() { printf "%s\n" "$*" | tee -a "$RAW_DIR/bugbot.log"; }

# Detect changes (staged + unstaged) to pick impacted areas
CHANGED_FILES="$( (git diff --name-only; git diff --cached --name-only) | sort -u )"
echo "$CHANGED_FILES" > "$RAW_DIR/changed-files.txt"

IMPACT_FRONTEND="false"
IMPACT_BACKEND="false"
IMPACT_E2E="false"

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ "$f" == loveable/* ]]; then IMPACT_FRONTEND="true"; fi
  if [[ "$f" == backend/* ]]; then IMPACT_BACKEND="true"; fi

  # E2E triggers: frontend UI changes, shared contracts, or explicit e2e paths
  if [[ "$f" == loveable/* || "$f" == backend/* || "$f" == *"routes"* || "$f" == *"api"* || "$f" == *"contract"* || "$f" == *"openapi"* || "$f" == *"playwright"* || "$f" == *"cypress"* || "$f" == tests/* ]]; then
    IMPACT_E2E="true"
  fi
done <<< "$CHANGED_FILES"

# If no changes found (rare), still run fast checks
if [[ -z "${CHANGED_FILES// }" ]]; then
  IMPACT_FRONTEND="true"
  IMPACT_BACKEND="true"
  IMPACT_E2E="true"
fi

# Track results
# Format: suite,status,seconds,logfile
RESULTS_CSV="$OUT_DIR/test-results.csv"
RESULTS_JSON="$OUT_DIR/test-results.json"
REPORT_MD="$OUT_DIR/bugbot-report.md"
: > "$RESULTS_CSV"

run_suite() {
  local suite="$1"
  local dir="$2"
  local script="$3"
  local start end dur status logfile

  start="$(date +%s)"
  logfile="$RAW_DIR/${suite}.log"

  set +e
  (cd "$dir" && (
    if [[ -f "pnpm-lock.yaml" ]]; then pnpm run "$script"
    elif [[ -f "yarn.lock" ]]; then yarn run "$script"
    else npm run "$script"
    fi
  )) > >(tee "$logfile") 2> >(tee -a "$logfile" >&2)
  status="$?"
  set -e

  end="$(date +%s)"
  dur="$((end - start))"

  if [[ "$status" -eq 0 ]]; then
    echo "$suite,pass,$dur,$logfile" >> "$RESULTS_CSV"
    return 0
  else
    echo "$suite,fail,$dur,$logfile" >> "$RESULTS_CSV"
    return 1
  fi
}

# Build a simple JSON summary from CSV
write_json() {
  local total pass fail
  total="$(awk -F, 'NF{c++} END{print c+0}' "$RESULTS_CSV")"
  pass="$(awk -F, '$2=="pass"{c++} END{print c+0}' "$RESULTS_CSV")"
  fail="$(awk -F, '$2=="fail"{c++} END{print c+0}' "$RESULTS_CSV")"

  cat > "$RESULTS_JSON" <<JSON
{
  "timestamp": "$TS",
  "changed_files_count": $(wc -l < "$RAW_DIR/changed-files.txt" | tr -d ' '),
  "impact": {
    "frontend": $IMPACT_FRONTEND,
    "backend": $IMPACT_BACKEND,
    "e2e": $IMPACT_E2E
  },
  "results": {
    "total": $total,
    "pass": $pass,
    "fail": $fail
  },
  "artifacts_dir": "test_artifacts/$TS"
}
JSON
}

# BugBot report (deterministic)
write_report() {
  local banner
  banner="✅ PASS"
  if grep -q ",fail," "$RESULTS_CSV"; then banner="❌ FAIL"; fi
  if [[ "$ALLOW_PUSH_WITH_FAILURES" == "true" ]]; then banner="⚠️ OVERRIDDEN (ALLOW_PUSH_WITH_FAILURES=true)"; fi

  {
    echo "# BugBot Pre-Push Report — $TS"
    echo ""
    echo "**Status:** $banner"
    echo ""
    echo "## Impact Detection"
    echo "- Frontend impacted: \`$IMPACT_FRONTEND\`"
    echo "- Backend impacted: \`$IMPACT_BACKEND\`"
    echo "- E2E impacted: \`$IMPACT_E2E\`"
    echo ""
    echo "## Changed Files"
    echo '```'
    cat "$RAW_DIR/changed-files.txt" || true
    echo '```'
    echo ""
    echo "## Suite Results"
    echo ""
    echo "| Suite | Status | Seconds | Log |"
    echo "|---|---:|---:|---|"
    awk -F, '{printf "| %s | %s | %s | %s |\n",$1,$2,$3,$4}' "$RESULTS_CSV"
    echo ""
    echo "## Failure Hints (if any)"
    echo ""
    if grep -q ",fail," "$RESULTS_CSV"; then
      echo "- Check logs under \`$RAW_DIR\` for first failing suite."
      echo "- Common Vite/React E2E issues: unstable selectors, race conditions, missing waits."
      echo "- Common Express issues: test env vars, port collisions, db mocks not isolated."
      echo ""
      echo "### First failure excerpt"
      first_fail_log="$(awk -F, '$2=="fail"{print $4; exit}' "$RESULTS_CSV")"
      if [[ -n "${first_fail_log:-}" && -f "$first_fail_log" ]]; then
        echo '```'
        tail -n 120 "$first_fail_log" || true
        echo '```'
      else
        echo "_No failure log found._"
      fi
    else
      echo "_No failures detected._"
    fi
  } > "$REPORT_MD"
}

FAILURES=0

log "BugBot starting. Artifacts: $OUT_DIR"
log "Changed files recorded to: $RAW_DIR/changed-files.txt"

# Run root test:regression if any relevant area is impacted
if [[ "$IMPACT_FRONTEND" == "true" || "$IMPACT_BACKEND" == "true" || "$IMPACT_E2E" == "true" ]]; then
  log ""
  log "==> Running root test:regression (API + frontend regression tests)"
  if ! run_suite "regression" "$ROOT_DIR" "test:regression"; then FAILURES=$((FAILURES+1)); fi
fi

write_json
write_report

log ""
log "BugBot artifacts written:"
log " - $REPORT_MD"
log " - $RESULTS_JSON"
log " - $RESULTS_CSV"
log " - raw logs: $RAW_DIR"

if [[ "$FAILURES" -gt 0 ]]; then
  if [[ "$ALLOW_PUSH_WITH_FAILURES" == "true" ]]; then
    log "OVERRIDE enabled; allowing push despite failures."
    exit 0
  fi
  log "Blocking push: $FAILURES failing suite(s)."
  exit 1
fi

log "All suites passed. Push allowed."
exit 0
