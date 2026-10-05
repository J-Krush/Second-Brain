import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is force-dynamic and no route uses ISR or `use cache`, so no
// incremental cache backend is configured. Add an R2 cache here if that ever
// changes: https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig({});
