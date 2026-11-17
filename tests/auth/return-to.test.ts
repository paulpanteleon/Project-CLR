import { describe, expect, it } from "vitest";
import { returnPathFor } from "@/lib/auth/return-to";
import { REFUSAL_MESSAGES, SHARE_TOKEN, isOk, refusalMessage } from "@/lib/review-log";

// Tests for coming back to a shared review log after sign-in, and the share link's rules (ADR-0020).

const TOKEN = "a".repeat(40) + "-_9";

describe("returnPathFor", () => {
  it("keeps a shared review log page, and a record opened from one", () => {
    expect(returnPathFor(`/shared/${TOKEN}`)).toBe(`/shared/${TOKEN}`);
    expect(returnPathFor(`/shared/${TOKEN}/records/31492632`)).toBe(`/shared/${TOKEN}/records/31492632`);
  });

  it("keeps nothing else, so the cookie can't send someone elsewhere", () => {
    expect(returnPathFor("/")).toBeNull();
    expect(returnPathFor("/batches")).toBeNull();
    expect(returnPathFor(`/shared/${TOKEN}/../admin/users`)).toBeNull();
    expect(returnPathFor(`/shared/${TOKEN.slice(1)}`)).toBeNull();
    expect(returnPathFor(`//evil.example.com/shared/${TOKEN}`)).toBeNull();
    expect(returnPathFor(`https://evil.example.com/shared/${TOKEN}`)).toBeNull();
    expect(returnPathFor(`/shared/${TOKEN}/records/1?x=1`)).toBeNull();
  });
});

describe("share tokens and refusals", () => {
  it("accepts only 43-character base64url tokens", () => {
    expect(SHARE_TOKEN.test(TOKEN)).toBe(true);
    expect(SHARE_TOKEN.test(`${TOKEN}=`)).toBe(false);
    expect(SHARE_TOKEN.test("short")).toBe(false);
  });

  it("explains each refusal, and points an expired link to the batch owner (UC2)", () => {
    for (const result of ["denied", "not_found", "expired", "revoked", "wrong_person", "no_role"]) {
      expect(REFUSAL_MESSAGES[result]).toBeTruthy();
    }
    expect(refusalMessage("expired")).toMatch(/new link/);
    expect(refusalMessage("something_else")).toMatch(/can't be opened/);
  });

  it("tells a log or record from a refusal", () => {
    expect(isOk({ result: "ok" })).toBe(true);
    expect(isOk({ result: "expired", expires_at: null })).toBe(false);
    expect(isOk(null)).toBe(false);
  });
});
