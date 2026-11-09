---
description: "Build and launch this workspace's game using its documented, current project commands."
mode: agent
---

Build and run the game in this workspace (the `pacman-256` project, not a system package or another game).

1. Read the current `README.md`, applicable `AGENTS.md` files, and builder instructions. Inspect the actual package manifests, lockfiles, scripts, and app entry points before choosing commands; do not rely on stale instructions or guess a package manager or script.
2. Install dependencies only when the repository's manifests and lockfiles identify the package manager and dependencies are missing. Run the documented build and test checks when available, then launch the client and any required server using the project's existing scripts.
3. If a process must remain running for the user to try the game, leave it running and report the local URL. If phone access is supported, report the local-network address and any known network prerequisites without exposing secrets.
4. Verify the app responds or renders using available browser/preview tools when possible. Distinguish a working connection check or scaffold from playable gameplay; do not claim the game is playable unless verified.
5. If a required command or implementation is missing, or startup fails, report the exact command and concise error/evidence. Do not silently add scripts, change dependencies, or modify application code as part of this run command.

Finish with what is running, the URL, checks performed and their results, and any limitations.