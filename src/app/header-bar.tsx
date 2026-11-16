"use client";

import { useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { ADMIN_ITEMS, MENUS, activeMenuId, showsHeader, type NavItem } from "@/lib/navigation";
import { signOut } from "./mfa/actions";

// The header on every signed-in page: a menu per primary function, and an account menu with
// admin pages (owners only) and sign out. A label opens its menu; it does not navigate.
export function HeaderBar({ email, isOwner }: { email: string; isOwner: boolean }) {
  const pathname = usePathname();
  if (!showsHeader(pathname)) return null;
  const active = activeMenuId(pathname);

  return (
    <AppBar position="static" elevation={0}>
      <Toolbar variant="dense" sx={{ gap: { xs: 0.5, sm: 1 }, px: { xs: 1, sm: 2 } }}>
        <Typography
          component={Link}
          href="/"
          variant="subtitle1"
          sx={{ color: "inherit", textDecoration: "none", fontWeight: 600, mr: { xs: 0.5, sm: 2 } }}
        >
          Project CLR
          <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.8, display: { xs: "none", sm: "inline" } }}>
            Prototype
          </Typography>
        </Typography>

        {MENUS.map((menu) => (
          <DropdownMenu
            key={menu.id}
            id={menu.id}
            label={menu.label}
            active={active === menu.id}
            items={menu.items}
            pathname={pathname}
          />
        ))}

        <Box sx={{ flexGrow: 1 }} />
        <AccountMenu email={email} isOwner={isOwner} pathname={pathname} />
      </Toolbar>
    </AppBar>
  );
}

const labelStyle = (active: boolean) => ({
  color: "inherit",
  minWidth: 0,
  px: { xs: 1, sm: 1.5 },
  textTransform: "none",
  fontWeight: active ? 700 : 400,
  borderBottom: "2px solid",
  borderColor: active ? "currentColor" : "transparent",
  borderRadius: 0,
});

function DropdownMenu({
  id,
  label,
  active,
  items,
  pathname,
}: {
  id: string;
  label: string;
  active: boolean;
  items: NavItem[];
  pathname: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const menuId = `${id}-menu`;

  return (
    <>
      <Button
        id={`${id}-button`}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        sx={labelStyle(active)}
      >
        {label} ▾
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { "aria-labelledby": `${id}-button` } }}
      >
        {items.map((item) => (
          <MenuItem
            key={item.href}
            component={Link}
            href={item.href}
            selected={pathname === item.href}
            onClick={() => setAnchor(null)}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function AccountMenu({ email, isOwner, pathname }: { email: string; isOwner: boolean; pathname: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // Sign out is a server action. The form sits outside the menu so the menu's keyboard
  // navigation still sees only menu items.
  const signOutForm = useRef<HTMLFormElement>(null);
  const open = anchor !== null;

  return (
    <>
      <Button
        id="account-button"
        aria-label={`Account menu for ${email}`}
        aria-controls={open ? "account-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        sx={labelStyle(pathname.startsWith("/admin"))}
      >
        <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
          {email}
        </Box>
        <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>
          Account
        </Box>
        &nbsp;▾
      </Button>
      <Menu
        id="account-menu"
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ list: { "aria-labelledby": "account-button" } }}
      >
        <MenuItem disabled sx={{ display: { xs: "flex", sm: "none" } }}>
          {email}
        </MenuItem>
        {isOwner &&
          ADMIN_ITEMS.map((item) => (
            <MenuItem
              key={item.href}
              component={Link}
              href={item.href}
              selected={pathname === item.href}
              onClick={() => setAnchor(null)}
            >
              {item.label}
            </MenuItem>
          ))}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            signOutForm.current?.requestSubmit();
          }}
        >
          Sign out
        </MenuItem>
      </Menu>
      <form ref={signOutForm} action={signOut} hidden />
    </>
  );
}
