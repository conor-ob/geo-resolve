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
}

/** Writes CLDR Snapshots laid out as `fetch` writes them, and returns the Snapshot directory. */
export async function writeCldrSnapshots(fixture: CldrFixture): Promise<string> {
  const sourcesDir = await mkdtemp(join(tmpdir(), "geo-resolve-sources-"));
  const files = {
    "cldr/common/validity/region.xml": regionValidity(fixture),
    "cldr/common/supplemental/supplementalData.xml": supplementalData(fixture),
    "cldr/common/main/en.xml": englishNames(fixture),
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(sourcesDir, path)), { recursive: true });
    await writeFile(join(sourcesDir, path), contents);
  }
  return sourcesDir;
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
