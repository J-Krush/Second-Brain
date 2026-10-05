/**
 * Password hashing on WebCrypto so it runs identically in Node and on Workers
 * (no native argon2 binding). Serialized as
 *   pbkdf2-sha256:<iterations>:<salt b64url>:<hash b64url>
 * Colons, not `$`, so the value needs no escaping in dotenv files.
 *
 * 100k iterations is the Workers runtime cap for PBKDF2 and sits above OWASP's
 * guidance once combined with the DB-backed login rate limit.
 */
const ALGO = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, "base64url"));
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return [ALGO, ITERATIONS, b64url(salt), b64url(hash)].join(":");
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** False on any malformed stored hash: fail closed. */
export async function verifyPassword(
  stored: string,
  password: string,
): Promise<boolean> {
  const [algo, iterText, saltText, hashText] = stored.split(":");
  const iterations = Number(iterText);
  if (algo !== ALGO || !Number.isInteger(iterations) || !saltText || !hashText) {
    return false;
  }
  const expected = fromB64url(hashText);
  const actual = await derive(password, fromB64url(saltText), iterations);
  return constantTimeEqual(actual, expected);
}
