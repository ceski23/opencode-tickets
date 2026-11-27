# OpenCode Tickets

Local-first ticket tracking for OpenCode V2. Tickets are Markdown files in your project.
Agents work them through five `ticket.*` tools, and `/tickets` opens a read-only TUI
browser. There is no database, daemon, external tracker, or standalone CLI.

## Install

OpenCode V2 is required. Add the plugin to `opencode.json` or `opencode.jsonc`:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugins": ["@ceski23/opencode-tickets"],
}
```

For a source checkout, install its dependencies and point `plugins` at the checkout:

```sh
bun install
```

```jsonc
{
	"plugins": ["../opencode-tickets"],
}
```

Relative paths, absolute paths, `file://` URLs, and package names are supported. One
entry loads the server tools, TUI, and RPC parts. OpenCode reloads plugins after a
configuration change; use `/reload` to force a full reload.

## Tickets

Tickets live at `<project>/.opencode/tickets/<id>.md`. The directory is created on first
creation; if it is absent, the backlog is empty.

```markdown
---
id: TK-1
title: Implement login endpoint
status: open
labels:
    - feature
parent: TK-3
blocked_by:
    - TK-2
---

## Description

Implement session-based authentication.

## Acceptance criteria

- [ ] Correct credentials create a session.
- [ ] Invalid credentials are rejected.
```

Frontmatter fields are `id`, `title`, `status`, `labels`, `parent`, and `blocked_by`.
Everything after the frontmatter is arbitrary Markdown. IDs are generated as `TK-1`,
`TK-2`, and so on; a ticket's filename must be its ID plus `.md`.

Tickets are plain files, so you can commit them or ignore `.opencode/tickets/`. Manual
edits are allowed. The whole directory is validated whenever tickets are read or written,
so malformed YAML, unknown fields, duplicate IDs, missing references, and cycles appear
as actionable errors instead of being skipped.

## Statuses and relationships

| Status        | Meaning         |
| ------------- | --------------- |
| `open`        | Not started     |
| `in_progress` | Being worked on |
| `closed`      | Done            |

`parent` stores one optional parent ID. `blocked_by` stores direct blockers. `children`,
`blocks`, `ready`, and `blocked` are derived and never stored.

- A ticket is **ready** when it is `open` and every blocker is `closed`.
- A ticket is **blocked** when at least one blocker is not closed. `blocked` is an
  indicator, not a fourth status, and can coexist with `in_progress`.
- Parent/child does not imply blocking.
- Status changes do not cascade. Closing a parent does not close its children.
- Self-references, missing references, parent cycles, and blocking cycles are rejected.
- A ticket cannot be deleted while another ticket references it as a parent or blocker.

`in_progress` is an advisory workflow state, not a multi-agent ownership lock.

## Agent tools

The tools live in the `ticket` namespace. In Code Mode, call `tools.ticket.search(...)`,
`tools.ticket.get(...)`, and so on.

| Tool            | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `ticket.search` | Find tickets. Returns compact summaries, never full bodies.  |
| `ticket.get`    | Read one ticket with its body, relationships, and readiness. |
| `ticket.create` | Create a ticket. New tickets always start `open`.            |
| `ticket.update` | Change metadata, relationships, or body content.             |
| `ticket.delete` | Delete an unreferenced ticket.                               |

### Search

All filters combine with AND:

| Filter       | Meaning                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `query`      | Full ticket ID matches only that ticket; otherwise exact IDs rank first, followed by fuzzy matches weighted title > labels > body |
| `id`         | Exact ticket ID                                                                                                                   |
| `status`     | Exact status                                                                                                                      |
| `labels`     | Ticket must have every listed label                                                                                               |
| `parent`     | Parent ID; `null` selects roots                                                                                                   |
| `blocked_by` | Direct blocker ID                                                                                                                 |
| `ready`      | Derived readiness                                                                                                                 |
| `limit`      | 1–200, default 50                                                                                                                 |
| `offset`     | Nonnegative, default 0                                                                                                            |

Results are ordered by relevance, with ticket ID as the tie-break. Without a query they
are ordered by ID. Each result includes a plain-text `bodyPreview` of up to 200
characters; use `ticket.get` for the full body.

