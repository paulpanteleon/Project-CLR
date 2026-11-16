import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HeaderBar } from "./header-bar";

// The header for every page. The user and their role come from the request's cookies, and the
// header reads the pathname, so it streams inside Suspense. The rest of each page can still be
// built ahead of time. Signed-out visitors get no header.
export function SiteHeader() {
  return (
    <Suspense fallback={null}>
      <HeaderForUser />
    </Suspense>
  );
}

async function HeaderForUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  // Only decides whether the admin link shows. The admin page checks again before it loads.
  const { data: isOwner } = await supabase.rpc("is_owner");
  return <HeaderBar email={data.user.email ?? "Account"} isOwner={isOwner === true} />;
}
