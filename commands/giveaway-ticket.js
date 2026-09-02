const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const DEFAULT_KEYWORD = "PURPLE COLLECT/T3";
const DEFAULT_RESULT_MESSAGES = 3;
const MAX_SCAN_PAGES = 10;

function normaliseChannelName(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
  return cleaned || "giveaway-winners";
}

function isGiveawayResult(message, keyword) {
  if (!message?.author?.bot) return false;

  const authorName = String(message.author.username || "").toLowerCase();
  const memberName = String(message.member?.displayName || "").toLowerCase();
  if (authorName !== "giveawaybot" && memberName !== "giveawaybot") return false;

  const content = String(message.content || "").toLowerCase();
  return content.includes(String(keyword).toLowerCase()) && message.mentions.users.size > 0;
}

async function findGiveawayMessages(channel, keyword, wanted) {
  const matches = [];
  let before;

  for (let page = 0; page < MAX_SCAN_PAGES && matches.length < wanted; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;

    for (const message of batch.values()) {
      if (isGiveawayResult(message, keyword)) matches.push(message);
      if (matches.length >= wanted) break;
    }

    before = batch.last()?.id;
    if (!before || batch.size < 100) break;
  }

  return matches.slice(0, wanted);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway-ticket")
    .setDescription("Create one private ticket for GiveawayBot winners")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) => option
      .setName("keyword")
      .setDescription(`Prize text to match (default: ${DEFAULT_KEYWORD})`)
      .setMaxLength(100))
    .addIntegerOption((option) => option
      .setName("results")
      .setDescription("How many matching GiveawayBot result messages to combine (default: 3)")
      .setMinValue(1)
      .setMaxValue(10))
    .addStringOption((option) => option
      .setName("name")
      .setDescription("Private ticket channel name")
      .setMaxLength(90)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: "❌ Manage Channels permission is required.", flags: MessageFlags.Ephemeral });
    }

    const sourceChannel = interaction.channel;
    if (!sourceChannel?.isTextBased?.() || !sourceChannel.messages?.fetch) {
      return interaction.reply({ content: "❌ Run this inside the channel containing the GiveawayBot result messages.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const keyword = interaction.options.getString("keyword")?.trim() || DEFAULT_KEYWORD;
      const wanted = interaction.options.getInteger("results") || DEFAULT_RESULT_MESSAGES;
      const channelName = normaliseChannelName(interaction.options.getString("name") || "purple-t3-winners");

      const resultMessages = await findGiveawayMessages(sourceChannel, keyword, wanted);
      if (resultMessages.length < wanted) {
        return interaction.editReply(
          `❌ I only found **${resultMessages.length}/${wanted}** GiveawayBot result messages containing **${keyword}** in the last ${MAX_SCAN_PAGES * 100} messages. No ticket was created.`,
        );
      }

      const winnerIds = [...new Set(
        resultMessages.flatMap((message) => [...message.mentions.users.keys()]),
      )];

      const presentWinnerIds = [];
      const missingWinnerIds = [];
      for (const userId of winnerIds) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (member) presentWinnerIds.push(userId);
        else missingWinnerIds.push(userId);
      }

      if (!presentWinnerIds.length) {
        return interaction.editReply("❌ None of the mentioned winners are currently in the server. No ticket was created.");
      }

      const me = interaction.guild.members.me;
      const permissionOverwrites = [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        ...presentWinnerIds.map((id) => ({
          id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        })),
      ];

      if (me && !presentWinnerIds.includes(me.id)) {
        permissionOverwrites.push({
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        });
      }

      const ticket = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: sourceChannel.parentId || undefined,
        topic: `Private GiveawayBot winner ticket • ${keyword} • ${presentWinnerIds.length} winner(s)`,
        permissionOverwrites,
        reason: `Giveaway winner ticket created by ${interaction.user.tag} (${interaction.user.id})`,
      });

      const mentions = presentWinnerIds.map((id) => `<@${id}>`).join(" ");
      await ticket.send({
        content: `🎉 **${keyword} winners**\n${mentions}\n\nThis channel is private to the winners listed above.`,
        allowedMentions: { users: presentWinnerIds },
      });

      const sourceLinks = resultMessages
        .map((message) => `https://discord.com/channels/${interaction.guildId}/${sourceChannel.id}/${message.id}`)
        .join("\n");

      const missingNote = missingWinnerIds.length
        ? `\n⚠️ **${missingWinnerIds.length}** mentioned winner(s) have left the server and could not be added.`
        : "";

      return interaction.editReply(
        `✅ Created ${ticket} with **${presentWinnerIds.length} unique winners only**.${missingNote}\n\nMatched result messages:\n${sourceLinks}`,
      );
    } catch (error) {
      console.error("[GIVEAWAY TICKET]", error);
      const message = error?.code === 30060
        ? "Discord's channel permission-overwrite limit was reached."
        : (error.message || "Giveaway ticket creation failed.");
      return interaction.editReply(`❌ ${message}`);
    }
  },
};
