# geo-resolve

## Checks

Run tools through `vp`: `vp run <script>` at the root, `vp run <package>#<script>` for a workspace (`vp install` first in a fresh worktree). Before pushing, run `vp run check`, which mirrors CI. On a rebase conflict in generated data (`packages/geo-resolve/src/data`, `tools/codegen/build-report.md`), take main's copy and rerun `vp run @geo-resolve/codegen#build`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on `conor-ob/geo-resolve` via the `gh` CLI: read one with `gh issue view <n> --json title,body,comments,labels`. See `docs/agents/issue-tracker.md`.

A PR that closes an issue lists each of its acceptance criteria in the body, as done or deferred to a named follow-up issue.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Codegen

Before changing the data pipeline (`tools/codegen`), read `tools/codegen/README.md`.
