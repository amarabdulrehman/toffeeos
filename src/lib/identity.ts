import { z } from "zod";

/**
 * How a person identifies themselves: an email, and a restaurant code.
 *
 * Neither is case-sensitive to a human, and both were case-sensitive here. That mattered most on
 * the devices staff actually use — an iPad keyboard capitalises the first letter of a text field
 * without being asked, so "Karachi-karahi" or "Ali@cafe.com" failed to sign in while looking exactly
 * right on screen. A trailing space from autocomplete did the same.
 *
 * So both are trimmed and lowercased at the edge, once, by the schema that reads them, and stored
 * lowercased. Every lookup then compares like with like. Passwords are deliberately not touched:
 * they stay exact, because that is what makes them worth having.
 *
 * Exact comparison on the normalized value rather than Prisma's `mode: "insensitive"`, which on
 * Postgres is ILIKE — where `_` and `%` are wildcards. A login for `a_b@x.com` must not be able to
 * match `axb@x.com`, even with the password still standing in the way.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/** An email as a person types it, normalized before it is validated. */
export function emailInput() {
  return z.string().trim().toLowerCase().email();
}

/** A restaurant code as a person types it, normalized before it is validated. */
export function slugInput() {
  return z.string().trim().toLowerCase().min(1);
}
