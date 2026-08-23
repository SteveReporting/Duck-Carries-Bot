const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");

const MAX_DESCRIPTION = 3900;
const MAX_FIELD = 1000;
const TREASURY_ACCOUNT = "CarryTester1";
const REPORTED_LEGENDARY_TOTAL = 225;

// Keep this snapshot aligned with the public TreasuryStockBrowser on the website.
// The website currently uses this snapshot for Legendaries and Supabase for Collects.
const LEGENDARIES = [
  { label: "Desert Fury", dungeon: "Desert Temple", itemName: "Desert Fury", quantity: 4, demand: "None", situation: "Perfect", kind: "hybrid" },
  { label: "WO", dungeon: "Winter Outpost", itemName: "Crystalized Greatsword", quantity: 12, demand: "Very low", situation: "Perfect", kind: "hybrid" },
  { label: "PI Mage", dungeon: "Pirate Island", itemName: "Staff of the Gods", quantity: 17, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "PI War", dungeon: "Pirate Island", itemName: "Soulstealer Greatsword", quantity: 20, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "War Scythe", dungeon: "King's Castle", itemName: "Beastmaster War Scythe", quantity: 18, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage Scythe", dungeon: "King's Castle", itemName: "Beastmaster Spell Scythe", quantity: 18, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War UW", dungeon: "Underworld", itemName: "Dual Phoenix Daggers", quantity: 3, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage UW", dungeon: "Underworld", itemName: "Phoenix Greatstaff", quantity: 11, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War SP", dungeon: "Samurai Palace", itemName: "Sakura Katana", quantity: 13, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage SP", dungeon: "Samurai Palace", itemName: "Sakura Greatstaff", quantity: 14, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War Canals", dungeon: "The Canals", itemName: "Overlord's Rageblade", quantity: 20, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage Canals", dungeon: "The Canals", itemName: "Overlord's Manablade", quantity: 25, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War GH", dungeon: "Ghastly Harbor", itemName: "Kraken Slayer", quantity: 2, demand: "Low", situation: "Great", kind: "warrior" },
  { label: "Mage GH", dungeon: "Ghastly Harbor", itemName: "Sea Serpent's Wings", quantity: 2, demand: "Low", situation: "Great", kind: "mage" },
  { label: "War SS", dungeon: "Steampunk Sewers", itemName: "Inventor's Greatsword", quantity: 1, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage SS", dungeon: "Steampunk Sewers", itemName: "Inventor's Spellblade", quantity: 2, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War BR", dungeon: "Boss Raids", itemName: "Boss Raid Warrior Legendary", quantity: 3, demand: "Very low", situation: "Perfect", kind: "warrior" },
  { label: "Mage BR", dungeon: "Boss Raids", itemName: "Boss Raid Mage Legendary", quantity: 4, demand: "Very low", situation: "Perfect", kind: "mage" },
  { label: "War OO", dungeon: "Orbital Outpost", itemName: "Galactic Dual Blades", quantity: 2, demand: "Low", situation: "Great", kind: "warrior" },
  { label: "Mage OO", dungeon: "Orbital Outpost", itemName: "Galactic Pike", quantity: 1, demand: "Low", situation: "Great", kind: "mage" },
  { label: "War VC", dungeon: "Volcanic Chambers", itemName: "Lava King's Warscythe", quantity: 10, demand: "Moderate", situation: "Perfect", kind: "warrior" },
  { label: "Mage VC", dungeon: "Volcanic Chambers", itemName: "Lava King's Spell Daggers", quantity: 5, demand: "Moderate", situation: "Great", kind: "mage" },
  { label: "War AT", dungeon: "Aquatic Temple", itemName: "Sea King's Trident", quantity: 1, demand: "Very HIGH", situation: "Urgent restock", kind: "warrior" },
  { label: "Mage AT", dungeon: "Aquatic Temple", itemName: "Sea King's Greatstaff", quantity: 1, demand: "Very HIGH", situation: "Urgent restock", kind: "mage" },
  { label: "War EF", dungeon: "Enchanted Forest", itemName: "Eldenbark Greatsword", quantity: 0, demand: "Very HIGH", situation: "Urgent restock", kind: "warrior" },
  { label: "Mage EF", dungeon: "Enchanted Forest", itemName: "Eldenbark Greatstaff", quantity: 1, demand: "Very HIGH", situation: "Urgent restock", kind: "mage" },
];

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function availableQuantity(item) {
  return numberValue(item.quantity_available);
}

function totalQuantity(item) {
  return Math.max(availableQuantity(item), numberValue(item.quantity_total));
}

function collectLine(item) {
  const available = availableQuantity(item);
  const total = totalQuantity(item);
  const tier = String(item.value_tier || "").trim();
  const qty = total > available
    ? `**${available}/${total}** available`
    : `**${available}** available`;
  return `• **${item.item_name}**${tier ? ` · ${tier}` : ""}\n  ${qty}`;
}

function clipLines(lines, limit = MAX_DESCRIPTION) {
  if (!lines.length) return "*Nothing is currently in stock.*";

  let output = "";
  let used = 0;
  for (const line of lines) {
    const next = `${output ? "\n" : ""}${line}`;
    if ((output + next).length > limit) break;
    output += next;
    used += 1;
  }

  if (used < lines.length) {
    output += `\n\n*+ ${lines.length - used} more item${lines.length - used === 1 ? "" : "s"}*`;
  }
  return output;
}

function colorFields(items) {
  const groups = new Map();
  for (const item of items) {
    const color = String(item.collect_color || "Other").trim() || "Other";
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(item);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 25)
    .map(([color, entries]) => ({
      name: `🏆 ${color} Collects`,
      value: clipLines(
        entries
          .sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)))
          .map(collectLine),
        MAX_FIELD,
      ),
      inline: false,
    }));
}

