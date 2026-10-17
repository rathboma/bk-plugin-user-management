/**
 * Passwords are hashed in the plugin, the way psql's \password does, so the
 * plain text never reaches the server: CREATE ROLE and ALTER ROLE statements
 * end up in server logs and pg_stat_statements.
 */
import { md5Hex } from "../../core/md5";

export type PasswordEncoding = "scram-sha-256" | "md5" | "plain";

export interface EncodedPassword {
  /** What is sent to the server. */
  value: string;
  encoding: PasswordEncoding;
  /** Why the password couldn't be hashed. */
  warning?: string;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * SCRAM-SHA-256 verifier in PostgreSQL's storage format:
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` (RFC 5802/7677).
 */
export async function scramVerifier(
  password: string,
  options: { iterations?: number; salt?: Uint8Array } = {}
): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();
  const iterations = options.iterations ?? 4096;
  const salt = options.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));

  const passwordKey = await subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salted = new Uint8Array(
    await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, passwordKey, 256)
  );
  const hmacKey = await subtle.importKey("raw", salted, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const clientKey = new Uint8Array(await subtle.sign("HMAC", hmacKey, encoder.encode("Client Key")));
  const storedKey = new Uint8Array(await subtle.digest("SHA-256", clientKey));
  const serverKey = new Uint8Array(await subtle.sign("HMAC", hmacKey, encoder.encode("Server Key")));

  return `SCRAM-SHA-256$${iterations}:${base64(salt)}$${base64(storedKey)}:${base64(serverKey)}`;
}

/** PostgreSQL's legacy format: "md5" + md5(password + role name). */
export function md5Verifier(password: string, roleName: string): string {
  return `md5${md5Hex(password + roleName)}`;
}

/**
 * Encodes a password the way the server would store it, following its
 * password_encryption setting.
 */
export async function encodePassword(
  password: string,
  roleName: string,
  settings: { passwordEncryption?: string; scramIterations?: number }
): Promise<EncodedPassword> {
  if (settings.passwordEncryption === "md5") {
    return { value: md5Verifier(password, roleName), encoding: "md5" };
  }
  // PostgreSQL normalizes SCRAM passwords with SASLprep, which only changes
  // non-ASCII text. Hashing those here could store a different password.
  if (!/^[\x20-\x7e]*$/.test(password)) {
    return {
      value: password,
      encoding: "plain",
      warning: "The password has non-ASCII characters, so it is sent as plain text for the server to hash.",
    };
  }
  if (!globalThis.crypto?.subtle) {
    return {
      value: password,
      encoding: "plain",
      warning: "Password hashing isn't available here, so the password is sent as plain text.",
    };
  }
  return { value: await scramVerifier(password, { iterations: settings.scramIterations }), encoding: "scram-sha-256" };
}
