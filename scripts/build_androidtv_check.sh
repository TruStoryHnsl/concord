#!/usr/bin/env bash
# build_androidtv_check.sh — Validate AndroidManifest.xml.template for
# Google TV / Android TV compliance.
#
# Checks that the template contains every key the Play Store and the
# leanback launcher require before an APK can install and appear on TV
# devices. Designed to run as a pre-build gate on any host (no Android
# SDK required — it only reads the XML template).
#
# =================================================================
# Usage:
# =================================================================
#
#   scripts/build_androidtv_check.sh                 # validate template
#   scripts/build_androidtv_check.sh --manifest PATH # override template path
#
# =================================================================
# Exit codes:
# =================================================================
#
#   0  all Google TV manifest requirements are met
#   1  one or more requirements are missing
#   2  manifest template file not found
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default manifest path.
MANIFEST="${REPO_ROOT}/src-tauri/gen/android/AndroidManifest.xml.template"

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
log()  { printf '\033[1;36m[androidtv-check]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[androidtv-check]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[androidtv-check ERROR]\033[0m %s\n' "$*" >&2; exit "${2:-1}"; }

pass() { printf '\033[1;32m  [PASS]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m  [FAIL]\033[0m %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

# ----------------------------------------------------------------------------
# Arg parsing
# ----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --manifest)
            MANIFEST="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# //; s/^#$//'
            exit 0
            ;;
        *)
            die "unknown argument: $1" 1
            ;;
    esac
done

# ----------------------------------------------------------------------------
# File existence check
# ----------------------------------------------------------------------------
if [[ ! -f "${MANIFEST}" ]]; then
    die "manifest template not found at: ${MANIFEST}" 2
fi

log "Validating Google TV compliance: ${MANIFEST}"
FAILURES=0

# Helper: check that a uses-feature element with the given name also
# has android:required="false". The attributes may be on separate
# lines, so we collapse the entire file into one line first, then
# use sed to extract individual <uses-feature .../> elements.
#
# Usage: check_feature_required_false <feature-name> <label>
check_feature_required_false() {
    local feature="$1"
    local label="$2"
    # Collapse newlines so multi-line XML elements become single strings.
    local flat
    flat="$(tr '\n' ' ' < "${MANIFEST}")"
    # Extract the uses-feature element containing our feature name.
    local element
    element="$(echo "${flat}" | sed -n "s/.*\(<uses-feature[^>]*${feature}[^/]*\/>\).*/\1/p")"
    if [[ -z "${element}" ]]; then
        fail "missing uses-feature: ${label}"
    elif echo "${element}" | grep -q 'android:required="false"'; then
        pass "${label} declared with required=\"false\""
    else
        fail "${label} found but required is not \"false\""
    fi
}

# ----------------------------------------------------------------------------
# Check 1: android.software.leanback uses-feature (required=false)
# ----------------------------------------------------------------------------
check_feature_required_false "android.software.leanback" "android.software.leanback"

# ----------------------------------------------------------------------------
# Check 2: android.hardware.touchscreen uses-feature (required=false)
# ----------------------------------------------------------------------------
check_feature_required_false "android.hardware.touchscreen" "android.hardware.touchscreen"

# ----------------------------------------------------------------------------
# Check 3: LEANBACK_LAUNCHER intent-filter
# ----------------------------------------------------------------------------
if grep -q 'android.intent.category.LEANBACK_LAUNCHER' "${MANIFEST}"; then
    pass "LEANBACK_LAUNCHER intent-filter present"
else
    fail "missing intent-filter category: android.intent.category.LEANBACK_LAUNCHER (TV launcher won't show the app)"
fi

# ----------------------------------------------------------------------------
# Check 4: android:banner attribute on <application>
# ----------------------------------------------------------------------------
if grep -q 'android:banner=' "${MANIFEST}"; then
    pass "android:banner attribute present on <application>"
else
    fail "missing android:banner attribute (Google TV launcher hides apps without a banner)"
fi

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
echo ""
if [[ "${FAILURES}" -eq 0 ]]; then
    log "All 4 Google TV manifest requirements met."
    exit 0
else
    die "${FAILURES} requirement(s) failed — see above." 1
fi
