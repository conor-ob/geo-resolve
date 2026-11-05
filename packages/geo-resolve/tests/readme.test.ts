import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

// Runs every `ts` code block in the README against the package, so an example can't drift from what it does.
// A statement ending in `// => <value>` checks that the statement's value equals `<value>`, a JavaScript literal.
// Prose may follow the literal after `: ` (`// => null: the Country GE and …`). The value may instead start on the
// next line as `// => …` and continue over the `//` lines after it, for an Entity too long for one line.

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

interface Block {
  /** The README line the block's code starts on. */
  readonly line: number;
  readonly code: string[];
}

function tsBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  markdown.split("\n").forEach((text, index) => {
    if (current === undefined && text === "```ts") {
      current = { line: index + 2, code: [] };
    } else if (current !== undefined && text === "```") {
      blocks.push(current);
      current = undefined;
    } else {
      current?.code.push(text);
    }
  });
  return blocks;
}

/** Evaluates a JavaScript literal, such as `null`, `["GE", "US-GA"]` or `{ fifa: "NIR" }`. */
function literal(source: string): unknown {
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluating the README's own literals is the point
  return new Function(`return (${source});`)();
}

/** The literal at the start of an annotation, before any `: ` prose that follows it. */
function expectedValue(annotation: string, line: number): unknown {
  const ends = [annotation.length];
  for (let i = annotation.indexOf(": "); i !== -1; i = annotation.indexOf(": ", i + 1))
    ends.push(i);
  for (const end of ends.toSorted((a, b) => a - b)) {
    try {
      return literal(annotation.slice(0, end));
    } catch {
      // Not a literal up to here: the `: ` was inside it, or the literal is longer.
    }
  }
  throw new Error(
    `README line ${line}: "// => ${annotation}" doesn't start with a JavaScript literal`,
  );
}

/** The imports a block binds, as `[specifier, names]`, where a default import is bound under `default`. */
type Imports = [specifier: string, bindings: [imported: string, local: string][]][];

const IMPORT = /^import (?:(\w+)|\{ ([^}]+) \}) from "([^"]+)";$/;
const ANNOTATED = /^(.*);\s*\/\/ => (.*)$/;
const STATEMENT = /^(\S.*);$/;
const ANNOTATION_START = /^\/\/ => (.*)$/;
const ANNOTATION_MORE = /^\/\/\s+(.*)$/;

/** Splits a block into its imports and a function body in which each annotated statement calls `__check`. */
function compile(block: Block): { imports: Imports; body: string; checks: number } {
  const imports: Imports = [];
  const body: string[] = [];
  let checks = 0;
  const check = (line: number, expression: string, annotation: string) => {
    checks++;
    const expected = JSON.stringify(expectedValue(annotation, line));
    body.push(`__check(${line}, ${JSON.stringify(expression)}, (${expression}), ${expected});`);
  };
  for (let i = 0; i < block.code.length; i++) {
    const text = block.code[i]!;
    const line = block.line + i;
    const imported = IMPORT.exec(text);
    const annotated = ANNOTATED.exec(text);
    const statement = STATEMENT.exec(text);
    const next = ANNOTATION_START.exec(block.code[i + 1] ?? "");
    if (imported !== null) {
      const [, defaultName, named, specifier] = imported;
      const bindings: [string, string][] = defaultName
        ? [["default", defaultName]]
        : named!.split(",").map((name): [string, string] => {
            const [importedName, local = importedName] = name.trim().split(/\s+as\s+/);
            return [importedName!, local!];
          });
      imports.push([specifier!, bindings]);
    } else if (annotated !== null) {
      check(line, annotated[1]!, annotated[2]!);
    } else if (statement !== null && next !== null) {
      const annotation = [next[1]!];
      i++;
      while (ANNOTATION_MORE.test(block.code[i + 1] ?? "")) {
        annotation.push(ANNOTATION_MORE.exec(block.code[++i]!)![1]!);
      }
      check(line, statement[1]!, annotation.join(" "));
    } else {
      body.push(text);
    }
  }
  return { imports, body: body.join("\n"), checks };
}

const AsyncFunction = (async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>;

const blocks = tsBlocks(readme);

test("every `// =>` annotation in the README becomes a check", () => {
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    const annotations = block.code.filter((text) => text.includes("// =>")).length;
    expect(compile(block).checks, `README block at line ${block.line}`).toBe(annotations);
  }
});

test.each(blocks.map((block) => [block.line, block] as const))(
  "the README example at line %i does what its comments say",
  async (_, block) => {
    const { imports, body, checks } = compile(block);
    const names: string[] = [];
    const values: unknown[] = [];
    for (const [specifier, bindings] of imports) {
      const module = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
      for (const [importedName, local] of bindings) {
        expect(module, `${specifier} exports ${importedName}`).toHaveProperty(importedName);
        names.push(local);
        values.push(module[importedName]);
      }
    }
    let ran = 0;
    const check = (line: number, expression: string, actual: unknown, expected: unknown) => {
      ran++;
      expect(actual, `README line ${line}: ${expression}`).toEqual(expected);
    };
    await new AsyncFunction("__check", ...names, body)(check, ...values);
    // An annotation inside a branch that isn't taken would otherwise pass unchecked.
    expect(ran, "annotations checked").toBe(checks);
  },
);
