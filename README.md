# pi-status-footer

Compact two-line status footer for the pi TUI: context usage, tokens, cost, live TPS, git diff, and run timers.

See [pi.dev docs](https://pi.dev) for how extensions work.

## What's included

| Extension | Command / shortcut | What it does |
|---|---|---|
| `stats-footer.ts` | (no command; TUI footer widget) | Renders a two-line footer: line 1 stats/timers, line 2 folder, git branch/diff, model, thinking level |

It registers no slash commands, shortcuts, flags, tools, or providers. It hooks session/agent/turn/message events (`session_start`, `agent_start`, `agent_settled`, `turn_start/end`, `message_start/update/end`, `model_select`, `thinking_level_select`, `session_info_changed`, `session_shutdown`) to update the footer.

## Install

```bash
pi install npm:pi-status-footer
pi install git:github.com/kslamph/pi-status-footer
pi install ./pi-status-footer
```

Try without installing (one run only, nothing saved):

```bash
pi -e npm:pi-status-footer
pi -e ./stats-footer.ts
```

The footer appears automatically in the next TUI session.

## Usage

Just run `pi` in the TUI. Example footer:

```
📦 38%/128k  💾 63%  ↑5.2k ↓8.1k  💰 $0.420 +$0.020000  ⚡42 t/s  ⏳ 4:32  💬 1:18
📁 my-project ▸  main +3 -1  🤖 openai/gpt-4o 💭 medium
```

Line 1: context used/limit, cache hit rate, input/output tokens, session cost + current-run delta, tokens/sec (live while streaming, last rate when idle), agent-run timer, current-turn timer. Line 2: folder (repo root, or cwd outside a repo), branch, working-tree diff vs HEAD, provider/model, thinking level. Narrow terminals shorten the model id from the left first; the folder/git group drops only if the model still can't fit.

## Configuration

Zero config. No env vars, no settings keys.

## Security note

Runs in-process with your OS permissions. It reads session entries (token usage, cost, model, context) and runs one shell command, debounced to 1s during agent runs: `git diff --shortstat HEAD` (with `--no-optional-locks`, 3s timeout) plus a walk-up check for `.git` to find the repo root. No network access, no file writes.

## Update / remove / enable-disable

```bash
pi update --extensions        # update all packages
pi update npm:pi-status-footer
pi remove pi-status-footer
pi list
pi config                     # enable/disable resources
```

## Compatibility

- Peer deps: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (any version with `ctx.ui.setFooter`)
- TODO: confirm exact tested Pi version and OS coverage (developed on Linux)

## Development

```bash
git clone https://github.com/kslamph/pi-status-footer.git
cd pi-status-footer
pi install ./                          # local copy loads in place
pi -e ./stats-footer.ts                # single run from inside the repo
npm test                               # runs test-layout, test-live-tps, test-cost
```

No build step; pi loads the TypeScript file directly. Optional typecheck: install the peer deps as devDependencies, then `npx tsc --noEmit stats-footer.ts`.

## License + credits

MIT — see [LICENSE](./LICENSE). Footer demo image: `docs/footer-demo.png`.
