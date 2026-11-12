# Job Search: parity with the app Ri used to carry

Job Search was an app bundled in Ri (`apps/job-search`, last at Ri commit `3c442810`). This repository is the same app rebuilt on App Builder: an MCP server with its own data, its own jobs and its own screens, which Ri connects to with OAuth and which borrows the person's accounts, Ri's model and Ri's tasks through Ri's hub.

Every feature and behavior from the old README and tests is listed below with one of three marks:

- **Works**: the same behavior, checked by the ported tests or by hand.
- **Works differently**: the person or an assistant can still do it, in a different way. The entry says how.
- **Can't work**: it can't work on the new path today. The entry says why and what the kit or Ri would need.

The findings that need a change in the kit or in Ri are collected at the end.

## How it was checked

- **Tests**: the old app's tests, ported. 100 tests in 9 files, all fictional data. The domain tests run unchanged. The rules, workflow, sync, access, leak and release tests run through the kit's own action router, with Ri's hub played by a hub-shaped fake (`test/fakes.ts`) or by the kit's fixture source (`fixtures/connectors.json`). New tests cover the MCP server (OAuth token required, tool list, read-only connections, a connection limited to some sources, disconnecting in Settings) and the hub through the kit's fixture source (the scheduled import, a duplicate wake-up, an unreachable or revoked hub, a follow-up waiting for approval in Ri, text extraction, the model being unavailable).
- **By hand**, on disposable data directories:
  - The screens in a browser with the fixture hub: Today, Opportunities (board and the phone-width stage sections, with no sideways scroll), the workspace and Sources.
  - `serve --install --service process` passed every step (install, typecheck, tests, build, rehearsal, switch) and answered on `/api/health`. Both jobs showed in Settings' job list, and Run now finished with "Connect this app to Ri in Settings to use your accounts." The service was then removed with `serve --uninstall`.
  - An MCP client using the MCP SDK's own `auth()` completed OAuth against it: the 401 challenge, discovery, dynamic registration, PKCE, the app's consent screen offering its sources, the token, then tools. A retry with the same operationId returned the same record. A second connection limited to saved jobs and read only saw no materials and was refused a stage change. Refresh worked.
  - The assistant view in the kit's strict MCP Apps host (a scripts-only sandbox whose page may not reach the network): `show_opportunities` and `show_today` drew their cards, choosing a row sent the bounded selection, and `open_job_search` opened the whole app full screen with its sections working, with no network or CSP failures.
