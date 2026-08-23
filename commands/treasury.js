const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");

const TREASURY_ACCOUNT = "CarryTester1";
const REPORTED_LEGENDARY_TOTAL = 225;
const PANEL_TIMEOUT = 15 * 60 * 1000;

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

const DUNGEON_ORDER = [
  "Desert Temple",
  "Winter Outpost",
  "Pirate Island",
  "King's Castle",
  "Underworld",
  "Samurai Palace",
  "The Canals",
  "Ghastly Harbor",
  "Steampunk Sewers",
  "Boss Raids",
  "Orbital Outpost",
  "Volcanic Chambers",
  "Aquatic Temple",
  "Enchanted Forest",
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

function chunk(items, size) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages.length ? pages : [[]];
}

function kindIcon(kind) {
  if (kind === "mage") return "✨";
  if (kind === "hybrid") return "🔥";
  return "⚔️";
}

function stockBadge(quantity) {
  if (quantity <= 0) return "🔴";
  if (quantity <= 2) return "🟠";
  if (quantity <= 5) return "🟡";
  return "🟢";
}

function groupLegendaries() {
  const groups = new Map();
  for (const item of LEGENDARIES) {
    if (!groups.has(item.dungeon)) groups.set(item.dungeon, []);
    groups.get(item.dungeon).push(item);
  }

  return DUNGEON_ORDER
    .filter((dungeon) => groups.has(dungeon))
    .map((dungeon) => ({ dungeon, items: groups.get(dungeon) }));
}

function groupCollects(items) {
  const groups = new Map();
  for (const item of items) {
    const color = String(item.collect_color || "Other").trim() || "Other";
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(item);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([color, entries]) => ({
      color,
      items: entries.sort((a, b) => String(a.item_name).localeCompare(String(b.item_name))),
    }));
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

function renderOverview(state) {
  const tracked = LEGENDARIES.reduce((sum, item) => sum + item.quantity, 0);
  const typesInStock = LEGENDARIES.filter((item) => item.quantity > 0).length;
  const urgent = LEGENDARIES.filter((item) => item.situation === "Urgent restock").length;
  const collectUnits = state.collects.reduce((sum, item) => sum + availableQuantity(item), 0);

  return {
    totalPages: 1,
    embed: new EmbedBuilder()
      .setColor(0xc89532)
      .setAuthor({
        name: "The Carry Tavern • Treasury",
        iconURL: state.botAvatar,
      })
      .setTitle("🏦 Treasury Stock")
      .setDescription([
        `Stock held on **${TREASURY_ACCOUNT}**`,
        "Use the buttons below to browse without filling the channel with huge embeds.",
      ].join("\n"))
      .addFields(
        {
          name: "⚔️ Legendary Vault",
          value: `**${REPORTED_LEGENDARY_TOTAL}** reported\n**${tracked}** tracked • **${typesInStock}** types in stock`,
          inline: true,
        },
        {
          name: "🏆 Collect Vault",
          value: state.collectError
            ? "⚠️ Live stock unavailable"
            : `**${collectUnits}** units\n**${state.collects.length}** items available`,
          inline: true,
        },
        {
          name: "🚨 Restock Watch",
          value: `**${urgent}** urgent\n${LEGENDARIES.filter((item) => item.quantity <= 2).length} low-stock entries`,
          inline: true,
        },
      )
      .setFooter({ text: "Choose a section below • Refresh updates live Collect stock" })
      .setTimestamp(),
  };
}

function renderLegendaries(page) {
  const groups = groupLegendaries();
  const pages = chunk(groups, 4);
  const safePage = Math.min(Math.max(page, 0), pages.length - 1);
  const pageGroups = pages[safePage];

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("⚔️ Legendary Vault")
    .setDescription("Clean stock view by dungeon. Quantity is shown on the right.");

  for (const group of pageGroups) {
    const value = group.items
      .map((item) => `${kindIcon(item.kind)} **${item.itemName}**  ${stockBadge(item.quantity)} **${item.quantity}**`)
      .join("\n");

    embed.addFields({
      name: `▸ ${group.dungeon}`,
      value,
      inline: false,
    });
  }

  embed.setFooter({
    text: `Page ${safePage + 1}/${pages.length} • ⚔️ Warrior  ✨ Mage  🔥 Hybrid • 🟢 healthy  🟡 low  🟠 critical  🔴 empty`,
  });

  return { embed, totalPages: pages.length, page: safePage };
}

function renderCollects(state, page) {
  if (state.collectError) {
    return {
      totalPages: 1,
      page: 0,
      embed: new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🏆 Collect Vault")
        .setDescription(`⚠️ Live Collect stock could not be loaded.\n\n\`${String(state.collectError).slice(0, 700)}\``)
        .setFooter({ text: "Press Refresh to try again" }),
    };
  }

  if (!state.collects.length) {
    return {
      totalPages: 1,
      page: 0,
      embed: new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle("🏆 Collect Vault")
        .setDescription("No Collect stock is currently published in the live Treasury database.")
        .setFooter({ text: "Press Refresh to check again" }),
    };
  }

  const groups = groupCollects(state.collects);
  const pages = chunk(groups, 4);
  const safePage = Math.min(Math.max(page, 0), pages.length - 1);
  const pageGroups = pages[safePage];

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🏆 Collect Vault")
    .setDescription("Live stock grouped by colour.");

  for (const group of pageGroups) {
    const value = group.items
      .map((item) => {
        const available = availableQuantity(item);
        const total = totalQuantity(item);
        const quantity = total > available ? `${available}/${total}` : `${available}`;
        return `• **${item.item_name}**  📦 **${quantity}**`;
      })
      .join("\n");

    embed.addFields({
      name: `▸ ${group.color}`,
      value: value.slice(0, 1024) || "None",
      inline: false,
    });
  }

  embed.setFooter({ text: `Page ${safePage + 1}/${pages.length} • Live Treasury database` });
  return { embed, totalPages: pages.length, page: safePage };
}

function renderRestocks() {
  const urgent = LEGENDARIES.filter((item) => item.situation === "Urgent restock");
  const low = LEGENDARIES
    .filter((item) => item.situation !== "Urgent restock" && item.quantity <= 2)
    .sort((a, b) => a.quantity - b.quantity);

  const embed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("🚨 Restock Watch")
    .setDescription("Only stock that actually needs attention is shown here.");

  embed.addFields({
    name: "🔴 Urgent",
    value: urgent.length
      ? urgent
          .map((item) => `${kindIcon(item.kind)} **${item.itemName}** • ${item.dungeon}\n   Stock **${item.quantity}** • Demand **${item.demand}**`)
          .join("\n\n")
      : "Nothing urgent right now.",
    inline: false,
  });

  embed.addFields({
    name: "🟠 Low Stock",
    value: low.length
      ? low
          .map((item) => `${kindIcon(item.kind)} **${item.itemName}** • **${item.quantity}** left`)
          .join("\n")
      : "No other low-stock items.",
    inline: false,
  });

  embed.setFooter({ text: "Demand and status are kept here instead of cluttering every stock page" });
  return { embed, totalPages: 1, page: 0 };
}

function renderPanel(state) {
  if (state.view === "legendaries") return renderLegendaries(state.page);
  if (state.view === "collects") return renderCollects(state, state.page);
  if (state.view === "restocks") return renderRestocks();
  return renderOverview(state);
}

function navButton(id, label, emoji, currentView, targetView) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(currentView === targetView ? ButtonStyle.Primary : ButtonStyle.Secondary);
}

