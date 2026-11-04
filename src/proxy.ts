import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

// Runs before each page request. It refreshes the signed-in session cookie, and
// sends anyone without a session to /sign-in. Sign-in is the only page open to
// signed-out users. Every other page needs a session (S-1).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isSignInPage = pathname.startsWith("/sign-in");
  const config = supabaseConfig();

  let response = NextResponse.next({ request });

  let signedIn = false;
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
    const { data } = await supabase.auth.getUser();
    signedIn = data.user !== null;
  }

  if (!signedIn && !isSignInPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  if (signedIn && isSignInPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip static files and image optimisation, which need no session check.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
