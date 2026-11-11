import assert from "node:assert/strict";
import { test } from "node:test";
import { bestMatch, canonicalId, matchScore, tokensOf } from "./canonical.ts";

test("canonicalId lowercases and collapses non-alphanumerics", () => {
  assert.equal(canonicalId("T3-private-rooms-and-synchronized-movement.md"), "t3privateroomsandsynchronizedmovement");
  assert.equal(canonicalId("Unbalanced lobbies (no even team requirement)"), "unbalancedlobbiesnoeventeamrequirement");
});

test("canonicalId strips the factory/ branch prefix", () => {
  assert.equal(canonicalId("factory/t4-mobile-lobby"), "t4mobilelobby");
  assert.equal(canonicalId("origin/factory/t6"), "t6");
  assert.equal(canonicalId("refs/heads/factory/unbalanced-lobby"), "unbalancedlobby");
  assert.equal(canonicalId("factory/t24-complete"), "t24complete");
});

test("containment scoring works both directions", () => {
  const unit = "t6matchhudspectateresults";
  // Branch factory/t6 canonicalizes to t6 and is contained by the unit.
  assert.ok(matchScore("t6", tokensOf("factory/t6"), unit, tokensOf("T6-match-hud-spectate-results.md")) > 0);
  // Vice versa direction also scores.
  assert.ok(matchScore(unit, tokensOf("T6-match-hud-spectate-results.md"), "t6", tokensOf("factory/t6")) > 0);
});

test("token overlap joins real agent labels to units", () => {
  assert.ok(matchScore("t6review", tokensOf("t6-review"), "t6matchhudspectateresults", tokensOf("T6-match-hud-spectate-results.md")) > 0);
  assert.ok(matchScore("unbalancedreview", tokensOf("unbalanced-review"), "unbalancedlobbies", tokensOf("unbalanced-lobbies.md")) > 0);
});

test("unrelated artifacts do not match", () => {
  assert.equal(matchScore("ghtrackerconfig", tokensOf("gh-tracker-config"), "t3privateroomsandsynchronizedmovement", tokensOf("T3-private-rooms-and-synchronized-movement.md")), 0);
  assert.equal(matchScore("t2keyboard", tokensOf("t2-keyboard"), "t6matchhudspectateresults", tokensOf("T6-match-hud-spectate-results.md")), 0);
});

test("bestMatch picks the highest-scoring non-zero candidate", () => {
  const units = [
    { id: "factorycontrolsnapshot", tokens: tokensOf("factory-control-snapshot.md") },
    { id: "factorycontroltui", tokens: tokensOf("factory-control-tui.md") },
    { id: "t6matchhudspectateresults", tokens: tokensOf("T6-match-hud-spectate-results.md") },
  ];
  const best = bestMatch(
    canonicalId("factory/fc-m0-snapshot"),
    tokensOf("factory/fc-m0-snapshot"),
    units,
    (u) => u.id,
    (u) => u.tokens,
  );
  assert.ok(best);
  assert.equal(best.value.id, "factorycontrolsnapshot");
});

test("bestMatch returns undefined when nothing matches", () => {
  const units = [{ id: "t6matchhudspectateresults", tokens: tokensOf("T6-match-hud-spectate-results.md") }];
  const best = bestMatch(canonicalId("factory/gh-tracker-config"), tokensOf("factory/gh-tracker-config"), units, (u) => u.id, (u) => u.tokens);
  assert.equal(best, undefined);
});

test("F2: artifact sharing only a generic token does not match (guard)", () => {
  const units = [
    { id: "factorycontrolsnapshot", tokens: tokensOf("factory-control-snapshot.md") },
    { id: "factorycontrolwebmirror", tokens: tokensOf("factory-control-web-mirror.md") },
  ];
  // `control` is generic and denylisted; the canonical id does not contain it
  // either, so there is no legitimate overlap with either candidate.
  const best = bestMatch(canonicalId("zz-control"), tokensOf("zz-control"), units, (u) => u.id, (u) => u.tokens);
  assert.equal(best, undefined);
});

test("F2: higher-specificity candidate wins a generic-token race", () => {
  const units = [
    { id: "factorycontrolsnapshot", tokens: tokensOf("factory-control-snapshot.md") }, // shares only generic `control` pre-guard
    { id: "factorycontrolwebmirror", tokens: tokensOf("factory-control-web-mirror.md") }, // shares specific `mirror`
  ];
  const best = bestMatch(canonicalId("mirror-fc"), tokensOf("mirror-fc"), units, (u) => u.id, (u) => u.tokens);
  assert.ok(best);
  assert.equal(best.value.id, "factorycontrolwebmirror");
});

test("F2: equal scores resolve deterministically to the first candidate", () => {
  const units = [
    { id: "t6matchhudspectateresults", tokens: tokensOf("T6-match-hud-spectate-results.md") },
    { id: "t6reviewq", tokens: tokensOf("t6-review-q") },
  ];
  const best1 = bestMatch(canonicalId("t6-x"), tokensOf("t6-x"), units, (u) => u.id, (u) => u.tokens);
  const best2 = bestMatch(canonicalId("t6-x"), tokensOf("t6-x"), units, (u) => u.id, (u) => u.tokens);
  assert.ok(best1 && best2);
  assert.equal(best1.value.id, best2.value.id);
  assert.equal(best1.value.id, "t6matchhudspectateresults");
});

test("F2: containment stays dominant over pure token overlap", () => {
  const units = [
    { id: "factorycontrolsnapshot", tokens: tokensOf("factory-control-snapshot.md") },
    { id: "snapshotking", tokens: tokensOf("snapshot-king") },
  ];
  const best = bestMatch(canonicalId("factory-control-snapshot.md"), tokensOf("factory-control-snapshot.md"), units, (u) => u.id, (u) => u.tokens);
  assert.ok(best);
  assert.equal(best.value.id, "factorycontrolsnapshot");
});