function buildRows(state, totalPages, disabled = false) {
  const main = new ActionRowBuilder().addComponents(
    navButton("treasury_overview", "Overview", "🏦", state.view, "overview").setDisabled(disabled),
    navButton("treasury_legendaries", "Legendaries", "⚔️", state.view, "legendaries").setDisabled(disabled),
    navButton("treasury_collects", "Collects", "🏆", state.view, "collects").setDisabled(disabled),
    navButton("treasury_restocks", "Restocks", "🚨", state.view, "restocks").setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("treasury_refresh")
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );

  const rows = [main];

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("treasury_prev")
          .setLabel("Previous")
          .setEmoji("◀️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || state.page <= 0),
        new ButtonBuilder()
          .setCustomId("treasury_next")
          .setLabel("Next")
          .setEmoji("▶️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || state.page >= totalPages - 1),
      ),
    );
  }

  return rows;
}

async function refreshCollectState(state) {
  const result = await loadCollectStock();
  state.collects = result.items;
  state.collectError = result.error;
}

async function stockCommand(interaction) {
  await interaction.deferReply();

  const state = {
    view: "overview",
    page: 0,
    collects: [],
    collectError: null,
    botAvatar: interaction.client.user.displayAvatarURL(),
  };

  await refreshCollectState(state);

  let rendered = renderPanel(state);
  const message = await interaction.editReply({
    embeds: [rendered.embed],
    components: buildRows(state, rendered.totalPages),
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PANEL_TIMEOUT,
  });

  collector.on("collect", async (buttonInteraction) => {
    if (buttonInteraction.user.id !== interaction.user.id) {
      return buttonInteraction.reply({
        content: "Use `/treasury stock` to open your own Treasury panel.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => null);
    }

    try {
      if (buttonInteraction.customId === "treasury_overview") {
        state.view = "overview";
        state.page = 0;
      } else if (buttonInteraction.customId === "treasury_legendaries") {
        state.view = "legendaries";
        state.page = 0;
      } else if (buttonInteraction.customId === "treasury_collects") {
        state.view = "collects";
        state.page = 0;
      } else if (buttonInteraction.customId === "treasury_restocks") {
        state.view = "restocks";
        state.page = 0;
      } else if (buttonInteraction.customId === "treasury_prev") {
        state.page = Math.max(0, state.page - 1);
      } else if (buttonInteraction.customId === "treasury_next") {
        state.page += 1;
      } else if (buttonInteraction.customId === "treasury_refresh") {
        await buttonInteraction.deferUpdate();
        await refreshCollectState(state);
        state.page = 0;
        rendered = renderPanel(state);
        return interaction.editReply({
          embeds: [rendered.embed],
          components: buildRows(state, rendered.totalPages),
        });
      }

      rendered = renderPanel(state);
      state.page = rendered.page ?? state.page;

      return buttonInteraction.update({
        embeds: [rendered.embed],
        components: buildRows(state, rendered.totalPages),
      });
    } catch (error) {
      console.error("[TREASURY STOCK PANEL]", error);
      if (!buttonInteraction.deferred && !buttonInteraction.replied) {
        await buttonInteraction.reply({
          content: "❌ Could not update the Treasury panel.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
    }
  });

  collector.on("end", async () => {
    rendered = renderPanel(state);
    await interaction.editReply({
      embeds: [rendered.embed],
      components: buildRows(state, rendered.totalPages, true),
    }).catch(() => null);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("treasury")
    .setDescription("Browse The Carry Tavern Treasury")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("stock")
        .setDescription("Open the interactive Treasury stock panel"),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "stock") {
      try {
        return await stockCommand(interaction);
      } catch (error) {
        console.error("[TREASURY STOCK COMMAND]", error);
        const message = `❌ ${error.message || "Could not load Treasury stock."}`;
        if (interaction.deferred || interaction.replied) return interaction.editReply({ content: message, embeds: [], components: [] });
        return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    }
  },
};
