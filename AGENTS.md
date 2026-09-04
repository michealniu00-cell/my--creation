# Video Agent Studio Project Rules

## Product Nature
- This project is a workflow production system, not a free-form chatbot.
- Agents do not advance workflow state directly; the workflow engine owns orchestration.
- MVP first. Prefer explicit, stable primitives over over-designed abstractions.

## Output And Version Rules
- Never overwrite previous versions when regenerating content.
- Every key output must be versioned and remain traceable.
- Pages should default to showing the current active version.
- Local updates are the default. Do not trigger full-project regeneration unless the user explicitly confirms it.

## Lock And Conflict Rules
- Locked objects can be read, but they cannot be automatically overwritten.
- Lock support in V1 is limited to shots, storyboard versions, and video versions.
- If an upstream change affects a locked object, surface a conflict and require a user decision.

## Agent Boundaries
- Each agent can only write its own output.
- Agent5 can review and write feedback, but it cannot edit approved content bodies.
- Agent7 reads Agent6 output and writes an enhanced version without mutating Agent6's original output.
- Agent8 and Agent9 cannot write back into text artifacts.

## Workflow And UI Rules
- Agent1 confirmation and script confirmation are manual gates.
- Other nodes can auto-advance when they pass review.
- Part 2 and Part 3 must share a single horizontal shot-card workspace:
  - one column per shot
  - storyboard on top
  - video below
  - local actions only affect the relevant shot by default

## Engineering Rules
- Persist user-visible events and developer-visible events.
- All write APIs must validate input schema and check lock status.
- Provider integration must stay behind adapters; do not scatter SDK calls through business logic.
- Database migrations should follow the spec documents even if the local MVP uses a file-backed dev store.

