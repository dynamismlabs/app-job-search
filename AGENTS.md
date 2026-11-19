# Maintaining Job Search

Job Search is an App Builder app: core 0.2.3 as built from kit `main` at `b38d373` (vendor/app-builder-core-0.2.3.tgz, moved there with the kit's `upgrade`), starter 0.2.0. Read README.md for what it does, docs/parity.md for how it differs from the app Ri used to carry, and the build skill in .agents/skills/build-personal-app for how App Builder apps are built, run and changed. Use pnpm.

## Commands

- `pnpm typecheck`, `pnpm test` (vitest) and `pnpm build` before handing off. After `pnpm build`, `pnpm test:host` runs the view in the kit's strict MCP Apps test host (`test/host/browser-host.ts`, copied from the kit) and stops everything it starts.
- `pnpm exec app-builder upgrade` moves the app onto a newer kit core through the safe-change checks.
- `pnpm dev` with a disposable `APP_DATA_DIR`, and `APP_CONNECTORS=fixtures` for the fictional hub.
- `pnpm exec app-builder serve --install` and `pnpm exec app-builder change` to run and change the person's service. Never run the app from this folder against the person's data, and never start a second server on its data directory. The data directory's `host-key` lets the host that installed the app allow itself without a browser (core 0.2.3): never print, copy or commit it.

## Layout

- `src/app.ts` is the application: actions, views, prompts, migrations, sources, jobs and connectors. Importing it opens nothing.
- `app.config.ts` holds the server's `instructions`: what a model needs across the tools, at most 2,000 characters, never a repeat of a tool's description. `src/prompts.ts` holds the prompts, Ri's two Job Search skills, which name the tools and read nothing themselves. Prompt arguments are optional text (`z.string()` or `z.enum`), and a blank one counts as left out, since some hosts send it.
- `src/domain/` is pure logic with no storage: classification, matching, posting extraction, compensation, diffs and AI prompt validation. `labels.ts` has no schemas so the view can import it.
- `src/server/` is the query layer. Every write goes through these modules, never raw SQL in an action. `state.ts` binds the installation's storage for each request and job run. `migrations.ts` holds the schema.
- `src/api/` defines actions in the shape they had in Ri, with strict zod (`zod/v3`) input and output. `src/lib/action.ts` turns each into a core action.
- `src/lib/` replaces what Ri's app kit provided: `db.ts` (the query layer's synchronous handle on the core's connection, through the core's `transaction()`), `data.ts` (transactions, cursors, scopes, the step queue, blobs), `sources.ts` (Gmail and Calendar sync), `invocation.ts` (the caller, its access and the hub), `time.ts`, `contract.ts`.
- `src/views.ts` declares `show_opportunities` and `show_today`. `src/view/cards.tsx` draws them.
- `src/view/` is the screens. `src/view/kit/` is the UI kit they were written with, kept here since Ri removed it. `src/view/kit/app.tsx` is the bridge from its host interface to App Builder's client.
- `fixtures/connectors.json` is the fictional hub for `APP_CONNECTORS=fixtures`. A tool whose answer depends on its arguments answers by `cases`. `test/` is the tests.

## Sources, jobs and connectors

- **Sources** (what a connection can be limited to, labelled "collections and accounts", a plural noun the core reads after "All your"): `manual` (saved jobs, interviews and preparation), `materials`, and `account:<account>` for each account added in Sources. Every read filters by the caller's sources before assembling results, including counts, sort keys, the projected stage and suggestions.
- **Jobs**: `sync_sources` every five minutes runs bounded sync and enrichment steps for accounts that update automatically. `follow_up_tasks` every five minutes asks Ri again for follow-up tasks waiting for approval.
- **Connectors**: mail and calendar reads through Ri's hub. The app uses Gmail's and Calendar's own tools by name when Ri lends them (history sync, full messages, sync tokens) and the core's mail and calendar adapters otherwise. Ri's services: `ri__ai_text`, `ri__extract_text`, `ri__create_task`, `ri__get_task`. Account `default` is the one account Ri allows, called without an `account` argument. Sources offers the accounts Ri lent (`lentAccounts` in `src/server/sync.ts`, from `connectors(ctx).accounts()`). Branch on a connector error's `code` (`capabilityError` in `src/lib/invocation.ts`), and on `providerStatus` where a 404 and a 410 differ (calendar sync). Its "not found" text match only reads an older hub's `provider_error`, from before Ri #7.
- **Context**: the screens report the section, its path and filters, and the selected records (one, or several when comparing) with the core's bounded context (`context()` in `src/view/kit/app.tsx`).
- **View-only actions** (`viewOnly: true`, MCP Apps' `visibility: ["app"]`): the person's own decisions only, such as review decisions, deleting, importing, source setup and export. They still check the caller's access.
- **Records**: `open_job_search` opens `/opportunities/<id>`, `/interviews/<id>`, `/materials/<id>` or a section, and the host's @ menu finds and reads records (`src/server/mentions.ts`), under the connection's access.
- **Leaving the frame**: the screens use the core's host calls through the bridge: drafts in the chat (Ask Ri), links, saving files and Open in browser. Each degrades where a host can't.
- **The place** is the router's address only (`src/view/location.ts`). Don't keep a second copy of it in state.
- **Hosting**: the Node service only. `src/worker.ts` is a stub.

## Invariants

- Migrations are forward only. Never edit a migration that has shipped. Add the next one to `src/server/migrations.ts`.
- Posting snapshots, material versions and submission material links are immutable (database triggers refuse updates, and a restored backup keeps them: `test/backup.test.ts`). Editing a material saves a new version with a parent link.
- Every stage change goes through `changeStageFor`, which records an event with author, source, confidence and decision. A person's change sets the stage lock. Automatic changes never move a stage backward, never reopen a closed opportunity, and are suppressed and sent to review while a lock disagrees.
- Never infer a rejection from a canceled meeting or from silence. Cancellations update the interview only.
- A company domain alone must never attach a message to one of several roles (`src/domain/match.ts`).
- Imported values, user corrections and effective values are stored separately for interviews. A sync never overwrites a correction.
- Write receipts (`app_invocations`) are keyed to the caller's sources (`authorityOf` in `src/server/state.ts`). The core drops a deleted account from every connection's choice, so a replay by anyone but the owner after those sources change, including after an account's data is deleted, is refused and never writes again.
- An AI suggestion run stores every source supplied to the model. A reader sees the run's suggestions only when it may see all of them.
- Contacts and company domains keep the source that taught them. Readers see only contacts from their sources.
- AI output is untrusted. Prompts mark sources as data, replies are validated against strict schemas, quotes must be exact substrings, and AI readings only produce suggestions.
- Transactions are synchronous and never wait on anything: read from the hub first, then commit records and checkpoint together. Use `transaction` from `src/lib/data.ts`, which runs the core's `transaction()` and joins one already open. Never open a second connection to `data.sqlite`.
- Background work is bounded steps committed with their checkpoints. The core's job runner drives them.

## Copy

User-visible text never uses em or long dashes and avoids semicolons. Write "October 9 to 14", not a dash range. No sparkle, magic wand or star icons or emoji.
