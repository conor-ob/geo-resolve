# geo-resolve

Resolve loose ISO 3166 references (codes, names, aliases) to the place they denote.

See the [package README](packages/geo-resolve/README.md) for installation and usage. Design decisions are recorded in [`docs/adr`](docs/adr), and the domain terms in [`GLOSSARY.md`](GLOSSARY.md).

## Development

This is a pnpm workspace using [Vite+](https://viteplus.dev):

- `packages/geo-resolve`: the published package
- `tools/codegen`: private data pipeline
- `tools/docs`: private TypeDoc build of the API reference, into `tools/docs/dist`

```bash
vp install
vp run lint
vp run fmt:check
vp run typecheck
vp run test
vp run @geo-resolve/docs#build
```

The package README's `ts` examples are run by `packages/geo-resolve/tests/readme.test.ts`: a statement ending in `// => <value>` must evaluate to that JavaScript literal.

## Releasing

Releases are driven by [Changesets](https://github.com/changesets/changesets) and staged on npm by the [release workflow](.github/workflows/release.yaml):

1. A PR that changes the published package adds a changeset with `vp run changeset`, choosing the bump by ADR-0006 and ADR-0007.
2. On every push to `main`, the workflow opens or updates the `chore(release): version packages` PR, which bumps the version and writes the changelog from the pending changesets.
3. Merging that PR makes the workflow pack the package with pnpm and stage it with `npm stage publish`, through trusted publishing with provenance (no npm token). It also pushes the `geo-resolve@<version>` tag and creates its GitHub release, before the version goes live. Releases are immutable (a repository setting), so that tag can never be moved or reused: if you reject a staged version, fix the problem and release the next version instead.
4. The staged version isn't live until the maintainer approves it with 2FA, with `npm stage approve <stage-id>` (`npm stage list geo-resolve` shows the id) or on the package's Staged Packages tab on npmjs.com. Run npm commands outside the repository root, whose `devEngines` makes npm refuse to run.

npm's trusted publisher for `geo-resolve` names `release.yaml` and the `npm` environment, and only allows staging, so the workflow can never publish a version directly.
