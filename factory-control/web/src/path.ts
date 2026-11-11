/**
 * Safely decode a unit id from a route segment. Returns `null` when the
 * percent-encoding is malformed (e.g. `/unit/%zz`), so callers can fall back
 * to the NotFound state instead of throwing during render.
 */
export function decodeUnitId(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
