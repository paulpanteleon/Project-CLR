import { describe, expect, it } from "vitest";
import { ADMIN_ITEMS, MENUS, activeMenuId, showsHeader } from "@/lib/navigation";

// Tests for the header's menus: where it shows, and which menu is marked for the current page.

describe("showsHeader", () => {
  it("hides the header on sign-in and authenticator pages", () => {
    expect(showsHeader("/sign-in")).toBe(false);
    expect(showsHeader("/mfa/verify")).toBe(false);
    expect(showsHeader("/mfa/enroll")).toBe(false);
  });

  it("shows the header everywhere else, including paths that only start with the same letters", () => {
    expect(showsHeader("/")).toBe(true);
    expect(showsHeader("/criteria")).toBe(true);
    expect(showsHeader("/mfa-help")).toBe(true);
  });
});

describe("activeMenuId", () => {
  it("marks no menu on the home page", () => {
    expect(activeMenuId("/")).toBeNull();
  });

  it("marks Batches on the batch list, the import page, every batch page and the decision search", () => {
    expect(activeMenuId("/batches")).toBe("batches");
    expect(activeMenuId("/import")).toBe("batches");
    expect(activeMenuId("/batches/83e65416-8f94-4617-9847-0fd7d42e022e/screen")).toBe("batches");
    expect(activeMenuId("/batches/83e65416-8f94-4617-9847-0fd7d42e022e/records/31492632")).toBe("batches");
    expect(activeMenuId("/decisions")).toBe("batches");
  });

  it("marks Criteria on the criteria pages", () => {
    expect(activeMenuId("/criteria")).toBe("criteria");
    expect(activeMenuId("/criteria/new")).toBe("criteria");
    expect(activeMenuId("/criteria/50000000-0000-0000-0000-000000000001/edit")).toBe("criteria");
  });

  it("marks no menu on admin pages, which live in the account menu", () => {
    expect(activeMenuId("/admin/users")).toBeNull();
  });
});

describe("menu items", () => {
  it("links every item to a page that exists", () => {
    const hrefs = [...MENUS.flatMap((menu) => menu.items), ...ADMIN_ITEMS].map((item) => item.href);
    expect(hrefs).toEqual(["/batches", "/import", "/decisions", "/criteria", "/criteria/new", "/admin/users"]);
  });
});
