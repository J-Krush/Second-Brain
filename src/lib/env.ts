/**
 * Central env access. Throws early on missing required vars so a
 * misconfigured deploy fails loudly instead of at first request.
 */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get APP_PASSWORD_HASH() {
    return required("APP_PASSWORD_HASH");
  },
  get SESSION_SECRET() {
    return required("SESSION_SECRET");
  },
  get API_TOKEN() {
    return process.env.API_TOKEN || undefined;
  },
  get R2_ACCOUNT_ID() {
    return required("R2_ACCOUNT_ID");
  },
  get R2_ACCESS_KEY_ID() {
    return required("R2_ACCESS_KEY_ID");
  },
  get R2_SECRET_ACCESS_KEY() {
    return required("R2_SECRET_ACCESS_KEY");
  },
  get R2_BUCKET() {
    return required("R2_BUCKET");
  },
  // Optional override of the S3 endpoint (MinIO, NAS, etc.). Defaults to the
  // Cloudflare R2 endpoint derived from the account id.
  get R2_ENDPOINT() {
    return process.env.R2_ENDPOINT || undefined;
  },
  // Workers AI (embeddings) via REST so `next dev` and the Worker share one
  // code path. Token needs the "Workers AI - Read" permission.
  get CF_ACCOUNT_ID() {
    return process.env.CF_ACCOUNT_ID || undefined;
  },
  get CF_AI_TOKEN() {
    return process.env.CF_AI_TOKEN || undefined;
  },
  get CRON_SECRET() {
    return process.env.CRON_SECRET || undefined;
  },
  // Which model answers /ask (see src/lib/llm.ts). Unset = retrieval only.
  get LLM_PROVIDER() {
    return process.env.LLM_PROVIDER || undefined;
  },
};
