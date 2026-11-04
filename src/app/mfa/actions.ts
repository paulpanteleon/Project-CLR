"use server";

import { redirect } from "next/navigation";
import { HOME, SIGN_IN } from "@/lib/auth/mfa-routing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CodeState = { error: string | null };

export type EnrollState = {
  error: string | null;
  factorId?: string;
  qrCode?: string;
  secret?: string;
};

// Starts authenticator set-up when the user asks for it, not when the page loads.
// Creating the factor during page render was unsafe: a later render removed the factor
// the QR code belonged to, so the first code check failed.
export async function startEnrollment(
  _previous: EnrollState,
  _formData: FormData,
): Promise<EnrollState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Sign-in is not set up yet. The Supabase settings are missing." };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { error: "Your session has ended. Sign in again." };
  }

  // Remove any unfinished set-up first, so only one QR code is ever waiting.
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    console.error("mfa listFactors failed:", listError.message);
    return { error: "Could not load your sign-in settings. Try again." };
  }
  for (const factor of factors.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });
  if (error || !data) {
    console.error("mfa enroll failed:", error?.message);
    return { error: "Could not start set-up. Try again." };
  }

  return {
    error: null,
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

// Checks a 6-digit code from the user's authenticator app against one factor.
// Success upgrades the session to aal2. Every attempt is written to the audit log (T-2).
async function checkCode(factorId: string, rawCode: string): Promise<CodeState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { error: "Sign-in is not set up yet. The Supabase settings are missing." };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { error: "Your session has ended. Sign in again." };
  }

  const code = rawCode.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { error: "Enter the 6-digit code from your authenticator app." };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    console.error("mfa challenge failed:", challengeError?.message);
    return { error: "Could not start the check. Try again." };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  const action = verifyError ? "mfa.verify.failure" : "mfa.verify.success";
  await supabase.from("audit_events").insert({
    actor_id: userData.user.id,
    action,
    target: "mfa",
    allowed: verifyError === null,
  });

  if (verifyError) {
    return { error: "That code is not right. Check the code is current and try again." };
  }
  return { error: null };
}

// Used on the enrolment screen: the first code confirms the new authenticator.
export async function confirmEnrollment(
  _previous: CodeState,
  formData: FormData,
): Promise<CodeState> {
  const result = await checkCode(String(formData.get("factorId") ?? ""), String(formData.get("code") ?? ""));
  if (result.error) return result;
  // redirect() ends the request, so it must stay outside any try block.
  redirect(HOME);
}

// Used at each sign-in after the authenticator is set up.
export async function verifyCode(_previous: CodeState, formData: FormData): Promise<CodeState> {
  const result = await checkCode(String(formData.get("factorId") ?? ""), String(formData.get("code") ?? ""));
  if (result.error) return result;
  redirect(HOME);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase?.auth.signOut();
  redirect(SIGN_IN);
}
