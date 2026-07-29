import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSessionUser()) redirect("/chat");
  const { error } = await searchParams;
  return <AuthForm mode="login" initialError={error} />;
}