### Create

`title` is required. `body`, `labels`, `parent`, and `blocked_by` are optional. The caller
cannot choose an ID or initial status.

### Update

`ticket.update` requires `id` plus at least one change:

- Metadata: `title`, `status`, `parent`
- Labels: `labels` replaces the list; `add_labels` and `remove_labels` modify it
- Blockers: `blocked_by` replaces the list; `add_blocked_by` and
  `remove_blocked_by` modify it
- Body: `body` replaces the body; `append_body` appends a section

Conflicting forms cannot be combined: `body` with `append_body`, `labels` with label
add/remove, or `blocked_by` with blocker add/remove. The same value cannot be added and
removed in one call. Metadata-only updates preserve the Markdown body.

The complete proposed graph is validated before writing, so a failed update changes
nothing. The result contains `changed`, `bodyLength`, and, when the body changed,
`bodyTail` (the last 200 characters), but not the full body.

### Delete

Deletion is refused while another ticket references the target. Unlink those references
first; the plugin never rewrites other tickets.

## Context reminder

The server adds a short ticket note to agent context on each model call. When work is
outstanding, it reports open and in-progress counts, lists up to five in-progress tickets,
and reminds the agent to update ticket status and use the ticket tools instead of editing
files. It never includes ticket bodies. If ticket storage is invalid, the note is omitted,
the error is logged, and the model call continues.

## `/tickets`

Open the browser from the command palette, with `/tickets`, or by clicking the ticket
summary in the sidebar. It opens as a native dialog; `Esc` returns to the previous screen.

| Key           | Action                                                |
| ------------- | ----------------------------------------------------- |
| `Up` / `Down` | Move through visible rows                             |
| `Right`       | Expand, or enter the first child                      |
| `Left`        | Collapse, or move to the parent                       |
| `o`           | Open the selected Markdown file in the default editor |
| `r`           | Reload tickets from the server                        |
| `/`           | Focus the fuzzy search input                          |
| `Esc`         | Close the dialog                                      |

The left pane is a parent tree. The right pane shows the selected ticket's metadata,
relationships, readiness, and rendered Markdown body. Parent, child, blocker, and blocked
links are clickable. Rows select on click, chevrons expand or collapse, the mouse wheel
scrolls, and the header filters switch between `all`, `open`, `active`, and `closed`.
Search matches ticket IDs, titles, labels, and full Markdown bodies; it combines with
the selected status filter.

| Marker    | Meaning                 |
| --------- | ----------------------- |
| `[ ]`     | Open                    |
| `[~]`     | In progress             |
| `[x]`     | Closed                  |
| Lock icon | Has unresolved blockers |

Status markers remain readable text. The lock and expander symbols use Nerd Font glyphs;
the surrounding labels still identify the state if a glyph is unavailable.

The sidebar shows open and in-progress counts plus up to five outstanding tickets. It
stays hidden when the project has no tickets, refreshes every five seconds while
expanded, and reloads when reopened. Click a row or `and N more` to open the dialog. The
section's collapsed state is persisted.

All mutations happen through the agent tools or by editing ticket files. The dialog is
read-only and refreshes every five seconds while open, so changes made by the agent show
up without reopening it.

## RPC

The `@ceski23/opencode-tickets/rpc` export provides the read-only contract used by the
TUI:
`listTickets` for summaries (optionally including bodies with `includeBodies: true`) and
`getTicket` for one ticket's details. Other plugins can use it to read the same
server-side state. These methods are not agent tools.

## Development

```sh
bun install
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run check:config
```

`bun run check` runs all of the above. Use `bun run lint:fix` and `bun run format` to fix
lint errors and formatting locally.

The tests cover schema and storage, graph validation, the ticket service, search, the
context reminder, tree modeling, the agent tools, server integration, and representative
`/to-tickets`, `/implement`, and `/wayfinder` flows.

## Scope

Not included: assignments, claims, comments, priorities, timestamps, resolutions,
worktree or concurrency coordination, automatic execution or closure, external trackers,
a standalone CLI, desktop GUI, Kanban, graph editing, or Markdown editing in the TUI.

## License

MIT
