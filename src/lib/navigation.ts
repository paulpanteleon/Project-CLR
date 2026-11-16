// The header's menus: one per primary function, with its pages as dropdown items. Admin pages sit
// in the account menu, for owners only (see src/app/header-bar.tsx).

export type NavItem = { label: string; href: string };
export type NavMenu = { id: string; label: string; items: NavItem[]; prefixes: string[] };

export const MENUS: NavMenu[] = [
  {
    id: "batches",
    label: "Batches",
    items: [
      { label: "All batches", href: "/" },
      { label: "Import PubMed batch", href: "/import" },
    ],
    // The batch list is the home page, so "/" belongs here as an exact match (see activeMenuId).
    prefixes: ["/import", "/batches"],
  },
  {
    id: "criteria",
    label: "Criteria",
    items: [
      { label: "All criteria versions", href: "/criteria" },
      { label: "Draft a new version", href: "/criteria/new" },
    ],
    prefixes: ["/criteria"],
  },
];

export const ADMIN_ITEMS: NavItem[] = [{ label: "Users and roles", href: "/admin/users" }];

// Sign-in and authenticator pages come before the user is fully signed in, so they have no header.
const NO_HEADER_PREFIXES = ["/sign-in", "/mfa"];

function underPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function showsHeader(pathname: string) {
  return !NO_HEADER_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
}

// The menu for the section the user is in, so the header can mark it. Null when none applies.
export function activeMenuId(pathname: string): string | null {
  if (pathname === "/") return "batches";
  const menu = MENUS.find((candidate) => candidate.prefixes.some((prefix) => underPrefix(pathname, prefix)));
  return menu?.id ?? null;
}
