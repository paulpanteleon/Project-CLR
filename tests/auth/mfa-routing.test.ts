import { describe, expect, it } from "vitest";
import { ENROLL, HOME, SIGN_IN, VERIFY, routeFor, type SessionState } from "@/lib/auth/mfa-routing";

const signedOut: SessionState = { signedIn: false, currentLevel: null, nextLevel: null };
const passwordOnlyNoFactor: SessionState = { signedIn: true, currentLevel: "aal1", nextLevel: "aal1" };
const passwordOnlyWithFactor: SessionState = { signedIn: true, currentLevel: "aal1", nextLevel: "aal2" };
const fullyChecked: SessionState = { signedIn: true, currentLevel: "aal2", nextLevel: "aal2" };

describe("signed-out visitors (S00)", () => {
  it("are sent to sign-in from any page", () => {
    expect(routeFor("/", signedOut)).toBe(SIGN_IN);
    expect(routeFor("/mfa/verify", signedOut)).toBe(SIGN_IN);
  });

  it("can stay on sign-in", () => {
    expect(routeFor(SIGN_IN, signedOut)).toBeNull();
  });
});

describe("password-only users (S-1: multi-factor required)", () => {
  it("with no authenticator yet are sent to enrol", () => {
    expect(routeFor("/", passwordOnlyNoFactor)).toBe(ENROLL);
    expect(routeFor(SIGN_IN, passwordOnlyNoFactor)).toBe(ENROLL);
  });

  it("with an authenticator are sent to verify", () => {
    expect(routeFor("/", passwordOnlyWithFactor)).toBe(VERIFY);
  });

  it("stay on the page they are already on", () => {
    expect(routeFor(ENROLL, passwordOnlyNoFactor)).toBeNull();
    expect(routeFor(VERIFY, passwordOnlyWithFactor)).toBeNull();
  });

  it("are sent from the wrong MFA page to the right one", () => {
    expect(routeFor(VERIFY, passwordOnlyNoFactor)).toBe(ENROLL);
    expect(routeFor(ENROLL, passwordOnlyWithFactor)).toBe(VERIFY);
  });
});

describe("fully checked users (aal2)", () => {
  it("can reach any app page", () => {
    expect(routeFor("/", fullyChecked)).toBeNull();
    expect(routeFor("/anything/else", fullyChecked)).toBeNull();
  });

  it("are sent away from sign-in and the MFA pages", () => {
    expect(routeFor(SIGN_IN, fullyChecked)).toBe(HOME);
    expect(routeFor(ENROLL, fullyChecked)).toBe(HOME);
    expect(routeFor(VERIFY, fullyChecked)).toBe(HOME);
  });
});
