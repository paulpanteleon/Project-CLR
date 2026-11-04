import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { routeFor, type AssuranceLevel, type SessionState } from "@/lib/auth/mfa-routing";

// Runs before each page request. It refreshes the session cookie, then sends the
// visitor where they should be: sign-in, the authenticator enrolment or code entry
// (S-1), or the page they asked for (see src/lib/auth/mfa-routing.ts).
export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  let response = NextResponse.next({ request });

  let state: SessionState = { signedIn: false, currentLevel: null, nextLevel: null };

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    // getUser() checks the session with the auth server. Trust it over the cookie alone.
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      state = {
        signedIn: true,
        currentLevel: (aal?.currentLevel as AssuranceLevel | null) ?? null,
        nextLevel: (aal?.nextLevel as AssuranceLevel | null) ?? null,
      };
    }
  }

  const target = routeFor(request.nextUrl.pathname, state);
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip static files and image optimisation, which need no session check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