- **Not checked**: Ri itself (a later session checks every ported app inside Ri), Ri's real hub with a real Gmail account, the app connecting to a real hub with OAuth (the kit tests that against its stand-in hub), and the view inside Claude or ChatGPT.

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
| Sources: imported files, with Delete imported data | Works | Deleting is in the person's browser only (see "View-only actions"). |
| Sources: chats with access | Works differently | Each assistant connection (Ri's own chats, each Ri workspace, Claude, ChatGPT) chooses on the app's consent screen which parts it may see and whether it may change records. Settings lists the connections and disconnects them. Ri's per-chat scopes are gone. |
| Sources: personal export | Works differently | Download from Sources or Settings in the browser. Inside an assistant's view the app says to download from the browser, since the view can't save files (finding K7). |

## Inputs

| Input | Mark | Notes |
| --- | --- | --- |
| Pasted job description, résumé or cover letter | Works | |
| PDF or Word file up to 512 KB | Works | Read through Ri's `ri__extract_text` on the hub, as before through Ri. The original file is kept beside the extracted text, now inside the app's database. |
| Text, Markdown or HTML file | Works | Read in the app. |
| Choosing a file inside an assistant's view | Not checked | The view uses a file input. Whether a host's sandboxed frame allows it wasn't checked in Ri. Ri's old host had its own file picker. |
| A link, stored as written and never fetched | Works | |
| CSV of opportunities | Works | |
| Gmail, read only, 30, 90 or 365 days (90 by default), received and sent | Works | Through Ri's hub. When Ri lends Gmail's full read tools (profile, history, full message), the app runs the same history-based sync as before, with invitation files, reply headers and list headers. When Ri lends only the kit's basic mail tools (search and get message), it reads through the kit's mail adapter with less detail (findings K2 and K3). |
| Google Calendar, chosen separately, events matching a saved role become interviews with participants and original time zone | Works | Through Ri's `google_calendar__sync_events` and `google_calendar__list_calendars`, the same tools as before. With only the kit's basic calendar tool, events come without participants, organizer, description, original time zone or cancellations, so matching relies on the title (finding K3). |
| Nothing is ever sent, applied for, booked or written to a calendar | Works | The app asks Ri for no Gmail or Calendar writes. Its only write through the hub is a Ri task. |
| Follow-ups create a Ri task only after confirmation | Works differently | Ri now asks the person to approve every task an app adds, in Ri. The follow-up shows "Waiting for your approval in Ri", and the `follow_up_tasks` job retries the identical call, so the task appears once the person approves. Retries and repeat clicks still return one task (operation ID). See finding R2. |

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
| `list_opportunities`, `get_opportunity`, `save_opportunity`, `change_stage`, `get_posting`, `record_submission`, `list_interviews`, `save_interview`, `list_materials`, `get_material`, `save_material_version`, `compare_material_versions`, `archive_material`, `get_preparation`, `save_preparation`, `suggest_preparation`, `list_review`, `resolve_match`, `get_correspondence`, `get_today` | Works | The same actions, as MCP tools and over the browser's API. |
| `set_stage_tracking`, `list_sources`, `set_source`, `list_source_calendars`, `preview_source`, `continue_import`, `preview_import`, `apply_import`, `list_imports`, `create_follow_up`, `list_follow_ups` | Works differently | Now also MCP tools that assistants can see (finding K5). `set_source` also adds accounts and sets automatic updates. |
| `delete_source_data`, `delete_import`, `export_records` | Works differently | The person's browser only (finding K5). |
| `open_view` | Works differently | The kit's `open_job_search` opens the whole app, and `show_opportunities` and `show_today` draw cards in a chat. The screens load their setup from `get_view_state`. |
| `describe_view_context` | Works differently | The view tells the host the selected record's ID and title through the kit's bounded selection, and the assistant reads the record with its own tools and access. Ri's richer context (up to 50 selected records with their details) is gone (finding K6). |
| `create_scope`, `list_scopes`, `revoke_scope` | Works differently | The app's consent screen and Settings, per connection. |
| `run_background_step`, `sync_step`, `enrich_step` | Works differently | One declared job, `sync_sources`, every five minutes, runs the same bounded steps. |
| Reads paginated, 50 by default, 100 at most, filtered before anything is assembled | Works | |
| Writes take the revision they edited and a durable invocation ID, so a retry returns the first result | Works differently | Writes take the revision and an optional `operationId`. A retry with the same one returns the first result. MCP has no invocation ID of its own. The screens send one per click. |
| New: `load_preview`, `clear_preview`, `create_waiting_follow_ups`, `get_view_state`, `show_opportunities`, `show_today`, `open_job_search` | New | The fictional preview, the follow-up job, the screens' setup and the views. |

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
| Posting and material text up to 200,000 characters, files up to 512 KB, view selections | Works differently | The text and file limits are the same. The view's selection is one record (kit bounded selection). |
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
| Ri's "Try" preview with fictional records | Works differently | "Try with fictional records" in an empty app (browser only) loads the same fictional set, marked as fictional everywhere, with "Remove them". |
| Ri's packaged view test in headless Chrome | Works differently | Not ported (it drove Ri's runtime). The screens were checked by hand in a browser. The kit qualifies its view host separately. |

## The view inside an assistant

