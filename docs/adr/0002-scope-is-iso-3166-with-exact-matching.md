# Scope is ISO 3166, with exact matching only

geo-resolve covers the three parts of ISO 3166: Countries (3166-1), Subdivisions (3166-2) and Historic countries (3166-3). Cities and lower administrative levels (GeoNames, OpenStreetMap) are out of scope: they are orders of magnitude larger, have no single authority, and would turn a lookup library into a gazetteer. UN M49 continents and regions are deferred but the Entity model leaves room for them as a future Kind.

Inputs are matched exactly after normalising case and diacritics; there is no fuzzy or typo-tolerant matching. Fuzzy matching brings false positives, bundle weight and a scoring API we would have to keep stable. If it is wanted it should ship as a separate opt-in entry point or package, not change what `resolve` returns.
