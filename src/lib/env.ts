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
  get OPENAI_API_KEY() {
    return process.env.OPENAI_API_KEY || undefined;
  },
};
