/**
 * Normalized identity matching (spec: "Normalized identity").
 *
 * - `canonicalId` lowercases and collapses non-alphanumerics. Leading path
 *   segments up to and including a `factory/` segment are dropped so that
 *   branch refs like `factory/t6`, `origin/factory/t6` and `refs/heads/factory/t6`
 *   all canonicalize to `t6`.
 * - Matching uses both the spec's containment rule ("contains or equals …
 *   scored by overlap length") and a token-overlap rule. The token rule is
 *   needed for the factory's real labels (e.g. handoff agent `t6-review` must
 *   join unit `T6-match-hud-spectate-results.md` even though the canonical
 *   strings do not contain each other). The highest-scoring non-zero match
 *   wins; ties are resolved deterministically.
 */

export function canonicalId(input: string): string {
  let s = input.trim();
  s = s.replace(/^refs\/heads\//, "");
  s = s.replace(/^refs\/remotes\/origin\//, "");
  const factorySegment = s.match(/^(?:.*\/)?factory\/(.*)$/);
  if (factorySegment) s = factorySegment[1] ?? "";
  // A SPEC filename's `.md` extension is not part of the unit identity.
  s = s.replace(/\.md$/i, "");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Generic tokens that appear across many unit/artifact families and never
 * uniquely identify a factory unit. They are excluded from token-overlap
 * scoring so a low-specificity artifact cannot false-join on a shared generic
 * word (review F2). `factory` is the namespace prefix; the rest are broad
 * factory-control-domain words. Containment scoring is unaffected.
 */
const GENERIC_TOKENS = new Set([
  "factory",
  "control",
  "center",
  "spec",
  "web",
  "ui",
  "tui",
  "review",
  "qa",
  "docs",
  "actions",
  "impl",
  "test",
  "m0",
]);

export function tokensOf(input: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of input.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 0 && !GENERIC_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

const CONTAIN_OR_EQUAL = 10_000;
const TOKEN_MATCH = 1_000;

/**
 * Score how strongly `a` matches `b`. Returns 0 when there is no meaningful
 * overlap.
 */
export function matchScore(
  aCanon: string,
  aTokens: Set<string>,
  bCanon: string,
  bTokens: Set<string>,
): number {
  let score = 0;
  if (aCanon === bCanon) {
    score += CONTAIN_OR_EQUAL + aCanon.length;
  } else if (aCanon.length > 0 && aCanon.includes(bCanon)) {
    score += CONTAIN_OR_EQUAL / 2 + bCanon.length;
  } else if (bCanon.length > 0 && bCanon.includes(aCanon)) {
    score += CONTAIN_OR_EQUAL / 2 + aCanon.length;
  }
  let sharedLength = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) sharedLength += token.length;
  }
  if (sharedLength > 0) score += TOKEN_MATCH + sharedLength;
  return score;
}

export interface MatchCandidate<T> {
  score: number;
  value: T;
}

/**
 * Choose the best candidate for an artifact canonical id/token pair. Returns
 * `undefined` when no candidate has a non-zero score.
 */
export function bestMatch<T>(
  artifactCanon: string,
  artifactTokens: Set<string>,
  candidates: readonly T[],
  canonicalOf: (value: T) => string,
  tokensOfValue: (value: T) => Set<string>,
): MatchCandidate<T> | undefined {
  let best: MatchCandidate<T> | undefined;
  for (const candidate of candidates) {
    const score = matchScore(
      artifactCanon,
      artifactTokens,
      canonicalOf(candidate),
      tokensOfValue(candidate),
    );
    if (score <= 0) continue;
    if (best === undefined || score > best.score) {
      best = { score, value: candidate };
    }
  }
  return best;
}
