"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

// Signs in with email and password (S-1). Multi-factor sign-in is still to be added
// before any real review. The message is the same whether the email or password is
// wrong, so the form cannot be used to check which emails have accounts.
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Sign-in is not set up yet. The Supabase settings are missing." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Email or password is not correct." };
  }

  // redirect() throws to end the request, so it must stay outside any try block.
  redirect("/");
}
