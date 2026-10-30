# Data and locales are loaded into explicit Resolver instances

About 5,000 Subdivisions and 100+ Locale packs are far too much to load by default, so data is opt-in. Callers build a Resolver from the Data packs and Locale packs they import:

```ts
import { createResolver } from "geo-resolve";
import countries from "geo-resolve/data/countries";
import subdivisions from "geo-resolve/data/subdivisions"; // or geo-resolve/data/subdivisions/US
import de from "geo-resolve/locales/de";

const resolver = createResolver({ data: [countries, subdivisions], locales: [de] });
```

The package's default entry exports functions bound to a ready-made Resolver with Countries and English only, so `import { resolve } from "geo-resolve"` stays a one-liner.

## Considered Options

- **Global registry (`register(subdivisions)`)**: rejected. It mutates module state, makes results depend on import order elsewhere in the app, and is harder to test.
- **Ship everything in one import**: rejected on bundle size.
