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
}

/** A geographic unit geo-resolve can resolve an Input to. */
export type Entity = Country | Subdivision;

/** A separately importable bundle of Entities, such as all Subdivisions or one Country's Subdivisions. */
export type DataPack = readonly Entity[];

/** Narrows which Entities an Input may resolve to. */
export interface ResolveOptions {
  /** Only consider Entities of these Kinds. */
  readonly kinds?: readonly Kind[];
}