| Behavior | Mark | Notes |
| --- | --- | --- |
| The view in Ri, full screen and beside a chat | Works differently | `open_job_search` opens the whole app, and `show_opportunities` and `show_today` draw cards. Checked in the kit's strict MCP Apps host, not inside Ri. |
| Ri's host theme | Works | The kit applies the host's theme and fonts. |
| Ri remembered the view's place in its own address, so Back and reopening returned to it | Works differently | In the browser the place is the address. Inside an assistant the view keeps its place in memory while it's open. Reopening starts at the landing section. |
| Opening a record from elsewhere in Ri (entities with open paths) | Can't work | The kit declares no entities and `open_job_search` takes no input, so a host can't open the app at a record. Cards show records instead. Kit: entity declarations or a deep-link input for `open_<app>` (finding K4). |
| "Ask Ri" staged editable text in Ri's chat composer | Works differently | The button shows the question to copy into the chat. MCP Apps can add a message to the conversation (`ui/message`), but the kit's view client doesn't expose it, and it sends rather than stages (finding K6). |
| Opening a posting or meeting link, directions | Works differently | In the browser they open in a new tab. Inside an assistant the view shows the link to open in a browser, since the kit's view client has no host open-link (finding K7). |
| View-only actions the model never saw (`visibility: app`) | Can't work | The kit has no view-only tools. A view inside an assistant reaches the app only through tools the host lists, so the actions the screens use are now assistant tools too. Destructive ones stay in the browser only, and inside an assistant the screens say to use the browser for them. Kit: honor MCP Apps' app-only tool visibility (finding K5). |

## Findings for the kit

- **K1. Which accounts the hub granted.** Ri's hub tells an app the accounts it may use only inside each tool's description, and the kit's connector client returns tool names only. An app can't list them, so the person types each address. Kit: expose tool input schemas or an `accounts()` call. Ri: list granted accounts as an enum on `account`, or offer a tool that lists them.
- **K2. Mail shape.** The kit's `MailMessage` has no Message-ID, In-Reply-To, References, list headers or attachments, so invitation files and reply linkage need Gmail's own tools by name (`call`). Kit: add those fields and an attachment read to the mail capability.
- **K3. Calendar shape.** The kit's `CalendarEvent` has no participants, organizer, description, original time zone or cancellations. Kit: add them, or an incremental sync capability.
- **K4. Opening at a record.** No entities and no input on `open_<app>`. See above.
- **K5. View-only tools.** No way to mark an action callable by the view but hidden from the model.
- **K6. Context and chat.** The bounded selection carries one record's ID and title. No way for the view to put a question in the host's chat.
- **K7. Links and downloads from the view.** No host open-link or download in the view client.
- **K8. Retiring a source.** No way for an app to remove a deleted source from every connection's choice.
- **K9. Transactions.** No interactive transaction on the platform's database, so an app with read-then-write rules runs on Node only with its own handle.
- **K10. Fixture source.** It answers every pass-through tool with one fixed result whatever the arguments, so Gmail history, full messages and calendar sync can't be exercised with it (this app's tests use a hub-shaped fake for those). Its mail search understands plain words and `from:`, `after:` and `before:` only, not Gmail's OR groups or exclusions, so the app's Gmail search finds nothing in fixtures. The app's basic-tools path searches plain words for this reason.
- **K11. Hub errors.** The connector client keeps only the hub's message, not its error code, so the app reads "not found" (an expired history checkpoint, a deleted message) from the message text. Ri answers `authorization_required` and `additional_permission_required` as ordinary results without `isError`, and the client passes them through as data. The app treats them as "reconnect".

## Findings for Ri

- **R1. Accounts.** See K1.
- **R2. Approval for tasks.** The shared spec says an app's writes to the person's own data, such as Ri tasks, follow the person's normal settings and don't ask by default. Ri's hub as built asks for every app write. Job Search handles both: the follow-up waits for approval and its job retries the identical call.
- **R3. The model service** needs Ri's Claude subscription harness. Without it, Job Search's AI suggestions and email readings report "Extraction unavailable".
