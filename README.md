# Job Search

Job Search keeps the description, correspondence, submitted materials, interviews and next action for every opportunity together, from saving a posting to preparing for its interview. It runs on its own as an MCP server with its own data and screens, built with App Builder. Ri connects to it like any connector, and it borrows the person's Gmail and Google Calendar, Ri's model and Ri's tasks through Ri's hub.

It used to be an app bundled in Ri. [docs/parity.md](docs/parity.md) lists everything it did there and how each behaves here.

## What it does

- **Today**: upcoming interviews in their own time zones, invitations to choose times, deadlines you set, responses waiting for a decision and clearly labeled follow-up suggestions. No scores. A quiet application is never treated as a rejection or given an invented deadline.
- **Opportunities**: a board (Saved, Applied, Interviewing, Offer) and a table over the same records, with search, a stage filter and Active, Closed and Archived views.
- **Opportunity workspace**: overview, every saved posting snapshot, correspondence with the reason each message matched, submissions with their exact material versions, interviews with their history, stage history and Ri follow-ups.
- **Interview preparation**: requirements quoted from the posting snapshot, your own examples, questions and notes with revisions, and AI suggestions kept in their own labeled list with their evidence.
- **Materials**: résumés and cover letters as immutable versions, compared line by line.
- **Sources**: matching review, the accounts read through Ri, coverage and sync state, imported files and a personal export.

Nothing is ever sent, applied for, booked or written to a calendar. A follow-up becomes a Ri task only when you ask, after you approve it in Ri.

## Running it

Commit, then install it as your own service from this folder:

```
pnpm exec app-builder serve --install
```

It prints its address, `http://127.0.0.1:4310` by default (`PORT` changes it). Data lives in `~/.local/share/job-search`, or `APP_DATA_DIR`. Change a running app with `pnpm exec app-builder change`, which checks the new commit in a separate copy before switching. For development, use `pnpm dev` with a disposable `APP_DATA_DIR`, and `APP_CONNECTORS=fixtures` to read the fictional hub in `fixtures/connectors.json`.

It runs on the computer only, not on Cloudflare. [docs/parity.md](docs/parity.md) says why.

## Connecting

- **Ri, Claude, ChatGPT**: add `http://127.0.0.1:4310/mcp` as an MCP server. Each place that connects gets the consent screen, which asks which parts of your job search it may see (saved jobs, materials, each account) and whether it may also make changes. Settings lists the connections and disconnects them.
- **Ri's hub**: in Settings, under "Your accounts through Ri", enter Ri's integrations address (or set `APP_HUB_URL`) and approve in Ri. Allow Gmail, Google Calendar, "Use your model", "Read the text of files it sends" and "Add tasks" as you want. Then add each account in Sources.

Assistants get the data tools (`list_opportunities`, `get_opportunity`, `get_today` and the rest), two cards (`show_opportunities`, `show_today`) and `open_job_search`, the whole app, which can open at an opportunity, an interview or a material. Hosts with an @ menu (Ri) offer your opportunities, interviews and materials there. Your own decisions, such as review decisions, deleting and importing, are only for you in the app's screens: hosts that follow MCP Apps, as Ri does, keep them from their model. In a host, Open in browser takes you to the app's own page.

## Trying it

In an empty app, "Try with fictional records" loads a fictional preview: invented companies, people, mail and calendar events, marked as fictional everywhere. "Remove them" takes them out again.

## Development

```
pnpm typecheck
pnpm test
pnpm build
pnpm test:host
```

`test:host` runs the built view in the kit's strict MCP Apps test host.

Tests use only fictional data, disposable data directories and fake or fixture hubs. See AGENTS.md for how the code is laid out and the rules that keep its records trustworthy.
