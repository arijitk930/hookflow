export const MAX_JSON_DEPTH = 32;

/** NUL and unpaired surrogates are valid JSON but PostgreSQL's jsonb rejects them. */
const UNSTORABLE_TEXT = /[\u0000\p{Cs}]/u;

/**
 * Returns why a parsed JSON value can't be accepted, or null if it is fine.
 * Iterative, so hostile nesting can't overflow the stack.
 */
export function findJsonProblem(root: unknown): string | null {
  const pending: Array<[value: unknown, depth: number]> = [[root, 1]];

  while (pending.length > 0) {
    const [value, depth] = pending.pop()!;

    if (typeof value === "string") {
      if (UNSTORABLE_TEXT.test(value)) return "Contains characters that cannot be stored";
    } else if (typeof value === "number") {
      // e.g. 1e999 parses to Infinity and would silently be stored as null
      if (!Number.isFinite(value)) return "Contains a number that is out of range";
    } else if (typeof value === "object" && value !== null) {
      if (depth > MAX_JSON_DEPTH) return `Nested deeper than ${MAX_JSON_DEPTH} levels`;
      for (const [key, child] of Object.entries(value)) {
        if (UNSTORABLE_TEXT.test(key)) return "Contains characters that cannot be stored";
        pending.push([child, depth + 1]);
      }
    }
  }

  return null;
}
