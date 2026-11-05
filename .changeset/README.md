# Changesets

Each Markdown file here is a changeset: a note of a change to `geo-resolve` and the semver bump it needs. Add one to every PR that changes the published package, with `vp run changeset`. The release workflow collects them into a version PR (see "Releasing" in the repository README).

Choose the bump by the API stability contract (ADR-0006) and the data semver rules (ADR-0007). A data release lists the ISO 3166 changes it includes.
