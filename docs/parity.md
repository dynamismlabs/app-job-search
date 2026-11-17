# Job Search: parity with the app Ri used to carry

Job Search was an app bundled in Ri (`apps/job-search`, last at Ri commit `3c442810`). This repository is the same app rebuilt on App Builder: an MCP server with its own data, its own jobs and its own screens, which Ri connects to with OAuth and which borrows the person's accounts, Ri's model and Ri's tasks through Ri's hub.

Every feature and behavior from the old README and tests is listed below with one of three marks:

- **Works**: the same behavior, checked by the ported tests or by hand. A line about assistants that says "verified in the test host" was checked in the kit's strict MCP Apps test host. Ri was then checked on November 16, 2026 in a **disposable Ri at f55cdf96** on this Mac, on the web and in its desktop app, with dummy and fictional records only (not Trey's own Ri, which runs on another computer). Those lines say what Ri did. ChatGPT and Claude are still pending. Details in [Real hosts](#real-hosts), screenshots in `docs/parity/`.
- **Works differently**: the person or an assistant can still do it, in a different way. The entry says how.
- **Can't work**: it can't work on the new path today. The entry says why and what the kit or Ri would need.

The findings that need a change in the kit or in Ri are collected at the end.

**November 16 update.** The app moved to App Builder core 0.2.2 (kit `main` at `1713f6a`), which added what the first port found missing in assistants (spec §5, "The full app in every host"): drafting a chat message, opening links, saving files, view-only actions, opening the app at a record, the host's @ menu, a wider selection and Open in browser. Every line that said "browser only" or "can't work" for those reasons now works in hosts, verified in the test host. What's still blocked is listed at the end, each with its reason.

## How it was checked

- **Tests**: the old app's tests, ported. 102 tests in 9 files, all fictional data. The domain tests run unchanged. The rules, workflow, sync, access, leak and release tests run through the kit's own action router, with Ri's hub played by a hub-shaped fake (`test/fakes.ts`) or by the kit's fixture source (`fixtures/connectors.json`). New tests cover the MCP server (OAuth token required, tool list, read-only connections, a connection limited to some sources, disconnecting in Settings) and the hub through the kit's fixture source (the scheduled import, a duplicate wake-up, an unreachable or revoked hub, a follow-up waiting for approval in Ri, text extraction, the model being unavailable).
- **By hand**, on disposable data directories:
  - The screens in a browser with the fixture hub: Today, Opportunities (board and the phone-width stage sections, with no sideways scroll), the workspace and Sources.
  - `serve --install --service process` passed every step (install, typecheck, tests, build, rehearsal, switch) and answered on `/api/health`. Both jobs showed in Settings' job list, and Run now finished with "Connect this app to Ri in Settings to use your accounts." The service was then removed with `serve --uninstall`.
  - An MCP client using the MCP SDK's own `auth()` completed OAuth against it: the 401 challenge, discovery, dynamic registration, PKCE, the app's consent screen offering its sources, the token, then tools. A retry with the same operationId returned the same record. A second connection limited to saved jobs and read only saw no materials and was refused a stage change. Refresh worked.
  - The assistant view in the kit's strict MCP Apps host (a scripts-only sandbox whose page may not reach the network): `show_opportunities` and `show_today` drew their cards, choosing a row sent the bounded selection, and `open_job_search` opened the whole app full screen with its sections working, with no network or CSP failures.
- **In the kit's strict test host, automatically** (`pnpm build`, then `pnpm test:host`, on core 0.2.2): the kit's own `browser-host.ts`, which behaves like Ri where MCP Apps leaves room, runs the built view against the built app on a disposable data directory with the fictional preview. Eight checks, all passing:
  - the person's decisions are missing from the host model's tool list and refused when the model calls them, while the view's own calls go through
  - a card opens the whole app at one opportunity, and the section, path and selection reach the assistant
  - `open_job_search` opens at a path, and a host link moves the open app, at start and later
  - Ask Ri drafts the question in the chat with `send: false`, never sent
  - a meeting link and Open in browser go out through the host
  - the export is saved through the host's download, and a review decision works from the view
  - in a host that can't draft, open links or save files, nothing is sent: the question and the link show to copy, and Open in browser doesn't show
  - the @ menu finds records as the connection
  
  One note on the harness: in this headless Chrome, a pointer click doesn't reach a button the sandboxed frame had to scroll to (the frame scrolls, and a dispatched click works), so the check presses Enter on those two buttons.
- **Installed and checked in Ri** (November 16): installed as this Mac's service with `PORT=4312 APP_HOST=127.0.0.1 APP_URL=http://127.0.0.1:4312 pnpm exec app-builder serve --install HEAD --json` (every step passed; launchd `local.job-search`, data in `~/.local/share/job-search`), then `change HEAD --json` to 0c3c59b, the `sourceAccount` fix. `pnpm typecheck` and `pnpm test` pass: 9 files, 103 tests, and the new contract test fails on the old code. Then the checks in [Real hosts](#real-hosts) in a disposable Ri at f55cdf96, driven with Playwright in Ri's web app and its source Electron app. The fictional preview, the dummy job and its import were removed afterwards, and the disposable Ri's connection was disconnected in Settings.
- **Not checked**: Trey's own Ri, ChatGPT and Claude, Ri's real hub with a real Gmail account, and the app connecting to a real hub with OAuth (the kit tests that against its stand-in hub).

## What it does

| Feature | Mark | Notes |
| --- | --- | --- |
| Today: upcoming interviews in their own time zones | Works | |
| Today: invitations to choose times ("Scheduling needed") | Works | |
| Today: deadlines and next actions the person set | Works | |
| Today: responses waiting for a decision | Works | |
| Today: clearly labeled follow-up suggestions, no scores, silence is never a rejection or a deadline | Works | Release and rules tests. |
| Opportunities: board (Saved, Applied, Interviewing, Offer) and table over the same records | Works | Same screens. |
| Search by company or role, stage filter, Active, Closed and Archived views | Works | |
| Move to stage from a keyboard menu, dragging optional | Works | Same screens. |
| Narrow frames show stage sections or row cards, never a sideways board | Works | Checked at 375 pixels wide. |
| Opportunity workspace: overview, every posting snapshot, correspondence with the reason each matched, submissions with exact material versions, interviews with history, stage history, follow-ups | Works | |
| Interview preparation: requirements quoted from the posting snapshot, the person's examples, questions and notes with revisions | Works | |
| AI preparation suggestions in their own labeled list with their evidence | Works differently | Through Ri's `ri__ai_text` on the hub. The person has to allow "Use your model" for Job Search in Ri, and Ri's model service needs Ri's Claude subscription harness. Without it the app says "Extraction unavailable" and preparation works by hand, as before. |
| Materials: immutable versions, editing v3 saves v4 with a parent link and digest, a submission keeps v3, line by line compare | Works | |
| Sources: matching review | Works | |
| Sources: connected accounts | Works differently | Ri's hub doesn't tell an app which accounts it granted, so the person adds each account in Sources (no address needed when Ri allows one). Sources shows what Ri lends the app now (mail, calendar, model, tasks). See finding K1. |
| Sources: coverage and sync state per account | Works | |
| Sources: imported files, with Delete imported data | Works | In the browser and in hosts. Deleting is view-only, so a host that follows MCP Apps keeps it from its model (verified in the test host, and in Ri, where Delete imported data ran from the browser page and `delete_import` is view-only. ChatGPT and Claude pending). |
| Sources: chats with access | Works differently | Each assistant connection (Ri's own chats, each Ri workspace, Claude, ChatGPT) chooses on the app's consent screen which parts it may see and whether it may change records. Settings lists the connections and disconnects them. Ri's per-chat scopes are gone. |
| Sources: personal export | Works | In the browser it downloads. In a host it's saved through the host's `ui/download-file` (verified in the test host). In Ri (web and desktop) Export your records showed Ri's card ("Job search wants to save job-search-export-2026-11-17.json (38 KB)") and Save wrote the file. ChatGPT and Claude pending. |

## Inputs

| Input | Mark | Notes |
| --- | --- | --- |
| Pasted job description, résumé or cover letter | Works | |
| PDF or Word file up to 512 KB | Works | Read through Ri's `ri__extract_text` on the hub, as before through Ri. The original file is kept beside the extracted text, now inside the app's database. |
| Text, Markdown or HTML file | Works | Read in the app. |
| Choosing a file inside an assistant's view | Not checked | The view uses a file input. Whether a host's frame allows file picking is the host's own rule, and the spec says to test each host rather than assume. The kit's test host doesn't model it. Where a host doesn't allow it, Open in browser is the way to import a file. Ri's old host had its own file picker. |
| A link, stored as written and never fetched | Works | |
| CSV of opportunities | Works | |
| Gmail, read only, 30, 90 or 365 days (90 by default), received and sent | Works | Through Ri's hub. When Ri lends Gmail's full read tools (profile, history, full message), the app runs the same history-based sync as before, with invitation files, reply headers and list headers. When Ri lends only the kit's basic mail tools (search and get message), it reads through the kit's mail adapter with less detail (findings K2 and K3). |
| Google Calendar, chosen separately, events matching a saved role become interviews with participants and original time zone | Works | Through Ri's `google_calendar__sync_events` and `google_calendar__list_calendars`, the same tools as before. With only the kit's basic calendar tool, events come without participants, organizer, description, original time zone or cancellations, so matching relies on the title (finding K3). |
| Nothing is ever sent, applied for, booked or written to a calendar | Works | The app asks Ri for no Gmail or Calendar writes. Its only write through the hub is a Ri task. |
| Follow-ups create a Ri task only after confirmation | Works differently | Ri asks the person to approve a task an app adds, in Ri. The follow-up shows "Waiting for your approval in Ri", and the `follow_up_tasks` job retries the identical call every five minutes (Ri gives the wait an approval ID and keeps an approved call open for a day), so the task appears once the person approves. A task the person declines leaves the follow-up failed, saying so. Retries and repeat clicks still return one task (operation ID). See finding R2. |

## Stage and matching rules

All of these run on the same code as before and pass the same tests (`test/rules.test.ts`, `test/release.test.ts`, `test/sync.test.ts`).

| Rule | Mark | Notes |
| --- | --- | --- |
| Saving a posting creates a Saved opportunity and an immutable snapshot (SHA-256), a changed description is a new snapshot, preparation keeps citing its own | Works | Database triggers still refuse updates. |
| An exact or strong acknowledgment moves Saved to Applied, a weaker match only suggests it | Works | |
| An invitation to choose times is "Scheduling needed", not an interview | Works | |
| A confirmed time (calendar event, invitation file, or a time stated with its zone) creates or updates the interview | Works | Invitation files need Gmail's full read tool through the hub. With only the basic mail tool the app still uses calendar events and stated times. |
| Reschedules and cancellations update the same interview and keep its history, a canceled meeting never closes the application | Works | Calendar cancellations need Ri's sync tool (above). |
| Offers and rejections change the stage only on an exact or strong match | Works | |
| Ambiguous messages and messages naming two roles go to review with every candidate, its evidence and Ignore, related messages share one review item | Works | |
| A company domain alone never attaches a message to one of several roles. Identity comes from the thread, replies, invitation IDs, requisition IDs, posting links, role titles and known contacts | Works | Reply linkage by Message-ID and References needs Gmail's full read tool. Gmail's thread ID still links within one account. |
| A stage the person sets is a correction that stays, and later automatic changes that disagree wait for review | Works | |
| Every change is recorded with its author or source, confidence and decision | Works differently | A change made through an assistant connection is attributed to that connection by name, such as "Ri" or "Ri · Family". In Ri, the owner's view was its own kind of caller ("You"). Changes the person makes in Ri's view arrive through Ri's connection, so they read "Ri". |
| Compensation stored exactly, never converting annual and hourly | Works | |

## Actions

| Old action | Mark | Now |
| --- | --- | --- |
| `list_opportunities`, `get_opportunity`, `save_opportunity`, `change_stage`, `get_posting`, `record_submission`, `list_interviews`, `save_interview`, `list_materials`, `get_material`, `save_material_version`, `compare_material_versions`, `get_preparation`, `save_preparation`, `list_review`, `get_correspondence`, `get_today`, `create_follow_up`, `list_follow_ups` | Works | The same actions, as MCP tools and over the browser's API. |
| `set_stage_tracking`, `set_source`, `continue_import`, `preview_import`, `apply_import`, `delete_source_data`, `delete_import`, `export_records`, `archive_material`, `suggest_preparation` | Works | View-only, as Ri had them: the view calls them in the browser and in hosts, and a host that follows MCP Apps keeps them from its model (verified in the test host, and in Ri, which refused `export_records` and `clear_preview` on the model's path, "This tool is not available to this caller.", while the view's `load_preview`, `preview_import`, `apply_import` and export went through. ChatGPT and Claude pending). `set_source` takes the account as `sourceAccount` (Ri refuses a tool input named `account`, R5), and also adds accounts and sets automatic updates. |
| `resolve_match` | Works differently | View-only now. In Ri the model could record a review decision the person stated. Now the person decides in the review, and the assistant opens it for them (`open_job_search` at `/sources`). The agent skill says so. |
| `list_sources`, `list_source_calendars`, `preview_source`, `list_imports` | Works differently | View-only in Ri. Now reads the model can see too: they show only what a connection may see, and the kit marks only the person's decisions view-only. |
| `open_view` | Works | `open_job_search` opens the whole app, at `/opportunities/<id>`, `/interviews/<id>`, `/materials/<id>` or a section when given a path, and `show_opportunities` and `show_today` draw cards in a chat (verified in the test host. In Ri the whole app opened full screen and at `/opportunities/<id>`, on the web and desktop. The cards need a model's call, which the disposable Ri couldn't make. ChatGPT and Claude pending). The screens load their setup from `get_view_state`. |
| `describe_view_context` | Works differently | The view reports the section, its path and filters, and the selected records (one, or several when comparing roles, up to 50 listed) with the kit's bounded context, re-read by the assistant with its own access. A record the person @-mentions reads as the same labeled text Ri's context gave, under the connection's access. |
| `create_scope`, `list_scopes`, `revoke_scope` | Works differently | The app's consent screen and Settings, per connection. |
| `run_background_step`, `sync_step`, `enrich_step` | Works differently | One declared job, `sync_sources`, every five minutes, runs the same bounded steps. |
| Reads paginated, 50 by default, 100 at most, filtered before anything is assembled | Works | |
| Writes take the revision they edited and a durable invocation ID, so a retry returns the first result | Works differently | Writes take the revision and an optional `operationId`. A retry with the same one returns the first result. MCP has no invocation ID of its own. The screens send one per click. |
| New: `load_preview`, `clear_preview`, `create_waiting_follow_ups`, `get_view_state`, `show_opportunities`, `show_today`, `open_job_search`, `search_mentions` | New | The fictional preview (view-only), the follow-up job, the screens' setup, the views and the host's @ menu (the kit adds `search_mentions`, view-only). |

## Access

| Behavior | Mark | Notes |
| --- | --- | --- |
| The owner sees everything | Works | The person's browser, and any connection the person allowed to see everything. |
| A chat sees only the collections and accounts it was given (saved jobs, materials, each account) | Works differently | Chosen per connection on the app's consent screen. Ri registers one connection per place (Ri's own chats, each workspace). Tested over MCP and in `test/scopes.test.ts`. |
| Stage, next event, last activity and counts computed only from sources the caller may see | Works | |
| Contacts learned from an account shown only to readers of that account | Works | |
| AI suggestions shown only to readers of every source the model was given | Works | |
| A repeated write answered from its saved result only while the caller's sources are unchanged | Works | The key now also leaves out sources that no longer exist, so a replay after an account's data was deleted is refused as before. |
| A chat with no scope is refused | Works differently | Every connection has a choice, made on the consent screen. A token without one is refused by the kit. |
| A revoked scope is refused | Works differently | Disconnecting a connection in Settings makes its token fail with 401. Tested over MCP. |
| A read-only scope can't write | Works | The kit refuses writes for read-only connections before the action runs. |
| Deleting an account's data removes it from every chat's scope | Can't work | A connection's choice belongs to the kit, and the kit has no way for an app to drop one source from every connection's choice. Saved results can't leak it (above), but if the person later adds the same account again, a connection that had chosen it sees it again without being asked. Kit: let an app retire a source ID from every connection (finding K8). |
| The schedule sees only its automatically updated accounts | Works | Jobs run as the installation's owner. The sync job reads only accounts set to update automatically. |

## Limits

| Limit | Mark | Notes |
| --- | --- | --- |
| One provider page and at most ten new message bodies per step, stopping before 20 seconds | Works | |
| The schedule runs one step every five minutes | Works differently | The `sync_sources` job runs every five minutes and runs bounded steps until nothing is due or about 25 seconds pass. |
| Continue import runs the same step on request | Works | |
| Posting and material text up to 200,000 characters, files up to 512 KB, view selections up to 50 records | Works | The text and file limits are the same. The kit's context lists up to 50 selected records within 16 KiB. |
| AI only through Ri's bounded `ai_text`, on request and for up to three unclassified emails per step, readings only suggest | Works | Through the hub. |
| "Extraction unavailable" when AI isn't available, everything else keeps working | Works | Tested with the kit's fixture source. |

## Running, hosting and data

| Behavior | Mark | Notes |
| --- | --- | --- |
| Ri started the app on demand over private IPC | Works differently | The app runs as the person's own service (`serve --install`), always on, at `http://127.0.0.1:<port>/mcp`. |
| Ri's schedule ran its background steps | Works differently | The app's own job runner (`sync_sources`, `follow_up_tasks`). Settings shows each job's schedule and last run, with Run now. |
| Data in Ri's app data directory | Works differently | In the installation's `data.sqlite` (`~/.local/share/job-search` or `APP_DATA_DIR`), so the kit's backups, restores and safe-change snapshots carry it. Message bodies and original files are kept in that database too. |
| Forward-only migrations, never edited once shipped | Works | Applied by the kit's checksum ledger (`app-0001` is the old schema plus the tables Ri's kit created at run time). |
| Runs on Cloudflare | Can't work | The rules commit read-then-write transactions on a synchronous SQLite handle. The kit's database interface is asynchronous with atomic batches only, because D1 has no interactive transactions. The app opens its own synchronous better-sqlite3 handle on the same file in the same process, which only the Node service can do. The Worker entry is a stub that says so. Kit: interactive transactions on Node, or a documented way for an app to get the synchronous handle the core already holds (finding K9). |
| Ri's "Try" preview with fictional records | Works differently | "Try with fictional records" in an empty app, in the browser or a host, loads the same fictional set, marked as fictional everywhere, with "Remove them". |
| Ri's packaged view test in headless Chrome | Works differently | `pnpm test:host` runs the built view in the kit's strict MCP Apps test host in headless Chrome. |

