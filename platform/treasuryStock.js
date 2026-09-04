const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getGuildConfig, listConfiguredGuilds } = require("./guildConfig");
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

const timers = new Map();
const GOLD = 0xf2b705;
const BLUE = 0x5865f2;

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

function baseEmbed(guild = null) {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({
      name: "THE CARRY TAVERN • TREASURY",
      ...(guild?.iconURL?.() ? { iconURL: guild.iconURL({ size: 128 }) } : {}),
    })
    .setTitle("🏦 Live Treasury Stock")
    .setDescription("Pick a section below. Availability is read live from Treasury inventory — staff never need to rewrite this panel.")
    .addFields(
      { name: "⚔️ Legendaries", value: "Weapons and legendary stock", inline: true },
      { name: "🏆 Collects", value: "Browse by Collect colour", inline: true },
      { name: "🔄 Inventory", value: "Live + self-refreshing", inline: true },
    )
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
        .setPlaceholder("Choose a Collect colour")
        .addOptions(colors.map((color) => ({ label: color, value: color, emoji: "🏆" }))),
    ),
  ];
}

async function resolveTarget(client, guildOverride = null, channelOverride = null) {
  let guild = guildOverride?.id ? guildOverride : null;
  if (!guild) {
    const guildId = String(process.env.GUILD_ID || "").trim();
    if (!guildId) return { guild: null, channel: null };
    guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  }
  if (!guild) return { guild: null, channel: null };

  let channel = channelOverride?.isTextBased?.() ? channelOverride : null;
  if (!channel) {
    const config = getGuildConfig(guild.id);
    const channelId = config?.treasury_channel_id
      || (String(process.env.GUILD_ID || "") === String(guild.id) ? process.env.TREASURY_STOCK_CHANNEL_ID : null);
    if (channelId) channel = await guild.channels.fetch(channelId).catch(() => null);
  }

  return { guild, channel: channel?.isTextBased?.() ? channel : null };
}

async function ensureTreasuryStockPanel(client, guildOverride = null, channelOverride = null) {
  const { guild, channel } = await resolveTarget(client, guildOverride, channelOverride);
  if (!guild || !channel) return null;

  const saved = db.prepare("SELECT * FROM treasury_stock_panels WHERE guild = ?").get(guild.id);
  let message = null;
  if (saved?.channel === channel.id && saved.message && channel.messages?.fetch) {
    message = await channel.messages.fetch(saved.message).catch(() => null);
  }

  const payload = { embeds: [baseEmbed(guild)], components: baseComponents() };
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    db.prepare(`
      INSERT INTO treasury_stock_panels(guild, channel, message)
      VALUES(?, ?, ?)
      ON CONFLICT(guild) DO UPDATE SET channel=excluded.channel, message=excluded.message
    `).run(guild.id, channel.id, message.id);
  }

  if (!message.pinned) await message.pin("Permanent Tavern Treasury stock panel").catch(() => {});
  return message;
}

async function ensureEphemeralDeferred(interaction) {
  if (interaction.__carryFastAckPromise) await interaction.__carryFastAckPromise;
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
        .setColor(BLUE)
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
        .setColor(GOLD)
        .setTitle("🏆 Treasury Collects")
        .setDescription(items.length ? "Choose a **Collect colour** below to see live stock." : "*No Collects are currently in stock.*")
        .setFooter({ text: "Treasury inventory • live" })
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
        .setColor(GOLD)
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

function startGuildTreasuryTimer(client, guild) {
  if (!guild?.id || timers.has(guild.id)) return;
  void ensureTreasuryStockPanel(client, guild).catch((error) => console.error(`[TREASURY STOCK] ${guild.name}:`, error));
  const timer = setInterval(() => {
    void ensureTreasuryStockPanel(client, guild).catch((error) => console.error(`[TREASURY STOCK] ${guild.name}:`, error));
  }, 5 * 60_000);
  timer.unref?.();
  timers.set(guild.id, timer);
}

function startTreasuryStockPanel(client) {
  for (const config of listConfiguredGuilds()) {
    const guild = client.guilds.cache.get(String(config.guild));
    if (guild && config.treasury_channel_id) startGuildTreasuryTimer(client, guild);
  }
}

module.exports = {
  baseEmbed,
  ensureTreasuryStockPanel,
  handleTreasuryStockInteraction,
  startGuildTreasuryTimer,
  startTreasuryStockPanel,
};
