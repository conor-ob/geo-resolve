import { dataPack } from "../data-pack.ts";
import type { Country } from "../types.ts";
import aliases from "./countries.aliases.json" with { type: "json" };
import countries from "./countries.json" with { type: "json" };

/** Every Country, sorted by `id`. */
export default dataPack(countries as readonly Country[], aliases);
