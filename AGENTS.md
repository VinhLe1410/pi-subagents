# AGENTS.md

## Project structure contract

Keep the repository organized by ownership. Do not recreate a catch-all `src/subagents/` or generic `test/parts/` directory.

Source layout:

- `src/subagents.ts` is extension wiring only: event hooks, tool registration, and thin glue.
- `src/agents/` owns agent definitions, catalog messaging, and titles.
- `src/launch/` owns child launch preparation, launch policy, child command construction, resume args, prompt artifacts, runtime path resolution, and session seeding.
- `src/runtime/` owns running state, wait/join, shutdown, background watchers, result routing, and widgets.
- `src/session/` owns JSONL session helpers and trimmed fork-session logic.
- `src/tools/` owns Pi tool/command implementations and tool policy.
- `src/artifact-storage.ts` owns artifact storage roots/paths. `src/launch/prompt-artifacts.ts` owns writing launch prompt/task artifact files. Do not blur these names.
- `src/types.ts` is shared runtime type surface only; do not turn it into a junk drawer.

Test layout:

- Use `test/`, not `tests/`; this repo follows Node package convention and `node --test` scripts already target `test/`.
- Mirror source ownership in tests: `test/agents/`, `test/launch/`, `test/runtime/`, `test/session/`, `test/tools/`, `test/artifacts/`.
- `test/test.ts` is an orchestrator that imports domain suites. Keep it small.
- `test/support/` is split by ownership: `node.ts`, `env.ts`, `fixtures.ts`, `project.ts`, `index.ts`. Do not recreate a fat `test/support.ts`.
- Never name split files `part-*`, `chunk-*`, or similar. File names must describe the behavior/domain they test.

## File size and split rules

- Source files should stay under ~600 LOC. If a source file approaches that, split by ownership before adding more logic.
- Test files should stay cohesive; ~600 LOC is a target, ~1000 LOC is the hard ceiling. Do not split tests just to satisfy a number if it creates artificial buckets.
- Prefer extracting a real lifecycle/domain module over making helper dumping grounds.
- Do not use `// @ts-nocheck`. If a test intentionally probes dynamic result shapes, use a local cast at that assertion instead of disabling type checking for the file.

## Naming rules

- Names should encode ownership, not implementation history. Good: `artifact-storage.ts`, `prompt-artifacts.ts`, `wait-join.test.ts`, `fork-session.test.ts`. Bad: `shared.ts`, `helpers2.ts`, `parts/`, `new-runtime.ts`.
- Avoid generic `shared/`, `utils/`, `helpers/`, or `common/` directories unless there are multiple clear consumers and no better domain name.
- Barrel files are allowed only as public/domain entrypoints (`test/support/index.ts`). Do not hide unused re-export files behind barrels.

## Validation gates

For ordinary code changes, run:

```bash
bunx tsc --noEmit
npm test
```

For structure/cleanup changes, also run temporary cleanup checks without adding dependencies:

```bash
bunx biome check .
bunx knip
```
