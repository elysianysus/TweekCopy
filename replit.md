# Tweek - Weekly Task Planner

Tweek is a personal organization tool that helps users manage tasks, notes, and knowledge through a web application.

## Run & Operate

```bash
npm install
npm run dev # Starts frontend and backend
npm run build # Builds the frontend for production
npm run typecheck # Runs TypeScript type checking
drizzle-kit generate:pg # Generates DB migrations
drizzle-kit push:pg # Applies DB migrations
```

**Required Environment Variables:**
- `DATABASE_URL`
- `VITE_API_BASE_URL`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (or similar for AI integrations)
- `ADMIN_USER_IDS` (comma-separated UIDs for admin endpoints)
- `RECURRING_HORIZON_DAYS` (optional, default 365)
- `LAST30DAYS_PYTHON` (optional, default `python3`)
- `LAST30DAYS_DRY_RUN` (optional, for testing)
- `LAST30DAYS_ALLOW_DRY_RUN_HEADER` (optional, for e2e testing dry runs)
- `SCRAPECREATORS_API_KEY` (optional, for Last 30 Days X/TikTok sources)

## Stack

- **Frontend:** React 18 with Vite, Tailwind CSS, React Router
- **Backend:** Express.js, Node.js
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** _Populate as you build_
- **Build Tool:** Vite

## Where things live

- `src/` - Frontend source code
- `server/` - Backend source code
- `drizzle/` - Database migrations
- `public/` - Static assets
- `vendor/last30days/` - Vendored Python engine for Last 30 Days research
- `drizzle/schema.ts` - Database schema definition
- `server/api/*.ts` - API route definitions (source of truth for API contracts)
- `src/styles/tailwind.css` - Main Tailwind CSS file (source of truth for theme)

## Architecture decisions

- **Multi-device timezone handling:** User's timezone preference is persisted in `localStorage` and synced to the server, with a "most-recent-wins" reconciliation strategy to ensure consistency across devices and browsers.
- **Recurring Task Materialization:** Recurring task instances are materialized up to a configurable horizon for performance, with a nightly scheduler advancing the horizon even when offline.
- **AI Integration Strategy:** AI functionalities (Muse, email classification, etc.) are integrated via a shared pipeline (`server/museShared.js`) ensuring consistent skill prompts, memory injection, and provider routing.
- **Muse Office Worker Loop:** `server/officeJobs.js` runs an in-process worker draining `office_jobs` rows. Each successful action auto-writes one short `worker_memories` row (per `(uid, skillKey)`) injected as extra system context on subsequent runs, and may enqueue ONE `kind='reaction'` job from a paired worker (PARTIAL unique index on `parent_job_id WHERE kind='reaction'` + explicit pre-check; reactions never recurse / parse drafts / write memories). User feedback (👍 / 👎 / ✏️) on a finished job is also stored as a `worker_memories` row with source `feedback_positive|feedback_negative|feedback_correction`, so it gets injected into the same prompt path automatically (closing F + E loop).
- **Muse Office Manager / Delegate (C1):** Built-in `manager` worker exposes a `delegate` action (`restrictedTo:['manager']`, UI-filtered). Phase A: manager LLM emits a fenced `subtasks` JSON block; `parseManagerSubtasks` does balanced-brace extraction (fenced or bare) and inserts each subtask as a `kind='subtask'` child row pointing at the manager via `parent_job_id`, then parks the manager at `status='waiting'`. Phase B (`maybeAggregateManager`): when ALL children reach `done|failed`, an atomic `waiting → running` claim wins exactly one drain, the manager LLM gets a `[Office · Aggregate]` prompt quoting each child's result, and writes the final tied-together summary. Failed children still release the parent (no deadlock); `recoverInterruptedOfficeJobs()` re-fires aggregation for any waiting managers stranded across restarts.
- **Muse Office Pixi Room (B):** The Office room game layer (floor, walls, desks, worker sprites, player sprite) is rendered with PixiJS v8 in `src/components/views/PixiOfficeRoom.jsx` instead of CSS-positioned divs. The component owns a single `Application` initialized via async `app.init()`, with static `Graphics` layers for the floor / walls (drawn once) and a per-frame ticker that drives idle bobbing for workers, busy wiggle when a worker has queued or running jobs, and an eased slide for player movement. Worker sprites are clickable through Pixi (`eventMode='static'`); the React HUD (name labels, status bubbles, reaction bubbles, "press E" prompt, dialog, jobs panel) stays absolutely-positioned on top of the canvas, so all keyboard handling, dialogs and scaling logic in `OfficeView.jsx` is unchanged.
- **Muse Office Plan Templates (C2):** Server-driven sequential chains in `OFFICE_TEMPLATES` (Weekly Prep Kit, Idea Pressure Test, Daily Standup). Surfaced in `/api/office/action-types` as `template:<key>` entries (`restrictedTo:['manager']`); POST `/api/office/jobs` short-circuits these to `startOfficeTemplate`, which creates a parent (skill='manager', actionType='template', status='waiting', argument=JSON `{templateKey,userInput}`) and enqueues step 0 as a normal subtask. Each step's `buildArgument({userInput, prevResult})` threads the previous step's result (sliced to 800 chars) into the next worker's prompt. `advanceTemplateChain` uses an atomic `waiting → running` CAS guarded by an in-process `advancing` Set; on completion of all steps it folds the chain into a single done row (breadcrumb + final step result, no LLM aggregation). `dispatchSubtaskCompletion` routes child completions to either template-advance or manager-aggregate based on parent's actionType.
- **Wiki Agent Memo Updates (Compounding Wiki):** The Muse wiki agent (Ingest / Synthesize) can mutate existing memos via an `update_memo` tool, not only `create_memo`. Each call computes a unified diff (LCS-based, no deps, in `server/wikiDiff.js`) and either auto-applies (when the user has opted in via `users.wiki_auto_apply_ingest|synthesize`) or stages the diff to `agent_run_updates` with `status='pending'` for human approve/reject (default). Memos flagged `is_hand_maintained=true` are NEVER touched — `update_memo` returns a `hand_maintained` error the agent loop can recover from. Per-run caps are enforced in code via a mutable `runState` threaded through `buildWikiTools`: Ingest = 5 updates + 1 create; Synthesize = 1 mutation total (create OR update). `runWikiOp` accepts a `runAgentImpl` injection point so tests can script a deterministic tool-call sequence without hitting an LLM.
- **Whiteboard Data Saving:** Whiteboard changes are debounced and coalesced to minimize database writes, with compact JSON deduping to avoid unnecessary saves for viewport-only changes.
- **External Research Tool Integration:** The "Last 30 Days" research panel integrates an external Python engine via a thin wrapper, with robust error handling, concurrency limits, and a dry-run mechanism for testing.

