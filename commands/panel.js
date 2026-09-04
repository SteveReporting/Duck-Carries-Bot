const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { marketplaceBaseUrl } = require("../platform/helpers");
const { getGuildConfig } = require("../platform/guildConfig");

const FOOTER = "The Carry Tavern • Operations Hub";
const GOLD = 0xf2b705;

function channelMention(id, fallback) {
  return id ? `<#${id}>` : fallback;
}

function buildPanel({ guild = null, config = null } = {}) {
  const queue = channelMention(config?.queue_channel_id, "Live Queue");
  const completed = channelMention(config?.completed_channel_id, "Completed Carries");
  const treasury = channelMention(config?.treasury_channel_id, "Treasury");
  const guildName = guild?.name || "The Carry Tavern";

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({
      name: "THE CARRY TAVERN",
      ...(guild?.iconURL?.() ? { iconURL: guild.iconURL({ size: 128 }) } : {}),
    })
    .setTitle("🍺 Tavern Hub")
    .setDescription([
      "**Request → Match → Ready → Carry → Complete**",
      "",
      "Everything complicated runs underneath. Pick what you need and the bot handles the workflow.",
    ].join("\n"))
    .addFields(
      {
        name: "⚔️ Carries",
        value: `${queue}\nGrouped matching • private tickets • automatic progress`,
        inline: true,
      },
      {
        name: "🔊 Voice",
        value: "Optional waiting room\nPrivate session VCs • live drop-ins",
        inline: true,
      },
      {
        name: "🛟 Support",
        value: "Private tickets\nStaff dashboard • status tracking",
        inline: true,
      },
      {
        name: "✅ Completion",
        value: `${completed}\nVerified runs • service time • cleanup`,
        inline: true,
      },
      {
        name: "🏦 Treasury",
        value: `${treasury}\nLive stock • loans • trust tools`,
        inline: true,
      },
      {
        name: "🧠 Tavern Pulse",
        value: "Queue health • stale-request rescue • self-repair",
        inline: true,
      },
    )
    .setFooter({ text: `${FOOTER} • ${guildName}` })
    .setTimestamp();

  const primary = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("carry_request_start_v4")
      .setLabel("Request Carry")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("premium_queue_open")
      .setLabel("Live Queue")
      .setEmoji("📡")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("premium_my_carries")
      .setLabel("My Carries")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("carry_dropin_open")
      .setLabel("Join Live")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("support_ticket_open")
      .setLabel("Support")
      .setEmoji("🛟")
      .setStyle(ButtonStyle.Secondary),
  );

  const secondary = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_carrier_desk")
      .setLabel("Carrier Desk")
      .setEmoji("🍻")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("carry_waiting_vc")
      .setLabel("Waiting Room")
      .setEmoji("⏳")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("tavern_ops_pulse")
      .setLabel("Tavern Pulse")
      .setEmoji("🧠")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("tavern_help_open")
      .setLabel("Help")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),
  );

  const base = marketplaceBaseUrl();
  if (base) {
    secondary.addComponents(
      new ButtonBuilder()
        .setLabel("Marketplace")
        .setEmoji("💰")
        .setStyle(ButtonStyle.Link)
        .setURL(base),
    );
  }

  return { embeds: [embed], components: [primary, secondary] };
}

function isOperationsHub(message, botId) {
  return Boolean(
    message?.author?.id === botId
    && (message.embeds || []).some((embed) => String(embed.footer?.text || "").startsWith(FOOTER)),
  );
}

async function publishOperationsHub(channel, { guild = channel?.guild || null, config = null } = {}) {
  if (!channel?.isTextBased?.()) throw new Error("The Tavern Hub needs a text channel.");
  const resolvedConfig = config || (guild ? getGuildConfig(guild.id) : null);
  const payload = buildPanel({ guild, config: resolvedConfig });
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((message) => isOperationsHub(message, channel.client.user.id)) || null;

  if (existing) {
    await existing.edit(payload);
    if (!existing.pinned) await existing.pin("Permanent Tavern Hub").catch(() => {});
    return existing;
  }

  const message = await channel.send(payload);
  await message.pin("Permanent Tavern Hub").catch(() => {});
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Publish or refresh the Tavern Hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  FOOTER,
  buildPanel,
  publishOperationsHub,

  async execute(interaction) {
    if (!interaction.channel?.isTextBased?.()) {
      return interaction.reply({
        content: "❌ Publish the Tavern Hub inside a text channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const message = await publishOperationsHub(interaction.channel, {
        guild: interaction.guild,
        config: interaction.guild ? getGuildConfig(interaction.guild.id) : null,
      });
      return interaction.reply({
        content: `✅ Tavern Hub refreshed: ${message.url}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.reply({
        content: `❌ ${error.message || "Could not publish the Tavern Hub."}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
