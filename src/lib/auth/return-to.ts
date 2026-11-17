// Brings someone back to a shared review log after they sign in (ADR-0020). Signing in goes through
// the sign-in page and the authenticator step, which end on the home page, so the shared link's
// path is kept in a short-lived cookie on the way in and read at the end.
//
// Only shared review log paths are ever kept, so the cookie cannot be used to send someone to
// another site or page.

export const RETURN_TO_COOKIE = "clr_return_to";
export const RETURN_TO_MAX_AGE_SECONDS = 30 * 60;

const SHARED_PATH = /^\/shared\/[A-Za-z0-9_-]{43}(\/records\/[0-9]+)?$/;

// The path to come back to after sign-in, or null if this page is not one worth keeping.
export function returnPathFor(pathname: string): string | null {
  return SHARED_PATH.test(pathname) ? pathname : null;
}
