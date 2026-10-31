# geo-resolve

Resolve loose ISO 3166 references (codes, names, aliases) to the place they denote.

## Development

This is a pnpm workspace using [Vite+](https://viteplus.dev):

- `packages/geo-resolve`: the published package
- `tools/codegen`: private data pipeline

```bash
vp install
vp run lint
vp run fmt:check
vp run typecheck
vp run test
```