## The view inside an assistant

| Behavior | Mark | Notes |
| --- | --- | --- |
| The view in Ri, full screen and beside a chat | Works | `open_job_search` opens the whole app, and `show_opportunities` and `show_today` draw cards whose rows open the whole app at that record (verified in the test host. In Ri, full screen works on the web and desktop when Job Search is added with **Add MCP server**. Through **Add app** no screen opens (Ri gap R6). Cards and beside-a-chat weren't checked, since they need a model. ChatGPT and Claude pending). |
| Ri's host theme | Works | The kit applies the host's theme and fonts. |
| Ri remembered the view's place in its own address, so Back and reopening returned to it | Works differently | In the browser the place is the address. Inside a host the view keeps its place in its own router while it's open, and a host's link (`openai/deepLink`, Ri's links to a screen) or `open_job_search`'s path opens it at a place (verified in the test host, and in Ri: `?open=open_job_search&path=/opportunities/<id>` opened Lumen's page on the web and desktop. Ri's Reload starts the app over at Today. ChatGPT and Claude pending). |
| Opening a record from elsewhere in Ri (entities with open paths) | Works | `open_job_search` takes a path, and the host's @ menu finds opportunities, interviews and materials under the connection's access and reads one as text that ends with its path (verified in the test host and MCP tests. In Ri the @ menu found "Lumen · Staff designer" and its cover letter. Reading an item at send needs a model harness, which the disposable Ri didn't have. ChatGPT and Claude pending). |
| "Ask Ri" staged editable text in Ri's chat composer | Works | The view drafts it with `ui/message` and OpenAI's `send: false`, which Ri puts in the message box unsent (verified in the test host, and in Ri on the web and desktop: "Job search wrote a message for you. It's in your main chat's draft, ready when you are." ChatGPT and Claude pending). In a host that can't draft, the question shows to copy. In the browser, which has no chat, the button doesn't show. |
| Opening a posting or meeting link, directions | Works | Through the host's `ui/open-link` (verified in the test host. In Ri the posting link opened `https://lumen.example/careers/staff-designer` and Open in browser opened `/opportunities?selected=<id>`, in a new tab on the web and in the system browser from the desktop app. ChatGPT and Claude pending). Where a host can't open it, or refuses it, the address shows to copy. Ri opens https links anywhere. |
| View-only actions the model never saw (`visibility: app`) | Works | The person's decisions are view-only (MCP Apps' `visibility: ["app"]`). It's the host's rule: Ri enforces it, and so does the test host. A host that ignores it would let its model call them, so each still checks the caller's access, and a write still needs a connection that may write. |
| Open in browser | New | In a host, the header and every card offer Open in browser, which opens the app's own page at the place the person is in, through the host's open-link. It's the way out for anything a host doesn't allow. An address on this computer isn't offered on a phone or tablet (the kit's rule), so away from the Mac the person has no way out until the app has a reachable address. |

