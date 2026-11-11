# U1 spec: shared schema/types for GitHub issue cards + unit linking

**Status:** Approved — delegated. · **Tracker:** [#59](https://github.com/drdave-slalom/pacman-256/issues/59). · **Surface:** `factory-control/shared/src/index.ts`, `factory-control/server/src/types.ts` (re-export), any constructors/fixtures that build `Unit`/`FactorySnapshot`.

## Goal

Extend the canonical shared snapshot model so the server can represent GitHub
issues as cards and link them to units, without breaking the closed-union
discipline (compiler catches drift between spec vocabulary and code) or the
shared-verbatim rule between server and web mirror.

## Scope (in)

Add to `factory-control/shared/src/index.ts`:

```ts
export type UnitKind = "spec" | "issue" | "hybrid" | "unknown";

export interface IssueLabels {
  type?: string;        // type:feature|bug|chore|docs
  role?: string[];      // role:builder|qa|review|design|art|docs (0..n)
  lane?: string;        // lane:A|B|C
  status?: string;      // status:spec|ready|in-progress|review
  blocked: boolean;     // label "blocked"
  followUp: boolean;    // label "follow-up"
  playtest: boolean;    // label "playtest"
  raw: string[];        // every label name, verbatim
}

export interface IssueCard {
  number: number;
  title: string;
  state: "open" | "closed" | "unknown";
  url: string;
  bodyExcerpt?: string; // trimmed first ~200 chars of body (defensive)
  labels: IssueLabels;
  assignees: string[];
  milestone?: string;
  createdAt?: string;
  updatedAt?: string;
}
```

Extend existing types:

```ts
interface Unit {
  // existing fields unchanged …
  kind: UnitKind;        // new, required
  issue?: IssueCard;     // new; set when unit is seeded from or linked to an issue
}

interface FactorySnapshot {
  // existing fields unchanged …
  issues: IssueCard[];   // new; all ingested issues (open + closed), raw
}
```

- Keep `OrphanedBucket` unchanged (unmatched issues are standalone cards, not orphaned).
- Update `factory-control/server/src/types.ts` re-export list with the new names.
- Update any fixtures/constructors that assemble `Unit`/`FactorySnapshot` across
  server/web/tui tests so they compile with the new required `kind` (default
  `"spec"` in test fixtures is acceptable).

## Out of scope

- Reader/`gh` integration (U2), snapshot weaving/inference (U3), actions (U4/U5), UI (U6/U7).
- Changing existing field meanings or removing fields.

## Acceptance criteria

1. Shared package exports `UnitKind`, `IssueLabels`, `IssueCard`; `Unit.kind` and `Unit.issue` and `FactorySnapshot.issues` exist as specified.
2. `npm --workspace factory-control/shared run typecheck` passes; `npm --workspace factory-control/shared run build` emits types.
3. Existing server/web/tui workspaces still typecheck and their tests pass (fixtures updated).
4. No duplicate type definitions; server `types.ts` re-exports the new names (type-only).

## Validation

Inside the worktree: `npm --workspace factory-control/shared run build`, `npm --workspace factory-control/shared run typecheck`, `npm run test` (incl. `factory-control/server` + `factory-control/web` + `factory-control/tui` test suites), `npm run typecheck`.

## Handoff

Implementer reports: files changed, exact added type shapes, fixture updates, test results, risks. Forward the resulting shared types as the interface contract for U2/U3.
