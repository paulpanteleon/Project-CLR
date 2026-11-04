# ADR-0001: Use Next.js with Material UI

## Date and status
2026-11-04. Accepted.

## Context
Project CLR needs screens that a medical writer uses in a browser, server code that talks to the database and to the AI service, and batch jobs that run for several minutes. It runs on Vercel (see ADR-0002). The developer is new to web app building, so the number of separate projects and languages should be as small as possible.

## Options
- Option 1: Plain React (screens) with a separate server project (for example, Express)
  - Good: each part is simple on its own. Many examples exist.
  - Bad: two projects to deploy, two sets of settings, and extra work to connect them.
- Option 2: Next.js (screens and server code in one project), with Material UI for the look
  - Good: one project holds the screens, the server code, and the batch jobs. Vercel is built for it. Material UI provides ready-made buttons, tables, and forms that match the screens in Figma.
  - Bad: Next.js has a rule about which code runs in the browser and which runs on the server. Material UI pieces that need the browser must be marked with a "use client" line.
- Option 3: A different framework (for example, SvelteKit)
  - Good: also covers screens and server code.
  - Bad: Material UI is a React library, so this option would give up the component library.

## Decision
Use Next.js (latest stable, currently 16.4.5, using the App Router) and Material UI (latest stable, currently 9.5.0). Check each version's current documentation in `node_modules` before writing code that depends on it. Next.js changes between versions.

## Consequences
- The whole app is TypeScript in one repository.
- Each file must be clearly either browser code or server code. Secrets (such as the OpenRouter key) must only be read in server code.
- Material UI's theme file and any interactive component need a `"use client"` line at the top.
- Next steps: scaffold the project with `create-next-app` after the plan is approved. Then install Material UI with the Next.js setup from its docs.
