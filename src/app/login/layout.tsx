import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, unsealSession } from "@/lib/session";

// Already signed in: skip the form. Convenience only, not an auth boundary.
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await unsealSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (session) redirect("/");
  return children;
}
