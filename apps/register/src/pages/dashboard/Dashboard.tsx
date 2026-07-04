import { authClient } from "@/lib/auth-client";

export default function Dashboard({
  session,
}: {
  session: typeof authClient.$Infer.Session;
}) {
  return (
    <>
      <p>ようこそ、{session.user.name || session.user.email}さん</p>
    </>
  );
}
