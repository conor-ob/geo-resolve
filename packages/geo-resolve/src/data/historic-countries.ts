import { dataPack } from "../data-pack.ts";
import type { HistoricCountry } from "../types.ts";
import aliases from "./historic-countries.aliases.json" with { type: "json" };
import historicCountries from "./historic-countries.json" with { type: "json" };

/** Every Historic country in ISO 3166-3, sorted by `id`. */
export default dataPack(historicCountries as readonly HistoricCountry[], aliases);
