import "server-only";

// The OpenRouter client for app code, marked server-only so it can never reach the browser.
// Background workflow steps import ./model-call directly (ADR-0018).
export * from "./model-call";
