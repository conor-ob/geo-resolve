/** Trims, collapses internal whitespace, case-folds and strips diacritics, so `" Åland  Islands"` matches `"aland islands"`. */
export function normalise(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}
