# pacman-256

An original, mobile-first browser game prototype: a real-time team-versus maze
chase for small groups. `pacman-256` is the repository's working name, not an
approved game title or permission to use Pac-Man branding, characters, or assets.

## Game

Players join a private room and compete as hunters or runners in a shared maze.
Matches support balanced 1v1 or 2v2 teams, with up to four players in the MVP.
Hunters normally eliminate runners by contact. A runner-only pickup temporarily
makes unshielded hunters vulnerable, reversing the contact outcome. Speed boosts
and shields provide the other pickup effects.

Eliminate the opposing team to win. A simultaneous team wipe is a draw; if both
teams survive to the 180-second limit, the runners win. Eliminated players
spectate. The intended experience is touch-first and optimized for mobile
browsers, with desktop support as appropriate.

The game identity, setting, characters, maze art, and audio should be original.
The final title and theme have not been chosen.

## Project Status

The product direction and shared game contract are documented, but this
repository is not yet a complete playable game. The generated client output
currently shows a T1 server-connection check; gameplay and private-room flows
are still future work. Browser support and performance targets have not yet
been established through device testing.

There are currently no checked-in package manifests or documented install,
build, test, or start commands. Reproducible development instructions should be
added here when those commands are established; do not infer them from generated
output or local dependency directories.

## Intended Architecture

- **Client:** TypeScript and Phaser browser client.
- **Server:** Node.js and Colyseus room server.
- **Shared package:** protocol and game rules used by both client and server.
- **Authority:** the server validates player intent and owns movement, collisions, pickups, timers, eliminations, and match results. Clients render authoritative state and must not declare game outcomes.
- **Validation path:** prioritize a local server and phone access over the local network. Cloud deployment is deferred.

These are the team's agreed technical direction, not a claim that the full
architecture or gameplay is implemented.

## Repository Guide

| Path | Purpose |
| --- | --- |
| `PROJECT-BRIEF.md` | Product direction, MVP outcome, and open product questions. |
| `docs/DECISIONS.md` | Confirmed decisions, superseded proposals, and unresolved follow-ups. |
| `docs/GAME-CONTRACT.md` | Approved baseline for room lifecycle, game state, rules, and event ordering. |
| `DELIVERY-PLAN.md` | Draft sequencing and estimates; confirmed decisions take precedence. |
| `apps/client/` | Browser client work. |
| `apps/server/` | Multiplayer room server work. |
| `packages/shared/` | Shared protocol and game rules. |

## Scope

The MVP is one complete, demonstrable mobile-browser match: create or join a
private room, move through a shared maze with touch controls, use speed, shield,
and runner-only vulnerability pickups, spectate after elimination, and see a
clear result. Quick play is a stretch goal. Accounts, public matchmaking,
32-player rooms, and production-scale infrastructure are outside the initial
scope.

## Working on the Project

Before changing game behavior or shared interfaces, consult the brief, decision
log, and game contract. The contract is an approved baseline, but implementation
still requires a separate go-ahead. Do not treat proposals in the delivery plan
as confirmed rules.

For authorized work, agree on task ownership and acceptance criteria, make small
reviewable changes, and run the relevant checks. Validate local-network phone
access before cloud deployment. Record approved behavior or architecture
changes in the decision log and reconcile affected documents. Report checks run
and limitations; do not claim device compatibility without testing on the
devices and browsers concerned.
