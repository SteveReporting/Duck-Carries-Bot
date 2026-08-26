const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} = require("discord.js");

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_stock_panels(
  guild TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  message TEXT NOT NULL
)
`).run();

let timer = null;

function baseComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("treasury_stock_legendary")
        .setLabel("Legendaries")
        .setEmoji("⚔️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("treasury_stock_collect")
        .setLabel("Collects")
        .setEmoji("🏆")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function baseEmbed() {
  return new EmbedBuilder()
    .setTitle("🏦 Treasury Stock")
    .setDescription([
      "Browse what is currently available in **The Carry Tavern Treasury**.",
      "",
      "**⚔️ Legendaries**  |  **🏆 Collects**",
      "",
      "Select a section below. Collects will then let you choose a colour.",
      "This is **Treasury inventory**, not player Marketplace listings.",
    ].join("\n"))
    .setFooter({ text: "The Carry Tavern • Live Treasury Stock" })
    .setTimestamp();
}

async function fetchStock(category, color = null) {
  const supabase = getSupabase();
  let query = supabase
    .from("treasury_items")
    .select("id,item_name,quantity_total,quantity_available,value_tier,image_url,stock_category,collect_color")
    .eq("active", true)
    .gt("quantity_available", 0)
    .eq("stock_category", category)
    .order("item_name");

  if (category === "collect" && color) query = query.eq("collect_color", color);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function stockLines(items) {
  if (!items.length) return "*Nothing is currently in stock in this section.*";
  const lines = items.map((item) => `• **${item.item_name}**  ·  ${item.quantity_available}/${item.quantity_total} available`);
  let output = "";
  for (const line of lines) {
    if ((output + "\n" + line).length > 3600) break;
    output += `${output ? "\n" : ""}${line}`;
  }
  if (output.split("\n").length < lines.length) output += `\n\n*+ ${lines.length - output.split("\n").length} more item(s)*`;
  return output;
}

async function collectColorComponents(prefetchedItems = null) {
  const items = prefetchedItems || await fetchStock("collect");
  const colors = [...new Set(items.map((item) => String(item.collect_color || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 25);

  if (!colors.length) return [];
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("treasury_stock_color")
        .setPlaceholder("Select Collect colour")
        .addOptions(colors.map((color) => ({ label: color, value: color, emoji: "🏆" }))),
    ),
  ];
}

async function ensureTreasuryStockPanel(client) {
  const channelId = process.env.TREASURY_STOCK_CHANNEL_ID;
  const guildId = process.env.GUILD_ID;
  if (!channelId || !guildId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[TREASURY STOCK] Channel ${channelId} is missing or not text based.`);
    return;
  }

  const saved = db.prepare("SELECT * FROM treasury_stock_panels WHERE guild = ?").get(guildId);
  let message = null;
  if (saved?.channel === channelId && saved.message && channel.messages?.fetch) {
    message = await channel.messages.fetch(saved.message).catch(() => null);
  }

  const payload = { embeds: [baseEmbed()], components: baseComponents() };
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    db.prepare(`
      INSERT INTO treasury_stock_panels(guild, channel, message)
      VALUES(?, ?, ?)
      ON CONFLICT(guild) DO UPDATE SET channel=excluded.channel, message=excluded.message
    `).run(guildId, channelId, message.id);
  }
}

async function ensureEphemeralDeferred(interaction) {
  if (interaction.__carryFastAckPromise) {
    await interaction.__carryFastAckPromise;
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

async function handleTreasuryStockInteraction(interaction) {
  if (!interaction.guild) return false;

  if (interaction.isButton() && interaction.customId === "treasury_stock_legendary") {
    await ensureEphemeralDeferred(interaction);
    const items = await fetchStock("legendary");
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("⚔️ Treasury Legendaries")
        .setDescription(stockLines(items))
        .setFooter({ text: `${items.length} Legendary item${items.length === 1 ? "" : "s"} currently available` })
        .setTimestamp()],
    });
    return true;
  }

  if (interaction.isButton() && interaction.customId === "treasury_stock_collect") {
    await ensureEphemeralDeferred(interaction);
    const items = await fetchStock("collect");
    const components = await collectColorComponents(items);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("🏆 Treasury Collects")
        .setDescription(items.length ? "Select a **Collect colour** below to see the stock in that section." : "*No Collects are currently in stock.*")
        .setFooter({ text: "Treasury stock is separate from Marketplace listings" })
        .setTimestamp()],
      components,
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "treasury_stock_color") {
    await interaction.deferUpdate();
    const color = interaction.values[0];
    const items = await fetchStock("collect", color);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle(`🏆 ${color} Collects`)
        .setDescription(stockLines(items))
        .setFooter({ text: `${items.length} item${items.length === 1 ? "" : "s"} currently available` })
        .setTimestamp()],
      components: await collectColorComponents(),
    });
    return true;
  }

  return false;
}

function startTreasuryStockPanel(client) {
  if (timer || !process.env.TREASURY_STOCK_CHANNEL_ID) return;
  void ensureTreasuryStockPanel(client).catch((error) => console.error("[TREASURY STOCK]", error));
  timer = setInterval(() => {
    void ensureTreasuryStockPanel(client).catch((error) => console.error("[TREASURY STOCK]", error));
  }, 5 * 60_000);
  timer.unref?.();
}

module.exports = {
  ensureTreasuryStockPanel,
  handleTreasuryStockInteraction,
  startTreasuryStockPanel,
};
