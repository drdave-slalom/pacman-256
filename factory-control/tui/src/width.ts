/**
 * Terminal-width helpers for the factory-control TUI.
 *
 * pi's `@earendil-works/pi-tui` ships `visibleWidth()`/`truncateToWidth()`.
 * The pure renderers/selectors in this package intentionally avoid importing pi
 * runtime packages so their tests run without a live TUI. These local helpers
 * implement the same contract (measure visible columns, not string length) and
 * the interactive screen applies pi's own `truncateToWidth()` as a final
 * safety net over every rendered line.
 */

const COMBINING_RE = /^[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]$/;

const WIDE_RE =
  /^[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]$/u;

/** Visible column width of a single code point. */
export function charWidth(ch: string): number {
  const code = ch.codePointAt(0);
  if (code === undefined) return 0;
  if (code < 32 || (code >= 0x7f && code <= 0x9f)) return 0;
  if (COMBINING_RE.test(ch)) return 0;
  return WIDE_RE.test(ch) ? 2 : 1;
}

/** Visible column width of a string (combining marks and controls count 0). */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width;
}

/** Truncate a string so its visible width does not exceed `maxWidth`. */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  let out = "";
  for (const ch of text) {
    const w = charWidth(ch);
    if (width + w > maxWidth) break;
    out += ch;
    width += w;
  }
  return out;
}
