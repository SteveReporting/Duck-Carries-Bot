const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");

const MAX_DESCRIPTION = 3900;
const MAX_FIELD = 1000;

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

function itemLine(item) {
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
    output += `\n\n*+ ${lines.length - used} more item${lines.length - used === 1 ? "" : "s"} in stock*`;
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
    .map(([color, entries]) => {
      const lines = entries
        .sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)))
        .map(itemLine);

      return {
        name: `🏆 ${color} Collects`,
        value: clipLines(lines, MAX_FIELD),
        inline: false,
      };
    });
}

async function loadTreasuryStock() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("treasury_items")
    .select("id,item_name,quantity_total,quantity_available,value_tier,image_url,stock_category,collect_color,active")
    .eq("active", true)
    .order("stock_category")
    .order("collect_color")
    .order("item_name");

  if (error) throw new Error(`Could not load Treasury stock: ${error.message}`);
  return data || [];
}

async function stockCommand(interaction) {
  await interaction.deferReply();

  const allItems = await loadTreasuryStock();
  const inStock = allItems.filter((item) => availableQuantity(item) > 0);
  const legendaries = inStock.filter((item) => String(item.stock_category).toLowerCase() === "legendary");
  const collects = inStock.filter((item) => String(item.stock_category).toLowerCase() === "collect");
  const other = inStock.filter((item) => !["legendary", "collect"].includes(String(item.stock_category).toLowerCase()));

  const totalUnits = inStock.reduce((sum, item) => sum + availableQuantity(item), 0);
  const legendaryUnits = legendaries.reduce((sum, item) => sum + availableQuantity(item), 0);
  const collectUnits = collects.reduce((sum, item) => sum + availableQuantity(item), 0);

  const overview = new EmbedBuilder()
    .setTitle("🏦 The Carry Tavern Treasury Stock")
    .setDescription([
      "Live Treasury inventory pulled from the same **Treasury stock database** used by the website.",
      "Only items with stock currently available are included below.",
    ].join("\n"))
    .addFields(
      { name: "📦 Available Units", value: `**${totalUnits.toLocaleString()}**`, inline: true },
      { name: "🧾 Items In Stock", value: `**${inStock.length.toLocaleString()}**`, inline: true },
      { name: "⚔️ Legendaries", value: `**${legendaryUnits.toLocaleString()}** units · ${legendaries.length} item${legendaries.length === 1 ? "" : "s"}`, inline: true },
      { name: "🏆 Collects", value: `**${collectUnits.toLocaleString()}** units · ${collects.length} item${collects.length === 1 ? "" : "s"}`, inline: true },
    )
    .setFooter({ text: "The Carry Tavern • Live Treasury Stock" })
    .setTimestamp();

  const embeds = [overview];

  if (legendaries.length) {
    embeds.push(
      new EmbedBuilder()
        .setTitle("⚔️ Legendary Stock")
        .setDescription(clipLines(
          legendaries
            .sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)))
            .map(itemLine),
        ))
        .setFooter({ text: `${legendaryUnits.toLocaleString()} Legendary unit${legendaryUnits === 1 ? "" : "s"} available` }),
    );
  }

  if (collects.length) {
    const collectEmbed = new EmbedBuilder()
      .setTitle("🏆 Collect Stock")
      .setDescription("Collects are grouped by colour, matching the Treasury stock layout.")
      .setFooter({ text: `${collectUnits.toLocaleString()} Collect unit${collectUnits === 1 ? "" : "s"} available` });

    const fields = colorFields(collects);
    if (fields.length) collectEmbed.addFields(fields);
    embeds.push(collectEmbed);
  }

  if (other.length && embeds.length < 10) {
    embeds.push(
      new EmbedBuilder()
        .setTitle("📦 Other Treasury Stock")
        .setDescription(clipLines(other.map(itemLine))),
    );
  }

  if (!inStock.length) {
    overview.setDescription([
      "The Treasury database currently reports **no available stock**.",
      "",
      `Active Treasury records found: **${allItems.length}**.`,
      "If the website is showing stock at the same time, that means the website and bot are pointed at different Supabase projects/credentials rather than this command inventing a zero value.",
    ].join("\n"));
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
        .setDescription("Show the live Treasury stock from the website inventory"),
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
