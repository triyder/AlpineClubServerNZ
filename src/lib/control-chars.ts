/**
 * Control characters in single-line text, in ONE place.
 *
 * Zod's string checks let a NUL (or any other C0 control) through, and Postgres
 * then rejects the row — so a club upload that is not transactional could
 * create hundreds of lodges and then fail with a 500, and an admin form could
 * do the same one row at a time. Every single-line text field (lodge names and
 * details, officer contact, amenities, image labels) refines on this, so a bad
 * value is a 400 before anything is written.
 *
 * Tab, newline and carriage return are refused too: none of these fields is
 * multi-line. (`normalizePostContent` keeps them for post bodies, which are.)
 */
export const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export const NO_CONTROL_CHARS_MESSAGE = "Control characters are not allowed";

/** Zod refinement: true when the value carries no control character. */
export function noControlChars(value: string): boolean {
  return !CONTROL_CHARS.test(value);
}

/** The same characters removed, for text that is derived rather than refused. */
export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "");
}
