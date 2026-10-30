# Semver for data changes

ISO 3166 changes several times a year. If every code change were a major release nobody would upgrade, so data changes follow these rules:

- **Patch**: corrections to Names or Aliases.
- **Minor**: new or changed codes, new Locales, and Entities moving from current to Historic (they still resolve, now as Historic countries).
- **Major**: changes to the API or to the shape of Entities, as defined by the API stability contract (ADR-0006).

A minor release can therefore change what a given Input resolves to. Each data release's changelog lists the ISO 3166 change notices it includes, so consumers can see exactly what moved.
