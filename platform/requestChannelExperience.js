const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { getGuildConfig, saveGuildConfig } = require("./guildConfig");

const REQUEST_CHANNEL_NAME = "⚔️・request-a-carry";
const REQUEST_PANEL_FOOTER = "The Carry Tavern • Request Only";
const OLD_REQUEST_FOOTERS = new Set([
  "The Carry Tavern • Request Carry",
  "The Carry Tavern • Request Only",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function botOverwrites(guild, botId) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.SendMessages],
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
}

async function configuredRequestChannel(guild, config) {
  if (!config?.request_channel_id) return null;
  const configured = guild.channels.cache.get(String(config.request_channel_id))
    || await guild.channels.fetch(String(config.request_channel_id)).catch(() => null);
  return configured?.type === ChannelType.GuildText ? configured : null;
}

function preferredExistingRequestChannel(guild) {
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && normalize(channel.name) === "requestacarry",
  ) || null;
}

async function resolveRequestChannel(guild, config) {
  // Prefer the already-clean request-a-carry channel so re-running /setup never
  // replaces its channel ID just because an older installer briefly recreated
  // a legacy request-carry channel before this finalizer runs.
  const preferred = preferredExistingRequestChannel(guild);
  if (preferred) return preferred;

  const configured = await configuredRequestChannel(guild, config);
  if (configured) return configured;

  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText
    && ["requestcarry", "requestacarry"].includes(normalize(channel.name)),
  ) || null;
}

async function resolveCarriesCategory(guild, config) {
  const request = await resolveRequestChannel(guild, config);
  if (request?.parent?.type === ChannelType.GuildCategory) return request.parent;

  if (config?.queue_channel_id) {
    const queue = guild.channels.cache.get(String(config.queue_channel_id))
      || await guild.channels.fetch(String(config.queue_channel_id)).catch(() => null);
    if (queue?.parent?.type === ChannelType.GuildCategory) return queue.parent;
  }

  let category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === "carries",
  ) || null;

  if (!category) {
    category = await guild.channels.create({
      name: "⚔️・CARRIES",
      type: ChannelType.GuildCategory,
      reason: "Dedicated Tavern carry request area",
    });
  }
  return category;
}

async function repairRequestChannel(channel, guild, category) {
  if (channel.name !== REQUEST_CHANNEL_NAME) {
    await channel.setName(REQUEST_CHANNEL_NAME, "Make carry requesting a dedicated one-purpose channel");
  }
  if (category && channel.parentId !== category.id) {
    await channel.setParent(category.id, {
      lockPermissions: false,
      reason: "Move carry requesting into the Carry area",
    });
  }
  const topic = "Request a carry here. One button, one guided flow — queue browsing and Carrier tools live elsewhere.";
  if (channel.topic !== topic) await channel.setTopic(topic, "Simplify carry requesting").catch(() => {});

  for (const overwrite of botOverwrites(guild, guild.client.user.id)) {
    const permissions = {};
    for (const permission of overwrite.allow || []) permissions[permission] = true;
    for (const permission of overwrite.deny || []) permissions[permission] = false;
    await channel.permissionOverwrites.edit(overwrite.id, permissions, {
      reason: "Keep the Request Carry channel clean and read-only",
    }).catch(() => {});
  }
}

function isOldRequestPanel(message, botId) {
  if (message?.author?.id !== botId) return false;
  return (message.embeds || []).some((embed) => {
    const footer = String(embed.footer?.text || "");
    const title = String(embed.title || "").toLowerCase();
    return OLD_REQUEST_FOOTERS.has(footer)
      || title.includes("request a carry")
      || title.includes("request carry");
  });
}

async function clearOldRequestPanels(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;
  for (const message of messages.values()) {
    if (!isOldRequestPanel(message, channel.client.user.id)) continue;
    await message.delete().catch(() => {});
  }
}

async function channelContainsOnlyBotContent(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return false;
  return messages.every((message) =>
    message.author?.id === channel.client.user.id || message.system,
  );
}

async function removeDisposableLegacyDuplicate(guild, keepChannel, config) {
  const configured = await configuredRequestChannel(guild, config);
  if (!configured || configured.id === keepChannel.id) return;
  if (normalize(configured.name) !== "requestcarry") return;
  if (!await channelContainsOnlyBotContent(configured)) return;
  await configured.delete("Remove duplicate legacy request-carry channel after request-only migration").catch(() => {});
}

function requestPanelPayload(guild) {
  const icon = guild.iconURL({ size: 256 });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("⚔️ Request a Carry")
    .setDescription([
      "**Need a carry? Start here.**",
      "",
      "Choose your **dungeon**, **difficulty** and **number of runs**. That's it — matching, queueing, the private carry room and progress tracking are automatic.",
      "",
      "**Press the button below to begin.**",
    ].join("\n"))
    .setFooter({ text: REQUEST_PANEL_FOOTER });

  if (icon) embed.setThumbnail(icon);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("carry_request_start_v4")
          .setLabel("Request a Carry")
          .setEmoji("⚔️")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

async function publishRequestOnlyPanel(channel) {
  await clearOldRequestPanels(channel);
  const message = await channel.send(requestPanelPayload(channel.guild));
  await message.pin("Permanent Request Carry panel").catch(() => {});
  return message;
}

async function ensureRequestOnlyExperience(guild) {
  await guild.channels.fetch();
  let config = getGuildConfig(guild.id);
  const category = await resolveCarriesCategory(guild, config);
  let channel = await resolveRequestChannel(guild, config);
  let created = false;

  if (!channel) {
    channel = await guild.channels.create({
      name: REQUEST_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: "Request a carry here. One button, one guided flow — queue browsing and Carrier tools live elsewhere.",
      permissionOverwrites: botOverwrites(guild, guild.client.user.id),
      reason: "Dedicated Tavern carry request channel",
    });
    created = true;
  }

  await removeDisposableLegacyDuplicate(guild, channel, config);
  await repairRequestChannel(channel, guild, category);
  config = saveGuildConfig(guild.id, { request_channel_id: channel.id });
  const panel = await publishRequestOnlyPanel(channel);

  return { channel, panel, config, created };
}

module.exports = {
  REQUEST_CHANNEL_NAME,
  REQUEST_PANEL_FOOTER,
  ensureRequestOnlyExperience,
  publishRequestOnlyPanel,
  requestPanelPayload,
};
