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
    .replace(/\s+/g, " ");
}

const ALIAS_MAP = new Map();
for (const dungeon of DUNGEONS) {
  ALIAS_MAP.set(clean(dungeon.name), dungeon.name);
  for (const alias of dungeon.aliases) ALIAS_MAP.set(clean(alias), dungeon.name);
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function canonicalizeDungeon(value) {
  const key = clean(value);
  if (!key) return "";
  return ALIAS_MAP.get(key) || titleCase(value);
}

function canonicalizeDifficulty(value) {
  const raw = clean(value);
  if (!raw) return "Nightmare";

  const hardcore = /\b(hc|hardcore)\b/.test(raw);
  const stripped = raw.replace(/\b(hc|hardcore)\b/g, "").replace(/\s+/g, " ").trim();
  const map = new Map([
    ["e", "Easy"], ["easy", "Easy"],
    ["m", "Medium"], ["med", "Medium"], ["medium", "Medium"],
    ["h", "Hard"], ["hard", "Hard"],
    ["ins", "Insane"], ["insane", "Insane"],
    ["nm", "Nightmare"], ["nightmare", "Nightmare"],
  ]);

  const base = map.get(stripped) || titleCase(stripped || raw);
  if (hardcore && !/hardcore/i.test(base)) return `${base} Hardcore`;
  return base;
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
