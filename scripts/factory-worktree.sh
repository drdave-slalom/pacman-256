#!/usr/bin/env bash
# Factory worktree helper — isolate each agent unit in its own checkout.
#
# The software factory (docs/FACTORY.md) gives every concurrent subagent its
# own git worktree so parallel agents never write to the same files. Each
# worktree is a sibling of the main repository, on its own `factory/<unit>`
# branch, with an independent node_modules (separate npm ci).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
WT_PARENT="$(dirname "$REPO_ROOT")"

usage() {
  cat <<EOF
Usage: factory-worktree.sh <create|remove|list> [unit] [base]

Commands:
  create <unit> [base]   Create sibling worktree
                         ${WT_PARENT}/${REPO_NAME}-wt-<unit>
                         on branch factory/<unit> from base (default: current
                         HEAD), run npm ci inside, and print the worktree path.
  remove <unit>           Remove the worktree ${WT_PARENT}/${REPO_NAME}-wt-<unit>
                         and its factory/<unit> branch (worktree must be clean).
  list                   List factory worktrees.
EOF
}

cmd="${1:-}"
unit="${2:-}"
base="${3:-}"

case "$cmd" in
  create)
    [[ -z "$unit" ]] && { usage; exit 1; }
    wt="$WT_PARENT/${REPO_NAME}-wt-$unit"
    branch="factory/$unit"
    if [[ -d "$wt" ]]; then
      echo "ERROR: worktree already exists: $wt" >&2
      exit 1
    fi
    git fetch origin --quiet || true
    git worktree add -b "$branch" "$wt" "${base:-HEAD}"
    (
      cd "$wt"
      npm ci
    )
    echo "WORKTREE=$wt"
    echo "BRANCH=$branch"
    ;;
  remove)
    [[ -z "$unit" ]] && { usage; exit 1; }
    wt="$WT_PARENT/${REPO_NAME}-wt-$unit"
    branch="factory/$unit"
    if [[ ! -d "$wt" ]]; then
      echo "ERROR: worktree not found: $wt" >&2
      exit 1
    fi
    git worktree remove "$wt"
    git branch -D "$branch" 2>/dev/null || true
    ;;
  list)
    git worktree list | grep -- "-wt-" || true
    ;;
  *)
    usage
    exit 1
    ;;
esac
