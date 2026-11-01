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

/** A geographic unit geo-resolve can resolve an Input to. */
export type Entity = Country;

/** Narrows which Entities an Input may resolve to. */
export interface ResolveOptions {
  /** Only consider Entities of these Kinds. */
  readonly kinds?: readonly Kind[];
}
