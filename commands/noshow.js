const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile } = require("../platform/helpers");
const { maybeSendAbuseAlert, noShowSummary, recordNoShow } = require("../platform/communitySystems");

const MIN_WAIT_MS = 15 * 60 * 1000;

async function reportCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) return interaction.editReply("❌ Link your Tavern account first.");

  const requestId = interaction.options.getString("request", true).trim();
  const reason = interaction.options.getString("reason")?.trim() || "No-show after the carry was claimed.";
  const supabase = getSupabase();
  const { data: request, error } = await supabase.from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,status,claimed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(discord_id),carrier:profiles!carry_requests_carrier_id_fkey(discord_id)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!request || !["claimed", "in_progress"].includes(request.status)) return interaction.editReply("❌ That carry is not currently claimed or in progress.");

  if (!request.claimed_at || Date.now() - new Date(request.claimed_at).getTime() < MIN_WAIT_MS) {
    const left = Math.max(1, Math.ceil((MIN_WAIT_MS - Math.max(0, Date.now() - new Date(request.claimed_at || Date.now()).getTime())) / 60000));
    return interaction.editReply(`⏳ Give the other person a reasonable chance to respond first. You can file a no-show for this claim in about **${left} minute(s)**.`);
  }

  let offenderDiscordId;
  let side;
  if (profile.id === request.requester_id) {
    offenderDiscordId = request.carrier?.discord_id;
    side = "carrier";
  } else if (profile.id === request.carrier_id) {
    offenderDiscordId = request.requester?.discord_id;
    side = "requester";
  } else {
    return interaction.editReply("❌ Only the requester or assigned Carrier can file a no-show for this carry.");
  }
  if (!offenderDiscordId) return interaction.editReply("❌ I could not resolve the other participant's Discord account.");

  recordNoShow({
    guildId: interaction.guildId,
    requestId: request.id,
    offenderId: offenderDiscordId,
    reporterId: interaction.user.id,
    offenderSide: side,
    reason,
  });
  await maybeSendAbuseAlert(interaction.client, interaction.guildId, offenderDiscordId, `carry no-show ${request.id}`).catch(() => {});

  if (process.env.MOD_LOG_CHANNEL_ID) {
    const channel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send([
        "🚫 **Carry No-Show Recorded**",
        `Request: \`${request.id}\``,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Reporter: <@${interaction.user.id}>`,
        `No-show: <@${offenderDiscordId}> (${side})`,
        `Reason: ${reason}`,
      ].join("\n")).catch(() => {});
    }
  }

  return interaction.editReply(`✅ No-show recorded for <@${offenderDiscordId}>. Staff anti-abuse history has been updated.`);
}

async function summaryCommand(interaction) {
  const target = interaction.options.getUser("user") || interaction.user;
  const summary = noShowSummary(interaction.guildId, target.id, 30);
  const embed = new EmbedBuilder()
    .setTitle(`🚫 No-Show Record • ${target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: "Total (30d)", value: String(summary.total), inline: true },
      { name: "As Requester", value: String(summary.requester), inline: true },
      { name: "As Carrier", value: String(summary.carrier), inline: true },
    )
    .setFooter({ text: "No-show reports are staff safety signals, not automatic punishment." });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("noshow")
    .setDescription("Carry no-show and reliability tools")
    .addSubcommand((s) => s.setName("report").setDescription("Report the other side for not showing up to a claimed carry")
      .addStringOption((o) => o.setName("request").setDescription("Carry request UUID").setRequired(true).setMinLength(36).setMaxLength(36))
      .addStringOption((o) => o.setName("reason").setDescription("Optional details").setMaxLength(500)))
    .addSubcommand((s) => s.setName("summary").setDescription("View a member's 30-day no-show count")
      .addUserOption((o) => o.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      return interaction.options.getSubcommand() === "report" ? reportCommand(interaction) : summaryCommand(interaction);
    } catch (error) {
      console.error("[NOSHOW]", error);
      const text = `❌ ${error.message || "No-show command failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(text);
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
