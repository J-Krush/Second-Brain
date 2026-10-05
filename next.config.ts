import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

// Makes getCloudflareContext() work under `next dev` with wrangler-simulated
// bindings (Images, Hyperdrive -> local Postgres) from wrangler.jsonc.
initOpenNextCloudflareForDev();

export default nextConfig;
