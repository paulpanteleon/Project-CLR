import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
};

// Enables the "use workflow" and "use step" directives for the background AI first pass (ADR-0018).
export default withWorkflow(nextConfig);
