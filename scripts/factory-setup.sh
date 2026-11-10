#!/usr/bin/env bash
#
# factory-setup.sh — verify (and optionally repair) the pacman-256 local
# software factory environment.
#
# It checks the runtime-specific layers the factory depends on:
#   1. Runtime / CLI      — Node, npm, git, Herdr (herdr), Pi (pi)
#   2. Herdr + Pi plugins — Pi agent npm packages (pi-herdsman, pi-web-access,
#      question tool) and the Herdr <-> Pi integration extension
#   3. Project factory assets — runtime agent profiles, .github/skills/ role
#      skills, the worktree script, and the contract docs.
#
# Usage:
#   scripts/factory-setup.sh          # verify, report, no changes
#   scripts/factory-setup.sh --copilot # verify Copilot workspace setup (no Pi/Herdr)
#   scripts/factory-setup.sh --fix    # attempt safe remediation, then re-check
#   scripts/factory-setup.sh --quiet  # only print failures
#   scripts/factory-setup.sh --help   # this help
#
# Exit status: 0 if every check passed, 1 if any check failed (after fixes).

set -uo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SRC_DIR/.." && pwd)"

# Pi agent npm directory: where `pi install npm:<pkg>` installs packages.
PI_NPM="${PI_NPM:-$HOME/.pi/agent/npm}"

# Herdr <-> Pi integration extension (installed by `herdr integration install pi`).
HERDR_PI_EXT="$HOME/.pi/agent/extensions/herdr-agent-state.ts"

# Herdr integration marker that proves the *pi* integration is installed.
HERDR_PI_MARKER="HERDR_INTEGRATION_ID=pi"

# The six project-local Herdr role definitions (FACTORY.md §Roles).
ROLE_DEFS="builder pr-reviewer qa-tester gameplay-designer artist docs-writer"

# The `pi install npm:<pkg>` packages the factory runtime needs.
# (The Inception model provider, e.g. @underactive/pi-inceptionlabs-provider,
# is an environment dependency of Pi itself, not part of the factory.)
PI_PACKAGES=(
  "pi-herdsman"
  "pi-web-access"
  "@juicesharp/rpiv-ask-user-question"
)

# Critical contract docs for the factory.
FACTORY_DOCS=(FACTORY.md DECISIONS.md GAME-CONTRACT.md)

# ---------------------------------------------------------------------------
# State / output helpers
# ---------------------------------------------------------------------------

MODE_QUIET=0
COPILOT_ONLY=0
FAILURES=0
WARNINGS=0
PASS_LABEL=""

say()  { [[ $MODE_QUIET -eq 0 ]] && printf '%s\n' "$*"; }
warn() { printf '  [ ! ] %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
ok()   { say "  [ ok ] $*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
section() { say; say "== $PASS_LABEL$* =="; }

# Fix helpers: a fix runs only in --fix mode and only when its check failed.
FIX_ENABLED=0
fix() {
  if [[ $FIX_ENABLED -eq 1 ]]; then
    printf '  [fix ] %s\n' "$*"
    "$@"
  else
    printf '  [    ] %s (rerun with --fix to attempt)\n' "$*"
  fi
}

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --fix)   FIX_ENABLED=1 ;;
    --quiet) MODE_QUIET=1 ;;
    --copilot) COPILOT_ONLY=1 ;;
    --help|-h) usage ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Small primitives
# ---------------------------------------------------------------------------

