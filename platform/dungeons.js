const DUNGEONS = [
  { name: "Desert Temple", aliases: ["dt", "desert", "desert temple"] },
  { name: "Winter Outpost", aliases: ["wo", "winter", "winter outpost"] },
  { name: "Pirate Island", aliases: ["pi", "pirate", "pirate island"] },
  { name: "King's Castle", aliases: ["kc", "kings castle", "king castle", "king's castle"] },
  { name: "Underworld", aliases: ["uw", "underworld", "the underworld"] },
  { name: "Samurai Palace", aliases: ["sp", "samurai", "samurai palace"] },
  { name: "Canals", aliases: ["canal", "canals", "the canals"] },
  { name: "Ghastly Harbor", aliases: ["gh", "ghastly", "ghastly harbour", "ghastly harbor"] },
  { name: "Steampunk Sewers", aliases: ["ss", "steampunk", "steampunk sewer", "steampunk sewers"] },
  { name: "Orbital Outpost", aliases: ["oo", "orbital", "orbital outpost"] },
  { name: "Volcanic Chambers", aliases: ["vc", "volcanic", "volcanic chamber", "volcanic chambers"] },
  { name: "Aquatic Temple", aliases: ["at", "aquatic", "aquatic temple"] },
  { name: "Enchanted Forest", aliases: ["ef", "enchanted", "enchanted forest"] },
  { name: "Northern Lands", aliases: ["nl", "northern", "northern lands"] },
  { name: "Gilded Skies", aliases: ["gs", "gilded", "gilded skies"] },
  { name: "Yokai Peak", aliases: ["yp", "yokai", "yokai peak"] },
  { name: "Abyssal Void", aliases: ["av", "abyssal", "abyssal void", "abysmal void"] },
  { name: "Boss Raids", aliases: ["br", "boss raid", "boss raids"] },
];

function clean(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_MAP = new Map();
const ALIASES_LONGEST_FIRST = [];
for (const dungeon of DUNGEONS) {
  const names = [dungeon.name, ...dungeon.aliases];
  for (const alias of names) {
    const normalized = clean(alias);
    ALIAS_MAP.set(normalized, dungeon.name);
    ALIASES_LONGEST_FIRST.push({ alias: normalized, dungeon: dungeon.name });
  }
}
ALIASES_LONGEST_FIRST.sort((a, b) => b.alias.length - a.alias.length);

function titleCase(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Converts aliases and messy combined text into one canonical dungeon.
 * Examples:
 *   "AT" -> "Aquatic Temple"
 *   "AT Ins HC?" -> "Aquatic Temple"
 *   "need uw nm please" -> "Underworld"
 */
function canonicalizeDungeon(value) {
  const key = clean(value);
  if (!key) return "";

  const exact = ALIAS_MAP.get(key);
  if (exact) return exact;

  const padded = ` ${key} `;
  for (const entry of ALIASES_LONGEST_FIRST) {
    if (padded.includes(` ${entry.alias} `)) return entry.dungeon;
  }

  return titleCase(value);
}

/**
 * Carry grouping intentionally ignores Hardcore and any extra words/punctuation.
 * The queue groups only by the base difficulty so INS, INS HC, "Ins HC?", etc.
 * all become Insane, and NM/NM HC all become Nightmare.
 */
function canonicalizeDifficulty(value) {
  const raw = clean(value);
  if (!raw) return "Nightmare";

  const tokens = raw.split(" ").filter(Boolean);
  const has = (...values) => tokens.some((token) => values.includes(token));

  // Check Nightmare and Insane first because users often paste combined text such
  // as "AT Ins HC?" or add unrelated words after the actual difficulty.
  if (has("nm", "nightmare")) return "Nightmare";
  if (has("ins", "insane")) return "Insane";

  // Keep older/easier difficulties readable for legacy records, but Hardcore is
  // never part of the canonical queue key.
  if (has("easy", "e")) return "Easy";
  if (has("medium", "med", "m")) return "Medium";
  if (has("hard", "h")) return "Hard";

  const stripped = tokens
    .filter((token) => token !== "hc" && token !== "hardcore")
    .join(" ")
    .trim();
  return titleCase(stripped || raw);
}

function parseRuns(value) {
  const runs = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(runs) || runs < 1 || runs > 15) return null;
  return runs;
}

function groupKey(dungeon, difficulty) {
  return `${canonicalizeDungeon(dungeon)}\u0000${canonicalizeDifficulty(difficulty)}`;
}

function splitGroupKey(value) {
  const [dungeon = "", difficulty = ""] = String(value || "").split("\u0000");
  return { dungeon, difficulty };
}

module.exports = {
  DUNGEONS,
  canonicalizeDungeon,
  canonicalizeDifficulty,
  parseRuns,
  groupKey,
  splitGroupKey,
};
