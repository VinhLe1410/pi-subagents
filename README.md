# pi-subagents

`pi-subagents` is a small subagent launcher for the [Pi agent harness](https://github.com/earendil-works/pi).

Use it when the main thread should hand a self-contained task to a named helper agent and wait for the helper's final answer.

Children run as hidden background `pi -p` processes. The parent tool call blocks until they finish.

## Install

```bash
git clone https://github.com/VinhLe1410/pi-subagents
```

## Model

A subagent is a named markdown agent file plus a task.

The parent chooses a listed agent and writes the task. The child starts with a fresh chat by default. It does not see the parent conversation unless the parent puts the needed context into the task.

Every subagent launch:

- runs hidden in the background
- waits for completion
- auto-exits after the final assistant message
- persists a child session file for debugging
- uses the parent/current project cwd
- disables project trust and project context files
- disables skills
- disables normal extensions, except the internal lifecycle helper and extensions explicitly whitelisted by the agent
- prevents child subagent spawning

Agent frontmatter is strict. Legacy fields such as `mode`, `async`, `blocking`, `background`, `cwd`, `fork`, `session-mode`, `skills`, `env`, `flags`, `trust-project`, and `no-session` are rejected; remove them from agent files.

## Parent tool

The extension exposes one parent-facing tool:

- `subagent` — launch one or more named helper agents and wait for completion

There is no resume tool and no kill tool. If the parent tool call is cancelled, running children are terminated.

### `subagent` parameters

Single child:

```json
{
  "name": "auth-scout",
  "title": "Auth implementation map",
  "agent": "worker",
  "task": "Inspect the auth flow. Include relevant files, current behavior, risks, and completion criteria in your final summary."
}
```

Parallel children:

```json
{
  "children": [
    {
      "name": "auth-scout",
      "title": "Auth implementation map",
      "agent": "worker",
      "task": "Map the auth implementation. Include files, key flows, and open risks."
    },
    {
      "name": "test-scout",
      "title": "Auth test coverage",
      "agent": "worker",
      "task": "Inspect auth-related tests. Report coverage gaps and exact files."
    }
  ]
}
```

Required per child:

- `name`: lower-kebab machine handle, 2-4 words, max 32 chars
- `title`: short human label for UI/session display
- `agent`: exact named agent definition
- `task`: self-contained task prompt

The tool schema does not accept launch-time `model` or `thinking`. Model selection lives in the agent markdown file. If the agent file has no model/thinking, the child inherits the parent model/thinking.

## Agent definitions

Agents live here:

- `.pi/agents/` in the project
- `~/.pi/agent/agents/` globally

Project agents override global agents with the same name.

Minimal agent:

```md
---
name: worker
description: General-purpose coding helper for delegated implementation, debugging, research, and verification.
tools: read,grep,find,ls,bash,edit,write
system-prompt: replace
---
You are a focused helper agent. Complete only the task you are given.

Your caller does not assume you have prior context. If the task lacks necessary context, say what is missing rather than guessing.

Return a concise final answer with what you did, important findings, files changed or inspected, and any remaining risks.
```

### Supported frontmatter

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | filename | Stable agent name used by `agent` |
| `description` | unset | One-line routing hint shown in the parent roster |
| `model` | parent model | Child model, optionally with `:thinking` suffix |
| `thinking` | parent thinking | Child thinking level when `model` does not include one |
| `tools` | Pi default tools | Built-in Pi tool allowlist, or `all` / `none` |
| `extensions` | none | Comma-separated Pi `-e` extension whitelist. `~` is expanded; `./` and `../` resolve from the agent file directory |
| `system-prompt` | `replace` | `replace` uses the agent body as system prompt; `append` appends it to Pi default |
| `timeout` | unset | Seconds before the child is terminated and returned as a normal failure result |

Unsupported/legacy fields are rejected with a clear error. Keep frontmatter to the fields above.

## Task writing

Children do not have previous conversation context by default. A good task includes:

- objective
- needed background/context
- scope boundaries
- relevant files, commands, errors, or facts
- constraints
- completion criteria
- expected output format

Bad:

```text
Based on what we discussed, fix it.
```

Good:

```text
Fix the null pointer in src/auth/validate.ts. Session.user can be undefined when the token is cached after expiry. Add a guard before accessing user.id; return 401 with "Session expired" when missing. Run the focused auth tests if available. Final answer: changed files, tests run, and remaining risks.
```

## Results

The child final assistant message is the result.

Visible result text is labeled lightly:

```text
auth-scout (worker):
<child final answer>
```

Child session paths, elapsed time, exit code, and status are kept in structured/collapsed metadata for debugging instead of the main visible text.

Failures, cancellations, and timeouts return normal labeled tool results so the parent can explain, retry, or synthesize.

## UI

The parent session gets a widget showing running children. The `/subagents` view is inspect-only: it shows running/completed children and agent definitions, but does not resume or kill children.

## Testing

```bash
bunx tsc --noEmit
npm test
```

## Credits

- upstream foundation: [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents)
- fork: [edxeth/pi-subagents](https://github.com/edxeth/pi-subagents)

## License

MIT
