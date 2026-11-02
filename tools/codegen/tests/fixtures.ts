import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface CldrFixture {
  /** Region codes CLDR marks as regular, written as CLDR writes them (ranges such as `AC~G` allowed). */
  regular: string[];
  /** Region codes CLDR marks as deprecated. */
  deprecated?: string[];
  /** `territoryCodes` entries from supplementalData.xml. */
  codes: { type: string; alpha3?: string; numeric?: string }[];
  /** English territory names from main/en.xml; `alt` forms are written as CLDR writes them. */
  names: { type: string; name: string; alt?: string }[];
  /** Subdivision Snapshots, keyed by CLDR's lowercase, unhyphenated codes such as `usca`. */
  subdivisions?: SubdivisionFixture;
}

export interface SubdivisionFixture {
  /** Subdivision codes CLDR marks as regular, written as CLDR writes them (ranges such as `ad02~8` allowed). */
  regular: string[];
  /** Subdivision codes CLDR marks as deprecated. */
  deprecated?: string[];
  /** `subgroup` entries from supplemental/subdivisions.xml: a Country (`ES`) or Subdivision (`esan`) and what it contains. */
  containment: { type: string; contains: string[] }[];
  /** English Subdivision names from subdivisions/en.xml. */
  names: { type: string; name: string }[];
}

/** Writes CLDR Snapshots laid out as `fetch` writes them, and returns the Snapshot directory. */
export async function writeCldrSnapshots(fixture: CldrFixture): Promise<string> {
  const sourcesDir = await mkdtemp(join(tmpdir(), "geo-resolve-sources-"));
  const files = {
    "cldr/common/validity/region.xml": regionValidity(fixture),
    "cldr/common/supplemental/supplementalData.xml": supplementalData(fixture),
    "cldr/common/main/en.xml": englishNames(fixture),
    "cldr/common/validity/subdivision.xml": subdivisionValidity(fixture),
    "cldr/common/supplemental/subdivisions.xml": subdivisionContainment(fixture),
    "cldr/common/subdivisions/en.xml": englishSubdivisionNames(fixture),
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(sourcesDir, path)), { recursive: true });
    await writeFile(join(sourcesDir, path), contents);
  }
  return sourcesDir;
}

/** Writes an Overlay file holding `overlay`, in whatever shape the test gives, and returns its path. */
export async function writeOverlay(overlay: unknown = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "geo-resolve-overlay-"));
  const overlayPath = join(dir, "overlay.json");
  await writeFile(overlayPath, JSON.stringify(overlay));
  return overlayPath;
}

export function outputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "geo-resolve-out-"));
}

function regionValidity({ regular, deprecated = [] }: CldrFixture): string {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE supplementalData SYSTEM "../../common/dtd/ldmlSupplemental.dtd">
<supplementalData>
	<idValidity>
		<id type='region' idStatus='regular'>		<!-- ${regular.length} items -->
			${regular.join(" ")}
		</id>
		<id type='region' idStatus='deprecated'>
			${deprecated.join(" ")}
		</id>
		<id type='region' idStatus='unknown'>
			ZZ
		</id>
	</idValidity>
</supplementalData>
`;
}

function supplementalData({ codes }: CldrFixture): string {
  const rows = codes.map(({ type, alpha3, numeric }) => {
    const attributes = [`type="${type}"`];
    if (numeric !== undefined) attributes.push(`numeric="${numeric}"`);
    if (alpha3 !== undefined) attributes.push(`alpha3="${alpha3}"`);
    return `\t\t<territoryCodes ${attributes.join(" ")}/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE supplementalData SYSTEM "../../common/dtd/ldmlSupplemental.dtd">
<supplementalData>
	<codeMappings>
		<languageCodes type="aa" alpha3="aar"/>
${rows.join("\n")}
		<currencyCodes type="EUR" numeric="978"/>
	</codeMappings>
</supplementalData>
`;
}

function englishNames({ names }: CldrFixture): string {
  const rows = names.map(({ type, name, alt }) =>
    alt === undefined
      ? `\t\t\t<territory type="${type}">${name}</territory>`
      : `\t\t\t<territory type="${type}" alt="${alt}">${name}</territory>`,
  );
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE ldml SYSTEM "../../common/dtd/ldml.dtd">
<ldml>
	<identity>
		<version number="$Revision$"/>
		<language type="en"/>
	</identity>
	<localeDisplayNames>
		<territories>
${rows.join("\n")}
		</territories>
	</localeDisplayNames>
</ldml>
`;
}

const noSubdivisions: SubdivisionFixture = { regular: [], containment: [], names: [] };

function subdivisionValidity({ subdivisions = noSubdivisions }: CldrFixture): string {
  const { regular, deprecated = [] } = subdivisions;
  return `<?xml version='1.0' encoding='UTF-8' ?>
<!DOCTYPE supplementalData SYSTEM '../../common/dtd/ldmlSupplemental.dtd'>
<supplementalData>
	<version number="$Revision$"/>
	<idValidity>
		<id type='subdivision' idStatus='regular'>		<!-- ${regular.length} items -->
			${regular.join(" ")}
		</id>
		<id type='subdivision' idStatus='deprecated'>
			${deprecated.join(" ")}
		</id>
		<id type='subdivision' idStatus='unknown'>
			aezzzz
		</id>
	</idValidity>
</supplementalData>
`;
}

function subdivisionContainment({ subdivisions = noSubdivisions }: CldrFixture): string {
  const rows = subdivisions.containment.map(
    ({ type, contains }) => `\t\t<subgroup type="${type}" contains="${contains.join(" ")}"/>`,
  );
  return `<?xml version='1.0' encoding='UTF-8' ?>
<!DOCTYPE supplementalData SYSTEM '../../common/dtd/ldmlSupplemental.dtd'>
<supplementalData>
	<version number="$Revision$"/>
	<subdivisionContainment>
${rows.join("\n")}
	</subdivisionContainment>
</supplementalData>
`;
}

function englishSubdivisionNames({ subdivisions = noSubdivisions }: CldrFixture): string {
  const rows = subdivisions.names.map(
    ({ type, name }) => `\t\t\t<subdivision type="${type}">${name}</subdivision>`,
  );
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE ldml SYSTEM "../../common/dtd/ldml.dtd">
<ldml>
	<identity>
		<version number="$Revision$"/>
		<language type="en"/>
	</identity>
	<localeDisplayNames>
		<subdivisions>
			<!-- AD : Andorra -->
${rows.join("\n")}
		</subdivisions>
	</localeDisplayNames>
</ldml>
`;
}