# ver_ge A B — true if dotted numeric version A >= B (e.g. 22.18.0 >= 22.18)
ver_ge() {
  local a b i ia ib
  IFS='.' read -r -a a <<< "$1"
  IFS='.' read -r -a b <<< "$2"
  for ((i = 0; i < ${#b[@]}; i++)); do
    ia=$(( ${a[i]:-0} ))
    ib=$(( ${b[i]:-0} ))
    (( ia > ib )) && return 0
    (( ia < ib )) && return 1
  done
  return 0
}

# fm_name FILE — print the frontmatter `name:` value (or nothing if absent).
fm_name() {
  awk '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && $0 ~ /^name:[[:space:]]+/ {
      sub(/^name:[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print; exit
    }
  ' "$1"
}

# fm_has_desc FILE — true if frontmatter has a non-empty `description:`.
fm_has_desc() {
  awk '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && $0 ~ /^description:[[:space:]]*[^[:space:]]/ { found = 1 }
    END { exit !found }
  ' "$1"
}

# pkg_version PKG — print installed version of a package in $PI_NPM.
pkg_version() {
  node -p "require('$PI_NPM/node_modules/$1/package.json').version" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Checks (a function so --fix can re-verify after remediation)
# ---------------------------------------------------------------------------

run_checks() {
  FAILURES=0
  WARNINGS=0

# ---------------------------------------------------------------------------
# 1. Runtime / CLI
# ---------------------------------------------------------------------------

if [[ $COPILOT_ONLY -eq 1 ]]; then
  section "1/2  Shared runtime"
else
  section "1/4  Runtime / CLI"
fi

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version 2>/dev/null | sed 's/^v//')"
  if ver_ge "$NODE_VER" "22.18.0"; then
    ok "node v$NODE_VER (>= 22.18.0)"
  else
    fail "node v$NODE_VER too old (factory requires >= 22.18.0)"
  fi
else
  fail "node not found on PATH"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm --version 2>/dev/null)"
else
  fail "npm not found on PATH"
fi

if [[ $COPILOT_ONLY -eq 0 ]]; then
  PI_MISSING=0
  if command -v pi >/dev/null 2>&1; then
    ok "pi $(pi --version 2>/dev/null | head -1)"
  else
    PI_MISSING=1
    fail "pi not found on PATH"
    warn "install Pi (see https://pi.dev/docs/latest/quickstart) so \`pi\` is on PATH"
  fi

  HERDR_MISSING=0
  if command -v herdr >/dev/null 2>&1; then
    HERDR_VER="$(herdr --version 2>/dev/null | head -1)"
    ok "herdr $HERDR_VER"
    if herdr status >/dev/null 2>&1; then
      ok "herdr server running"
    else
      warn "herdr server is not running — start it with \`herdr\` before delegating"
    fi
  else
    HERDR_MISSING=1
    fail "herdr not found on PATH"
    warn "install Herdr (see https://herdr.dev/docs/install/) so \`herdr\` is on PATH"
  fi
fi

if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  ok "git work tree at $ROOT"
else
  fail "$ROOT is not a git work tree (worktrees require git)"
fi

# ---------------------------------------------------------------------------
# 2. Pi agent packages (plugins)
# ---------------------------------------------------------------------------

if [[ $COPILOT_ONLY -eq 0 ]]; then
  section "2/4  Pi agent packages (plugins)"

  if [[ ! -d "$PI_NPM/node_modules" ]]; then
    fail "Pi agent npm dir not found: $PI_NPM"
    warn "run \`pi install npm:pi-herdsman\` (and sibling packages) after installing Pi, or set PI_NPM"
  fi

  for pkg in "${PI_PACKAGES[@]}"; do
    ver="$(pkg_version "$pkg")"
    if [[ -n "$ver" ]]; then
      ok "$pkg $ver"
    else
      fail "$pkg is not installed"
      if [[ $PI_MISSING -eq 0 ]]; then
        fix pi install "npm:$pkg"
      fi
    fi
  done

# ---------------------------------------------------------------------------
# 3. Herdr <-> Pi integration
# ---------------------------------------------------------------------------

  section "3/4  Herdr <-> Pi integration"

  if [[ -f "$HERDR_PI_EXT" ]] && grep -qF "$HERDR_PI_MARKER" "$HERDR_PI_EXT" 2>/dev/null; then
    ok "herdr pi integration installed ($HERDR_PI_EXT)"
  else
    fail "herdr pi integration is missing ($HERDR_PI_MARKER not found)"
    if [[ $HERDR_MISSING -eq 0 ]]; then
      fix herdr integration install pi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 4. Project software-factory assets
# ---------------------------------------------------------------------------

if [[ $COPILOT_ONLY -eq 1 ]]; then
  section "2/2  Copilot project assets"
else
  section "4/4  Project factory assets"
fi

# --- Runtime role definitions and shared role skills ------------------------
for role in $ROLE_DEFS; do
  skill="$ROOT/.github/skills/$role/SKILL.md"

  if [[ $COPILOT_ONLY -eq 1 ]]; then
    def="$ROOT/.github/agents/$role.agent.md"
    if [[ -f "$def" ]]; then
      name="$(fm_name "$def")"
      if [[ "$name" == "$role" ]] && fm_has_desc "$def"; then
        ok "Copilot agent .github/agents/$role.agent.md"
      else
        fail ".github/agents/$role.agent.md has invalid name or no description"
      fi
    else
      fail "Copilot agent missing: .github/agents/$role.agent.md"
    fi
  else
    def="$ROOT/.pi/agents/$role.md"
    if [[ -f "$def" ]]; then
      name="$(fm_name "$def")"
      if [[ "$name" == "$role" ]]; then
        if fm_has_desc "$def"; then
          ok "definition .pi/agents/$role.md (name=$role, description present)"
        else
          fail ".pi/agents/$role.md has no non-empty description"
        fi
      else
        fail ".pi/agents/$role.md frontmatter name is '$name', expected '$role'"
      fi
    else
      fail "role definition missing: .pi/agents/$role.md"
    fi
  fi

  if [[ ! -f "$skill" ]]; then
    fail "role skill missing: .github/skills/$role/SKILL.md"
  fi
done

# --- Factory-orchestrator skill and runtime profile -------------------------
CANON="$ROOT/.github/skills/factory-orchestrator/SKILL.md"
MIRROR="$ROOT/.agents/skills/factory-orchestrator/SKILL.md"
COPILOT_ORCHESTRATOR="$ROOT/.github/agents/factory-orchestrator.agent.md"

if [[ -f "$CANON" ]]; then
  canon_name="$(fm_name "$CANON")"
  if [[ "$canon_name" == "factory-orchestrator" ]]; then
    ok "canonical skill .github/skills/factory-orchestrator/SKILL.md"
  else
    fail "canonical skill frontmatter name is '$canon_name'"
  fi
else
  fail "canonical skill missing: .github/skills/factory-orchestrator/SKILL.md"
  MIRROR=""
fi

if [[ $COPILOT_ONLY -eq 1 ]]; then
  if [[ -f "$COPILOT_ORCHESTRATOR" ]] &&
    [[ "$(fm_name "$COPILOT_ORCHESTRATOR")" == "factory-orchestrator" ]] &&
    fm_has_desc "$COPILOT_ORCHESTRATOR"; then
    ok "Copilot orchestrator .github/agents/factory-orchestrator.agent.md"
  else
    fail "Copilot orchestrator profile missing or invalid"
  fi
elif [[ -f "$MIRROR" ]]; then
  mirror_name="$(fm_name "$MIRROR")"
  if [[ "$mirror_name" == "factory-orchestrator" ]]; then
    ok "mirror skill .agents/skills/factory-orchestrator/SKILL.md"
    if [[ -f "$CANON" ]]; then
      canon_desc="$(awk '/^description:/{sub(/^description:[[:space:]]+/,""); sub(/[[:space:]]+$/,""); print; exit}' "$CANON")"
      mirror_desc="$(awk '/^description:/{sub(/^description:[[:space:]]+/,""); sub(/[[:space:]]+$/,""); print; exit}' "$MIRROR")"
      if [[ "$canon_desc" != "$mirror_desc" ]]; then
        warn "mirror skill description differs from canonical — keep them identical (FACTORY.md)"
      fi
    fi
  else
    fail "mirror skill frontmatter name is '$mirror_name'"
  fi
else
  fail "mirror skill missing: .agents/skills/factory-orchestrator/SKILL.md"
fi

# --- Worktree script --------------------------------------------------------
if [[ -x "$SRC_DIR/factory-worktree.sh" ]]; then
  ok "scripts/factory-worktree.sh present + executable"
else
  fail "scripts/factory-worktree.sh missing or not executable"
fi

# --- Contract docs ----------------------------------------------------------
for doc in "${FACTORY_DOCS[@]}"; do
  if [[ -f "$ROOT/docs/$doc" ]]; then
    ok "docs/$doc"
  else
    fail "docs/$doc missing"
  fi
done

}

# ---------------------------------------------------------------------------
# Drive: check once; with --fix, re-verify after applying fixes
# ---------------------------------------------------------------------------

if [[ $FIX_ENABLED -eq 1 ]]; then
  PASS_LABEL="pass 1: "
  run_checks
  if (( FAILURES > 0 )); then
    PASS_LABEL="pass 2 (re-verify): "
    run_checks
  fi
else
  run_checks
fi

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

say
if [[ $FAILURES -eq 0 ]]; then
  if [[ $WARNINGS -gt 0 ]]; then
    say "Result: $WARNINGS warning(s), no failures — factory environment is valid."
  else
    say "Result: all checks passed — factory environment is valid."
  fi
  exit 0
else
  say "Result: $FAILURES failure(s), $WARNINGS warning(s) — factory environment is NOT fully set up."
  if [[ $FIX_ENABLED -eq 0 ]]; then
    say "Rerun with --fix to attempt safe remediation of installable items."
  fi
  exit 1
fi
