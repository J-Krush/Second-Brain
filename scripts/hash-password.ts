import { hash } from "@node-rs/argon2";

// Usage: pnpm hash-password "my password"
async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: pnpm hash-password "your password"');
    process.exit(1);
  }
  const digest = await hash(password, {
    // argon2id defaults tuned for interactive login latency.
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  console.log(digest);
}

main();
