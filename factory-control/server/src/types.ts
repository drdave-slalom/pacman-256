/**
 * Snapshot model for the factory control center (M0).
 *
 * Type-only re-export of the canonical shared model
 * (`@maze/factory-control-shared`). Keeping this module as the server's
 * import surface means internal server code (`./types.ts` imports) is
 * unchanged; the web mirror (M1) consumes the same single module.
 */
export type {
  Attention,
  AgentRecord,
  BranchFacts,
  CheckState,
  DiffTotals,
  FactorySnapshot,
  HandoffRef,
  IssueCard,
  IssueLabels,
  Lifecycle,
  OrphanedBucket,
  PullRequest,
  RepoFacts,
  Stage,
  Unit,
  UnitFlags,
  UnitKind,
  UnitPr,
  UnitWorktree,
  WorktreeFacts,
} from "@maze/factory-control-shared";
