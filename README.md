# Video Agent Studio MVP

Video Agent Studio is a multi-agent workflow platform for turning a user idea into research, storyline, script, shots, storyboard images, and video clips with review gates, versioning, locks, and local updates.

## Quick Start

1. Run `npm ci` with a current Node.js LTS runtime.
2. Configure backend provider credentials using `.env.example` as the reference. Keep secrets in root `.env.local` / `.env`; never commit them or enter them into public browser state.
3. Run `npm run dev` to start **both** the web app and durable worker with the same root environment.
4. Open [Video Agent Studio](http://localhost:3000). Confirm creative settings, generate/review the script, explicitly confirm the script, then work shot-by-shot in the unified storyboard/video workspace.

For separate terminals, use `npm run dev:web` and `npm run dev:worker`. Running only the web app can enqueue jobs, but cannot execute them. The combined development command intentionally passes the root environment to both local processes.

## Workspace Layout

- `apps/web`: Next.js MVP UI and API routes
- `apps/worker`: workflow runners and job orchestration helpers
- `packages/shared`: shared types, enums, and Zod validators
- `packages/db`: PostgreSQL migrations plus a file-backed dev repository layer
- `packages/workflow-engine`: state machine, retry policy, and workflow helpers
- `packages/agents`: Agent contracts, structured execution, and runner helpers
- `packages/providers`: OpenAI-compatible, Anthropic, MiniMax, and isolated test/mock adapters
- `packages/review-service`: review logic and failure escalation helpers
- `packages/artifact-service`: version and activation helpers for artifacts

## Reliability Contract

- The workflow engine owns state transitions. Creative settings and final script confirmation are manual gates.
- Commands are schema-validated and scoped to the project; local regeneration affects the selected Shot by default.
- Jobs survive HTTP disconnects and use leases, heartbeats, cancellation, checkpoints, bounded retries, and stable run/task identities.
- MiniMax video submission IDs are checkpointed before polling. Interrupted jobs resume the remote task; terminal supplier failures remain traceable and permit a subsequent retry.
- Version creation is append-only and idempotent. Activation checks the current lock and expected revision at commit time.
- User-facing events, developer events, and transactional outbox records retain the audit trail.
- An orphaned legacy pending artifact is shown as recoverable failure, never as a permanently spinning task.

## Validation

```sh
npm run test
npm run lint
npm run typecheck
npm run build
npm audit
```

Tests use isolated temporary databases and mocked provider/network responses. They refuse to fall back to the user's product database. Browser QA must not confirm gates, regenerate paid media, or delete real content merely to obtain a passing screenshot.

Next 15's PostCSS dependency is deliberately overridden to patched `8.5.28`; keep this override until the selected Next release includes a fixed version. Revalidate build and dependency audit when changing it. npm 11 may report the original Next exact constraint as `invalid` in `npm ls`, even though the audited installed version is the override.

## Storage and Deployment Boundary

- Local development uses `.data/video-agent-studio.json`, guarded file mutations, atomic replacement, and a `.bak` recovery copy. Preserve `.data/` when updating code. Back up the database and generated assets together.
- SQL migrations `001`–`003` describe the production schema and uniqueness rules. The local MVP has not been deployed or acceptance-tested against PostgreSQL.
- This is a local, single-user product. Project ownership checks are not a substitute for production authentication/RBAC. Do not expose it publicly without an authenticated deployment boundary and production storage.
- Remote exactly-once behavior ultimately depends on supplier idempotency support. A crash before the supplier task ID is acknowledged cannot be guaranteed duplicate-free; local cancellation also cannot guarantee remote supplier cancellation.
- Real paid-provider end-to-end generation is separate from the deterministic test suite and requires the user's chosen credentials, model, and spending decision.

The product framework and acceptance record are in `deliverables/PRODUCT_OPTIMIZATION_V1.md`. Visual comparison evidence is in `artifacts/product-audit-final-2026-09-04/` (local, intentionally not published).

The subsequent UX pass is documented in `deliverables/PRODUCT_UX_ACCEPTANCE_2026-09-06.md`, with current screenshots in `artifacts/product-ux-review-2026-09-05/`. It adds complete script reading, contextual next steps, Shot filtering/navigation, targeted recovery links, a two-column editor, responsive refinements, and server-enforced activation readiness. The current full regression suite contains 217 passing tests; paid generation and public deployment are not part of this local acceptance.
