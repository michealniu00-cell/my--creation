# Video Agent Studio MVP

Video Agent Studio is a multi-agent workflow platform for turning a user idea into research, storyline, script, shots, storyboard images, and video clips with review gates, versioning, locks, and local updates.

## Workspace Layout
- `apps/web`: Next.js MVP UI and API routes
- `apps/worker`: workflow runners and job orchestration helpers
- `packages/shared`: shared types, enums, and Zod validators
- `packages/db`: PostgreSQL migrations plus a file-backed dev repository layer
- `packages/workflow-engine`: state machine, retry policy, and workflow helpers
- `packages/agents`: Agent1~Agent9 stubs and runner helpers
- `packages/providers`: mock provider adapters for LLM, image, and video generation
- `packages/review-service`: review logic and failure escalation helpers
- `packages/artifact-service`: version and activation helpers for artifacts

## Current MVP Strategy
- The repository includes PostgreSQL migration drafts aligned with the product docs.
- For local MVP development, repositories use a JSON file store under `.data/` so the UI and APIs can run without external infrastructure.
- Agent execution currently uses deterministic stub outputs, which makes the full chain inspectable and testable before real model providers are wired in.

## Suggested Next Steps
1. Install dependencies with `npm install`.
2. Start the web app with `npm run dev:web`.
3. Start the worker process with `npm run dev:worker`.
4. Replace mock providers with real LLM, image, and video adapters once API keys and provider choices are finalized.