## Real hosts

Checked on November 16, 2026. "Ri" is a **disposable Ri at f55cdf96** on this Mac with dummy and fictional records, not Trey's own Ri. Job Search ran as the installed service at `http://127.0.0.1:4312` (release 0c3c59b) and Ri connected it through the consent screen. Full-screen checks used **Add MCP server** (R6). Screenshots: `docs/parity/ri-*.png`.

| Check | Ri on the web | Ri's desktop app | ChatGPT | Claude |
| --- | --- | --- | --- | --- |
| Connect, `open_job_search` and the tools listed | Works: consent, token, 41 tools including `open_job_search` and `search_mentions` | Same connection | Pending | Pending (desktop set up, waits on a restart) |
| Every screen (Today, Opportunities board and workspace, Materials, Sources) | Works, with the fictional preview | Works (workspace, board, Sources) | Pending | Pending |
| Person-only actions from the view | Work: `load_preview`, `preview_import`, `apply_import`, export | Work: export | Pending | Pending |
| The model can't call them | Refused: `export_records`, `clear_preview` | Same Ri server | Pending | Pending |
| Links out and Open in browser | Posting link and Open in browser open in a new tab | Open in the system browser | Pending | Pending |
| Saving files | Ri's card, then saved (`job-search-export-2026-11-17.json`) | Same, saved through Electron's download | Pending | Pending |
| Picking files | Chooser opens in the frame, a dummy description saved | Chooser opens | Pending | Pending |
| Ask drafts | In the main chat's draft, unsent | Same | Pending | Pending |
| Opening at a record | `/opportunities/<id>` opens Lumen | Same | Pending | Pending |
| The @ menu | Finds Lumen and its cover letter | Not checked | Pending | Pending |
| Selection reaching the next message | Doesn't (R7) | Doesn't (R7) | Pending | Pending |
| Light and dark | Dark only in Ri (R8). The app follows it | Same | Pending | Pending |
| Phone and desktop widths | 390 px fits, no sideways scroll; 1396 px | Window is at least 800 px wide, 390 px emulated | Pending | Pending |
| View size and load time | View 1,116,256 bytes. Warm reload 1.1 s, open by link 5.0 s (Ri's dev server) | Open at a record 10.9 s under heavy load | Pending | Pending |

Load times are from Ri's development server on a heavily loaded Mac (load average 150 to 250), so they're upper bounds. The disposable Ri had no model harness, so cards from `show_*` and reading an @ item at send weren't checked.

Small things seen, not fixed: the consent screen reads "All your parts of your job search, including new ones" (the sources' plural label after "All your"), and the export's file name uses the UTC date (`2026-11-17` on the evening of November 16 in Denver).

## What's still blocked

| What | Why |
| --- | --- |
| Running on Cloudflare | Kit gap K9: no interactive transactions on the platform's database. |
| A deleted account's source can come back in an old connection's choice | Kit gap K8. |
| The app finding which accounts Ri granted | Kit gap K1 (and Ri, R1). The person adds each account. |
| Invitation files, reply linkage and calendar participants with only the kit's basic mail and calendar tools | Kit gaps K2 and K3. The app uses Ri's Gmail and Calendar tools by name when Ri lends them. |
| Choosing a file inside a host's frame | Works in Ri (web and desktop): Save a job, then "Choose a PDF, Word or text file", opened the chooser from the frame. ChatGPT and Claude are untested. Open in browser covers a host that refuses. |
| Open in browser on a phone or tablet | The kit doesn't offer an address on this computer away from it. The app has no other address while it runs on the Mac. |

## Findings for the kit

Closed by core 0.2.2: K4 (opening at a record), K5 (view-only tools), K6 (a wider context, and a question drafted in the chat) and K7 (links and downloads from the view). Still open:

- **K1. Which accounts the hub granted.** Ri's hub tells an app the accounts it may use only inside each tool's description, and the kit's connector client returns tool names only. An app can't list them, so the person types each address. Kit: expose tool input schemas or an `accounts()` call. Ri: list granted accounts as an enum on `account`, or offer a tool that lists them.
- **K2. Mail shape.** The kit's `MailMessage` still has no Message-ID, In-Reply-To, References, list headers or attachments, so invitation files and reply linkage need Gmail's own tools by name (`call`). Kit: add those fields and an attachment read to the mail capability.
- **K3. Calendar shape.** The kit's `CalendarEvent` still has no participants, organizer, description, original time zone or cancellations. Kit: add them, or an incremental sync capability.
- **K8. Retiring a source.** No way for an app to remove a deleted source from every connection's choice.
- **K9. Transactions.** No interactive transaction on the platform's database, so an app with read-then-write rules runs on Node only, with its own synchronous handle on the same file.
- **K10. Fixture source.** It answers every pass-through tool with one fixed result whatever the arguments, so Gmail history, full messages and calendar sync can't be exercised with it (this app's tests use a hub-shaped fake for those). Its mail search understands plain words and `from:`, `after:` and `before:` only, not Gmail's OR groups or exclusions, so the app's basic-tools path searches plain words.
- **K11. Hub errors.** The connector client still keeps only the hub's message, not its error code (except `denied`), so the app reads "not found" (an expired history checkpoint, a deleted message) from the message text. Ri answers `authorization_required` and `additional_permission_required` as ordinary results without `isError`, and the client passes them through as data. The app treats them as "reconnect".
- **K12. Where `upgrade` writes its log.** Run in an app that isn't installed as a service and without `APP_DATA_DIR`, `upgrade` created `~/.local/share/job-search/releases/` for its log and history, the default data directory of an installation that doesn't exist. Nothing else was written there.

## Findings for Ri

- **R1. Accounts.** See K1.
- **R2. Approval for tasks.** The shared spec says an app's writes to the person's own data, such as Ri tasks, follow the person's normal settings and don't ask by default. Ri's hub, as read on November 12, asked for every app write. Not rechecked against Ri since. Job Search handles both: the follow-up waits for approval and its job retries the identical call.
- **R4. Downloads.** Fixed by dynamismlabs/ri#2: export inside Ri saves through Ri's card.
- **R5. A tool input named `account`.** Ri's engine reserves `account` and refuses a whole server whose tool declares it. `set_source`, `list_source_calendars` and `preview_source` took `account`, so Ri couldn't add Job Search at all. They now take `sourceAccount` (commit 0c3c59b, with a contract test). Ri should skip or rename that one tool rather than refuse the server.
- **R6. Add app can't open a screen.** Ri publishes an app added with Add app as `app_<slug>.<tool>`, but Open app, the view's calls, the @ search and settings call `mcp.<slug>.<tool>`, which Ri doesn't know ("unknown action"). Add MCP server works around it.
- **R7. A full-screen app's selection never reaches a message.** Ri drops a view's context when it closes, and its full-page screen has no chat beside it.
- **R8. Ri has only a dark theme,** so the app's light look inside Ri can't be checked.
- **R3. The model service** needs Ri's Claude subscription harness. Without it, Job Search's AI suggestions and email readings report "Extraction unavailable".
