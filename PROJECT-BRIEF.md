# Project direction

## Purpose

Create a polished, mobile-first browser game for a three-person AI workshop team. The project is both a playable game prototype and a demonstration of an intentional, collaborative AI-assisted engineering workflow.

This document records the direction agreed so far. It is product context, not an implementation plan or a commitment to a specific technology.

## Product concept

Build an original, arcade-style maze-chase game with real-time competitive multiplayer. Players compete to survive in a shared maze, with a small set of readable power-ups and a modern, stylized visual treatment.

Use original game naming, characters, maze layouts, art, audio, and other assets. The team can draw on the broad maze-chase genre, but should not use Pac-Man branding or copy its distinctive characters or assets.

## Direction agreed so far

| Area | Current direction |
|---|---|
| Audience and platform | Mobile-first web game, targeting mobile browsers; responsive layout is desired. |
| Core mode | Online, real-time versus play. |
| Match concept | Balanced 1v1 or 2v2 hunters versus runners. Hunters normally eliminate runners on contact; a runner-only pickup temporarily makes hunters vulnerable and reverses the outcome. Eliminate the opposing team to win; simultaneous team wipes draw; runners win if both sides survive to 180 seconds. Eliminated players spectate; no attack button. |
| First match size | Start with up to 4 players. Treat 32 players as a possible later scalability goal, not an MVP requirement. |
| Match length | Aim for roughly 2–3 minutes. |
| Joining | Private rooms with a code or invite link first. Add quick play if time permits. |
| Controls | Four-direction movement with buffered turns; teammates pass through one another, opponents do not. Touch-control layout remains open. |
| Power-ups | Speed boost (1.5x for 5 seconds), shield (3 seconds), and runner-only global vulnerability (8 seconds, refresh not stack). A hunter shield overrides vulnerability while active. Randomized safe positions in one fixed maze. Vulnerability pickup respawns 10 seconds after the global effect ends; other pickups respawn 15 seconds after collection. See the [decision log](./docs/DECISIONS.md). |
| Visuals | Simple, recognizable, modern stylized art; 2D gameplay with selective 3D depth or effects. |
| Theme | Deliberately undecided; choose an original setting with the team. |
| Business model | Sample/workshop project; no monetization planned. |
| Timebox | Three full days. Prioritize a complete, demonstrable match over breadth. |

## MVP outcome

The MVP should let a small group of players:

1. Open the game on a mobile browser and enter a private room.
2. Join the same match using a room code or invite link.
3. Use responsive touch controls to move through a shared maze.
4. Compete in one complete survival round, including speed, shield, and runner-only vulnerability pickups.
5. See a clear round end and result, including the winner.

Room creation and joining are the first matchmaking slice. Quick play, accounts, public matchmaking, larger lobbies, and production-scale operations are not prerequisites for this outcome.

## Agreed technical direction and remaining choices

Use a TypeScript/Phaser client and a Node.js/Colyseus room server with shared
protocol/rules. The server owns gameplay truth and validates client intent.
Prioritize a local server and phone access over the local network first.
Cloud deployment is deferred; AWS or Azure remains the later direction.
Detailed checkpoint decisions are recorded in the [decision log](./docs/DECISIONS.md).

Rooms support balanced 1v1/2v2 and a host-triggered 3-second countdown, cancelled
if balance is lost. No mid-round joins or seamless reconnect in MVP. Remove
disconnected players; an empty side loses, both empty sides abandon the round.
Transfer lobby host when necessary and delete empty rooms.

Before implementation, decide and record:

- Compatible library/runtime versions and shared message/state contract.
- Hosting/deployment approach and how teammates will share a playable build.
- Detailed room lifecycle and deterministic event resolution.
- Device/browser test matrix and the minimum performance target.

Keep the game rules and network messages small and explicit. Avoid making a 32-player architecture, 3D production pipeline, account system, or complex matchmaking service a prerequisite for the first playable round.

## Open product decisions

- Original title, setting, character designs, maze style, and audio direction.
- Detailed movement/contact resolution, especially at the round deadline.
- Exact pickup/contact processing order within a simulation step.
- Whether a round starts when the room is full or after a short countdown.
- Touch-control layout, portrait/landscape behavior, accessibility options, and desktop fallback.
- How eliminated players spectate and how results are presented.
- Whether quick play is achievable after private rooms and a complete match work.

Resolve decisions in the order they affect the next playable increment. Record consequential changes so that product context and implementation do not drift apart.

Checkpoint decisions and unresolved mechanics are tracked in the
[shared decision log](./docs/DECISIONS.md). Its confirmed entries supersede
incompatible gameplay proposals in the delivery plan.

## Suggested AI-first collaboration workflow

The workshop guide emphasizes that clear context, explicit specifications, task-sized planning, and human review have more leverage than generating code quickly. Use this brief as the shared product starting point, then keep the workflow lightweight and visible.

### Shared source of truth

- Keep product intent, constraints, terminology, and current decisions in version control.
- For each feature, write a short spec before implementation: user outcome, rules, acceptance criteria, edge cases, and how it will be tested.
- Record architecture choices as short decision notes, including the alternatives considered and why the team chose one.
- Update shared context when a decision changes; avoid relying on one person's chat history as project memory.

### Use AI in bounded, reviewable steps

1. Ask an AI assistant to clarify the problem and propose acceptance criteria before asking it to implement.
2. Have it outline a small plan that maps directly to the spec.
3. Delegate only independent, well-bounded work. Keep shared interfaces and integration decisions coordinated by a teammate.
4. Ask for focused tests with each behavior change, then run the checks and review the diff as humans.
5. Use a separate review pass to look for missed requirements, mobile usability issues, multiplayer edge cases, and regressions.
6. Require the implementer to report what changed, what was tested, and what remains uncertain.

### Suggested role split for three people

Treat these as rotating areas of ownership, not silos:

- **Product and game experience:** owns the rules/specs, touch interaction, and playtesting feedback.
- **Multiplayer and platform:** owns room lifecycle, real-time state flow, and deployment concerns.
- **Integration and quality:** owns shared contracts, end-to-end testing, and keeping the playable build and project context current.

Pair on architecture and integration points. Rotate who drives the AI workflow so that all three people can explain and demonstrate it.

### Demonstrate the workflow, not just the game

Keep a small trail of evidence the team can show: a feature spec and its acceptance criteria, a plan refined by human feedback, a bounded AI-assisted implementation, tests or a manual test record, and a review that caught or prevented a problem. The aim is to show that AI accelerated a well-directed engineering process—not that generated code was accepted without understanding.

## Scope guardrails

- Make a complete small match the success criterion; defer scale and polish that do not support it.
- Test on real target mobile browsers early, especially touch input and viewport behavior.
- Prefer original or properly licensed assets; do not assume workshop use grants rights to third-party game assets.
- Do not put credentials, private participant information, or other sensitive material into AI prompts.
- Treat AI output as a proposal. Team members remain responsible for design decisions, code, tests, and the demo.
