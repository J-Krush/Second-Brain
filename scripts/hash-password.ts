import { hashPassword } from "../src/lib/password";

// Usage: pnpm hash-password "my password"
async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('usage: pnpm hash-password "your password"');
    process.exit(1);
  }
  console.log(await hashPassword(password));
}

main();
