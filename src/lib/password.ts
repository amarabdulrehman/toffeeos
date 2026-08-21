import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

const SALT_ROUNDS = 10;

// Excludes visually-confusable characters (0/O, 1/I/l) since this is read off a screen once and
// typed back in by hand on first login.
const TEMP_PASSWORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

/** A random one-time password for admin-provisioned accounts (tenant owners created by a platform
 * admin) — the caller is responsible for showing it to the operator exactly once and never
 * persisting the plaintext. 12 chars from a 56-char alphabet is ~68 bits of entropy. */
export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Same algorithm as passwords — PINs are short, but they're hashed for the same reason passwords
// are: a DB dump should never hand out working credentials.
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
