# Coding standards

Judgement calls a reviewer checks in every diff. Anything a tool can check lives in `vp run check` instead.

## Domain language

- Capitalise a word only where it is the `GLOSSARY.md` term, and use it in that sense: CLDR's alternative names are Aliases, not Names; CLDR's `<territory>` element is a region, not a Territory.
- A comment, error message or test name that depends on a decision cites its ADR (`(ADR-0013)`).

## Codegen

- Every file codegen reads is parsed with a zod schema named `…Schema`, never cast.
- `build` collects every problem into its `problems` list and fails once at the end, so one run reports them all.
- Every Overlay entry must still change what the Sources give; a stale entry is a problem, so upstream fixes are noticed.
- Logic shared with `packages/geo-resolve` (normalising an Input, what an Input matches) is imported from the package, never copied: through its public interface, or its own modules re-exported by `tools/codegen/src/package.ts`.
- Logic in a GitHub Actions workflow beyond a one-line command lives in a `tools/codegen` command with a Vitest test; the workflow only runs it.

## Style

- Every function, helper and closure that names a concept has a one-line doc comment saying what it returns or does, matching the surrounding code.
