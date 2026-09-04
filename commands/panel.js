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

const FOOTER = "The Carry Tavern • Server Hub";
const GOLD = 0xf2b705;

function channelMention(id, fallback = "Not configured") {
  return id ? `<#${id}>` : fallback;
}

function channelUrl(guild, channelId) {
  return guild?.id && channelId ? `https://discord.com/channels/${guild.id}/${channelId}` : null;
}

function addLink(row, { label, emoji, url }) {
  if (!url) return;
  row.addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Link)
      .setURL(url),
  );
}

function buildPanel({ guild = null, config = null } = {}) {
  const guildName = guild?.name || "Server";
  const request = channelMention(config?.request_channel_id, "Run `/setup`");
  const queue = channelMention(config?.queue_channel_id);
  const completed = channelMention(config?.completed_channel_id);
  const support = channelMention(config?.support_channel_id);
  const treasury = channelMention(config?.treasury_channel_id);
  const marketplace = channelMention(config?.marketplace_channel_id);

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🍺 ${guildName}`)
    .setDescription("Everything has its own place. Pick where you want to go — this hub stays simple on purpose.")
    .addFields(
      {
        name: "⚔️ Carries",
        value: `Request ${request}  •  Queue ${queue}  •  Completed ${completed}`,
        inline: false,
      },
      {
        name: "🧰 Services",
        value: `Support ${support}  •  Treasury ${treasury}  •  Marketplace ${marketplace}`,
        inline: false,
      },
    )
    .setFooter({ text: FOOTER });

  if (guild?.iconURL?.()) embed.setThumbnail(guild.iconURL({ size: 256 }));

  const destinations = new ActionRowBuilder();
  addLink(destinations, {
    label: "Request Carry",
    emoji: "⚔️",
    url: channelUrl(guild, config?.request_channel_id),
  });
  addLink(destinations, {
    label: "Live Queue",
    emoji: "📡",
    url: channelUrl(guild, config?.queue_channel_id),
  });
  addLink(destinations, {
    label: "Support",
    emoji: "🛟",
    url: channelUrl(guild, config?.support_channel_id),
  });
  addLink(destinations, {
    label: "Treasury",
    emoji: "🏦",
    url: channelUrl(guild, config?.treasury_channel_id),
  });

  const base = marketplaceBaseUrl();
  addLink(destinations, {
    label: "Marketplace",
    emoji: "💰",
    url: base || channelUrl(guild, config?.marketplace_channel_id),
  });

  const personal = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_my_carries")
      .setLabel("My Carries")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("carry_dropin_open")
      .setLabel("Join Live")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("tavern_help_open")
      .setLabel("Help")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),
  );

  const carrierUrl = channelUrl(guild, config?.carrier_desk_channel_id);
  if (carrierUrl) {
    personal.addComponents(
      new ButtonBuilder()
        .setLabel("Carrier Desk")
        .setEmoji("🍻")
        .setStyle(ButtonStyle.Link)
        .setURL(carrierUrl),
    );
  }

  const components = [];
  if (destinations.components.length) components.push(destinations);
  components.push(personal);
  return { embeds: [embed], components };
}

function isOperationsHub(message, botId) {
  return Boolean(
    message?.author?.id === botId
    && (message.embeds || []).some((embed) => {
      const footer = String(embed.footer?.text || "");
      return footer === FOOTER || footer.startsWith("The Carry Tavern • Operations Hub");
    }),
  );
}

async function publishOperationsHub(channel, { guild = channel?.guild || null, config = null } = {}) {
  if (!channel?.isTextBased?.()) throw new Error("The Server Hub needs a text channel.");
  const resolvedConfig = config || (guild ? getGuildConfig(guild.id) : null);
  const payload = buildPanel({ guild, config: resolvedConfig });
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((message) => isOperationsHub(message, channel.client.user.id)) || null;

  if (existing) {
    await existing.edit(payload);
    if (!existing.pinned) await existing.pin("Permanent Server Hub").catch(() => {});
    return existing;
  }

  const message = await channel.send(payload);
  await message.pin("Permanent Server Hub").catch(() => {});
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Publish or refresh the Server Hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  FOOTER,
  buildPanel,
  publishOperationsHub,

  async execute(interaction) {
    if (!interaction.channel?.isTextBased?.()) {
      return interaction.reply({
        content: "❌ Publish the Server Hub inside a text channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const message = await publishOperationsHub(interaction.channel, {
        guild: interaction.guild,
        config: interaction.guild ? getGuildConfig(interaction.guild.id) : null,
      });
      return interaction.reply({
        content: `✅ Server Hub refreshed: ${message.url}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.reply({
        content: `❌ ${error.message || "Could not publish the Server Hub."}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