## Product

-   **Task Management:** Multi-level task views (Year, Month, Week, Day) with CRUD, color coding, Markdown support, and advanced recurring task patterns.
-   **Knowledge Management:** Memo creation with HTML/Markdown, bi-directional linking, Zettelkasten note types, whiteboards with nested sections, and RSS/Atom feed reader integration.
-   **AI Assistant (Muse):** Multi-conversation AI chat, email/memo classification, custom skill generation, and an "Office" view for quick actions.
-   **Health & Wellness:** Trackers for Blood Pressure, Steps, Medicine & Symptoms with trend charts and AI analysis.
-   **Time Tracking:** World Graph multi-track timeline for Milestones, Memos, and Tasks.
-   **Integrations:** LINE Bot for logging and notifications, PWA support, desktop bookmarklets, and iOS Shortcuts integration.
-   **Research Panel:** "Last 30 Days" view to research topics across various online sources.
-   **Expense Tracking:** Basic expense tracking with AI category detection from receipt scans.

## User preferences

- I want iterative development.
- I prefer receiving detailed explanations for complex changes.
- Before making any significant changes or architectural decisions, please ask for my approval.
- I like to be informed about the implications of changes, especially regarding performance or user experience.
- Do not make changes to folder `node_modules`.
- Do not make changes to folder `.replit`.

## Gotchas

- **Recurring Task Horizon:** Be mindful of the `RECURRING_HORIZON_DAYS` setting; changes to recurring task templates might not immediately reflect far in the future due to materialization.
- **Last 30 Days Python Engine:** The `mvanhorn/last30days-skill` engine requires Python 3.12. Ensure the correct Python interpreter is used, potentially via `LAST30DAYS_PYTHON`.
- **Admin Endpoints:** Health endpoints (`/api/health/*`) are gated by `ADMIN_USER_IDS`. If unset, these endpoints are inaccessible.
- **Office Job Concurrency:** Muse Office quick actions have global and per-user concurrency limits. Jobs may queue if limits are reached.

## Pointers

- **Replit AI Integrations:** Refer to Replit's documentation for integrating with OpenAI, Anthropic, and Google models.
- **Drizzle ORM:** [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **Tailwind CSS:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Vite:** [https://vitejs.dev/guide/](https://vitejs.dev/guide/)
- **Excalidraw:** [https://excalidraw.com/](https://excalidraw.com/)
- **mvanhorn/last30days-skill:** [https://github.com/mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill)