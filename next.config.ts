import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg loads pg-cloudflare (TCP sockets) under the "workerd" export condition.
  // Next's tracer only copies the Node build (an empty stub), and OpenNext
  // copies a package's full workerd build only when it is listed here.
  serverExternalPackages: ["pg-cloudflare"],
};

// Makes getCloudflareContext() work under `next dev` with wrangler-simulated
// bindings (Images, Hyperdrive -> local Postgres) from wrangler.jsonc. Remote
// bindings stay off so local dev never touches (or bills) a real account; the
// Workers AI binding is therefore absent locally and search degrades to FTS.
initOpenNextCloudflareForDev({ remoteBindings: false });

export default nextConfig;
