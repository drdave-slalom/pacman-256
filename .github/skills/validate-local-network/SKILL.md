---
name: validate-local-network
description: "Use when the user asks to run or validate the game from a phone on the same trusted local network."
---

# Validate Local Network

Check that the documented local game build can be reached from a phone on the same trusted network. Distinguish machine-side checks from tests that require the physical phone.

## Workflow

1. Read applicable project instructions and inspect the current README, package manifests, scripts, and server/client bind configuration. Use only documented, existing commands; do not guess a package manager or add scripts.
2. Explain any required host binding before using it. Binding beyond localhost is allowed only for a trusted private LAN. Do not expose ports to the public internet, create tunnels, configure router port forwarding, disable a firewall, or change tracked configuration. Ask before a persistent or security-sensitive change.
3. Start the server and client as documented, keeping required processes running. Report their ports and identify the development machine's LAN address using an OS-appropriate command. Do not print credentials or environment secrets.
4. Check the local page and any documented health/connection endpoint from the development machine. Provide the exact URL for the phone, note that the phone and computer must be on the same reachable network, and give concise steps for checking page load, server connection, orientation, touch input, and room flow if implemented.
5. Separate checks performed on the development machine from checks that require the user to open the URL on a physical phone. Do not report phone compatibility as verified until that device check has actually occurred. If no runnable game or documented command exists, report the blocker instead of inventing setup.

Finish with running processes, desktop checks and results, phone URL, phone checks still needed, and network limitations.