function kindIcon(kind) {
  if (kind === "mage") return "✨";
  if (kind === "hybrid") return "🔥";
  return "⚔️";
}

function statusIcon(item) {
  if (item.situation === "Urgent restock") return "🚨";
  if (item.situation === "Great") return "🔹";
  return "✅";
}

function legendaryLine(item) {
  return `${kindIcon(item.kind)} **${item.itemName}** · ${item.dungeon}\n` +
    `   **${item.quantity}** in stock · Demand: **${item.demand}** · ${statusIcon(item)} ${item.situation}`;
}

async function loadCollectStock() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("treasury_items")
      .select("id,item_name,quantity_total,quantity_available,value_tier,image_url,stock_category,collect_color,active")
      .eq("active", true)
      .gt("quantity_available", 0)
      .order("collect_color")
      .order("item_name");

    if (error) throw new Error(error.message);
    return {
      items: (data || []).filter((item) =>
        String(item.stock_category || "").toLowerCase() === "collect" || Boolean(item.collect_color),
      ),
      error: null,
    };
  } catch (error) {
    console.warn("[TREASURY STOCK] Collect stock unavailable:", error.message);
    return { items: [], error: error.message };
  }
}

async function stockCommand(interaction) {
  await interaction.deferReply();

  const { items: collects, error: collectError } = await loadCollectStock();
  const trackedLegendaryUnits = LEGENDARIES.reduce((sum, item) => sum + item.quantity, 0);
  const unclassifiedLegendaryUnits = Math.max(0, REPORTED_LEGENDARY_TOTAL - trackedLegendaryUnits);
  const legendaryItemsInStock = LEGENDARIES.filter((item) => item.quantity > 0).length;
  const urgentRestocks = LEGENDARIES.filter((item) => item.situation === "Urgent restock").length;
  const collectUnits = collects.reduce((sum, item) => sum + availableQuantity(item), 0);

  const overview = new EmbedBuilder()
    .setTitle("🏦 The Carry Tavern Treasury Stock")
    .setDescription([
      `**Treasury account:** \`${TREASURY_ACCOUNT}\``,
      "Legendary stock mirrors the same snapshot shown on the website. Collect stock is loaded live from the Treasury database.",
    ].join("\n"))
    .addFields(
      { name: "⚔️ Reported Legendaries", value: `**${REPORTED_LEGENDARY_TOTAL.toLocaleString()}**`, inline: true },
      { name: "📋 Tracked Legendary Stock", value: `**${trackedLegendaryUnits.toLocaleString()}**`, inline: true },
      { name: "📦 Legendary Entries", value: `**${legendaryItemsInStock}** in stock`, inline: true },
      { name: "🚨 Urgent Restocks", value: `**${urgentRestocks}**`, inline: true },
      { name: "🏆 Live Collect Stock", value: `**${collectUnits.toLocaleString()}** units · ${collects.length} item${collects.length === 1 ? "" : "s"}`, inline: true },
      { name: "🧾 Other / Unclassified", value: `**${unclassifiedLegendaryUnits.toLocaleString()}** legendary units`, inline: true },
    )
    .setFooter({ text: "The Carry Tavern • Website-matched Treasury stock" })
    .setTimestamp();

  const legendaryLines = LEGENDARIES.map(legendaryLine);
  const midpoint = Math.ceil(legendaryLines.length / 2);

  const embeds = [
    overview,
    new EmbedBuilder()
      .setTitle("⚔️ Legendary Stock · Part 1")
      .setDescription(clipLines(legendaryLines.slice(0, midpoint)))
      .setFooter({ text: "⚔️ Warrior · ✨ Mage · 🔥 Hybrid" }),
    new EmbedBuilder()
      .setTitle("⚔️ Legendary Stock · Part 2")
      .setDescription(clipLines(legendaryLines.slice(midpoint)))
      .setFooter({ text: "🚨 Urgent restock items are still shown even when quantity is 0" }),
  ];

  if (collects.length) {
    const collectEmbed = new EmbedBuilder()
      .setTitle("🏆 Live Collect Stock")
      .setDescription("Collects are grouped by colour, matching the website's live Treasury database view.")
      .setFooter({ text: `${collectUnits.toLocaleString()} Collect unit${collectUnits === 1 ? "" : "s"} currently available` });

    const fields = colorFields(collects);
    if (fields.length) collectEmbed.addFields(fields);
    embeds.push(collectEmbed);
  } else {
    embeds.push(
      new EmbedBuilder()
        .setTitle("🏆 Live Collect Stock")
        .setDescription(collectError
          ? `Collect stock could not be loaded right now: \`${String(collectError).slice(0, 500)}\``
          : "No Collect rows are currently published in the live Treasury database. This does **not** affect the Legendary snapshot above."),
    );
  }

  return interaction.editReply({ embeds: embeds.slice(0, 10) });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("treasury")
    .setDescription("Browse The Carry Tavern Treasury")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("stock")
        .setDescription("Show the same Treasury stock displayed on the website"),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "stock") {
      try {
        return await stockCommand(interaction);
      } catch (error) {
        console.error("[TREASURY STOCK COMMAND]", error);
        const message = `❌ ${error.message || "Could not load Treasury stock."}`;
        if (interaction.deferred || interaction.replied) return interaction.editReply(message);
        return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
