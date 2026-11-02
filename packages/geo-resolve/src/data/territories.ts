import { dataPack } from "../data-pack.ts";
import type { Territory } from "../types.ts";
import aliases from "./territories.aliases.json" with { type: "json" };
import territories from "./territories.json" with { type: "json" };

/** Every Territory admitted under ADR-0012, sorted by `id`. */
export default dataPack(territories as readonly Territory[], aliases);
