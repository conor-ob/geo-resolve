/** The Kinds geo-resolve ships today. May grow in a minor release (ADR-0006). */
export type KnownKind = "country" | "subdivision" | "historic-country" | "territory";

/** Which category an Entity belongs to. Handle unknown values: new Kinds may be added in a minor release. */
export type Kind = KnownKind | (string & {});

/** A currently assigned ISO 3166-1 entry. */
export interface Country {
  readonly kind: "country";
  /** The Country's Alpha-2 code. */
  readonly id: string;
  /** The ISO 3166-1 alpha-2 code, such as `DE`. */
  readonly alpha2: string;
  /** The ISO 3166-1 alpha-3 code, such as `DEU`. */
  readonly alpha3: string;
  /** The ISO 3166-1 numeric code as a three-digit string, such as `276`. */
  readonly numeric: string;
  /** The English Name, such as `Germany`. */
  readonly name: string;
  /** Codes in non-ISO Code systems, such as the IOC's `GER` for `DE`. */
  readonly codes?: Codes;
  /** The `id`s of Entities ISO lists separately that denote the same territory, such as `US-PR` for `PR`. */
  readonly sameAs?: readonly string[];
}

/** The Code systems geo-resolve ships today. May grow in a minor release (ADR-0006). */
export type KnownCodeSystem = "ioc" | "fifa";

/** An Entity's codes in non-ISO Code systems, keyed by Code system. Handle unknown keys: new Code systems may be added in a minor release. */
export type Codes = { readonly [system in KnownCodeSystem | (string & {})]?: string };

/** A currently assigned ISO 3166-2 entry: a principal administrative division of a Country. */
export interface Subdivision {
  readonly kind: "subdivision";
  /** The Subdivision's Subdivision code. */
  readonly id: string;
  /** The ISO 3166-2 Subdivision code, such as `US-CA`. */
  readonly code: string;
  /** The Alpha-2 code of the Country the Subdivision belongs to, such as `US`. */
  readonly country: string;
  /** The `id` of the Entity the Subdivision sits directly under: its Country, or another Subdivision (`ES-AN` for `ES-AL`). */
  readonly parent: string;
  /** The English Name, such as `California`. */
  readonly name: string;
  /** Codes in non-ISO Code systems, such as FIFA's `ENG` for `GB-ENG`. */
  readonly codes?: Codes;
  /** The `id`s of Entities ISO lists separately that denote the same territory, such as `PR` for `US-PR`. */
  readonly sameAs?: readonly string[];
}

/** A former ISO 3166-1 entry that has been withdrawn and recorded in ISO 3166-3, such as Yugoslavia. */
export interface HistoricCountry {
  readonly kind: "historic-country";
  /** The Historic country's Alpha-4 code. */
  readonly id: string;
  /** The ISO 3166-3 alpha-4 code, such as `YUCS`. Unique, unlike the former Alpha-2 code, which ISO may reassign. */
  readonly alpha4: string;
  /** The former ISO 3166-1 alpha-2 code, such as `YU`. */
  readonly alpha2: string;
  /** The former ISO 3166-1 alpha-3 code, such as `YUG`, where ISO assigned one. */
  readonly alpha3?: string;
  /** The former ISO 3166-1 numeric code as a three-digit string, such as `891`, where ISO assigned one. */
  readonly numeric?: string;
  /** The English common short Name, such as `Yugoslavia`. */
  readonly name: string;
  /** When ISO withdrew the code, as an ISO 8601 date only as precise as ISO published it: `1977` or `2003-07-23`. */
  readonly withdrawn: string;
  /** The `id`s of the Entities ISO names as replacing it, which may themselves be Historic countries (`YUCS` → `CSXX`). */
  readonly successors: readonly string[];
}

/** A geographic unit geo-resolve can resolve an Input to. */
export type Entity = Country | Subdivision | HistoricCountry;

/** A separately importable bundle of Entities, such as all Subdivisions or one Country's Subdivisions. */
export type DataPack = readonly Entity[];

/** Narrows which Entities an Input may resolve to. */
export interface ResolveOptions {
  /** Only consider Entities of these Kinds. */
  readonly kinds?: readonly Kind[];
  /**
   * Only consider the Entity with this `id` (an Alpha-2 or Subdivision code) and those under it at any depth,
   * and let a bare Subdivision code suffix (`"CA"` within `"US"`) match. An unknown or withdrawn `id` matches nothing.
   */
  readonly within?: string;
}
