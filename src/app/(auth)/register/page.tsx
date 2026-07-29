import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth";
import { AuthForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getSessionUser()) redirect("/chat");
  return <AuthForm mode="register" />;
}
