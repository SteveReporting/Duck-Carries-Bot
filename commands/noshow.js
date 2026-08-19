const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile } = require("../platform/helpers");
const {
  maybeSendAbuseAlert,
  noShowSummary,
  recordNoShow,
} = require("../platform/communitySystems");

const MIN_WAIT_MS = 15 * 60 * 1000;

async function fetchRequestById(requestId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,status,claimed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(discord_id),carrier:profiles!carry_requests_carrier_id_fkey(discord_id)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function resolveRequest(interaction, profile) {
  const supplied = interaction.options.getString("request")?.trim();
  if (supplied) return fetchRequestById(supplied);

  if (!interaction.channelId) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,status,claimed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(discord_id),carrier:profiles!carry_requests_carrier_id_fkey(discord_id)")
    .eq("ticket_channel_id", String(interaction.channelId))
    .in("status", ["claimed", "in_progress"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const relevant = (data || []).filter(
    (request) => request.requester_id === profile.id || request.carrier_id === profile.id,
  );

  if (relevant.length === 1) return relevant[0];
  if (relevant.length > 1) {
    throw new Error(
      "This ticket contains multiple active requests. Press the **Report No-Show** button under the correct requester, or provide that request UUID.",
    );
  }

  return null;
}

async function reportCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) return interaction.editReply("❌ Link your Tavern account first.");

  const request = await resolveRequest(interaction, profile);
  if (!request || !["claimed", "in_progress"].includes(request.status)) {
    return interaction.editReply(
      "❌ I could not find an active carry request. Run this inside its carry ticket, use the ticket's **Report No-Show** button, or provide the request UUID.",
    );
  }

  const reason = interaction.options.getString("reason")?.trim() || "No-show after the carry was claimed.";

  if (!request.claimed_at || Date.now() - new Date(request.claimed_at).getTime() < MIN_WAIT_MS) {
    const elapsed = Math.max(0, Date.now() - new Date(request.claimed_at || Date.now()).getTime());
    const left = Math.max(1, Math.ceil((MIN_WAIT_MS - elapsed) / 60000));
    return interaction.editReply(
      `⏳ Give the other person a reasonable chance to respond first. You can file a no-show for this claim in about **${left} minute(s)**.`,
    );
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

  if (!offenderDiscordId) {
    return interaction.editReply("❌ I could not resolve the other participant's Discord account.");
  }

  recordNoShow({
    guildId: interaction.guildId,
    requestId: request.id,
    offenderId: offenderDiscordId,
    reporterId: interaction.user.id,
    offenderSide: side,
    reason,
  });
  await maybeSendAbuseAlert(
    interaction.client,
    interaction.guildId,
    offenderDiscordId,
    `carry no-show ${request.id}`,
  ).catch(() => {});

  if (process.env.MOD_LOG_CHANNEL_ID) {
    const channel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send([
        "🚫 **Carry No-Show Recorded**",
        `Request: \`${request.id}\``,
        request.ticket_channel_id ? `Ticket: <#${request.ticket_channel_id}>` : null,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Reporter: <@${interaction.user.id}>`,
        `No-show: <@${offenderDiscordId}> (${side})`,
        `Reason: ${reason}`,
      ].filter(Boolean).join("\n")).catch(() => {});
    }
  }

  return interaction.editReply(
    `✅ No-show recorded for <@${offenderDiscordId}> on request \`${request.id}\`. Staff anti-abuse history has been updated.`,
  );
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
    .addSubcommand((s) => s
      .setName("report")
      .setDescription("Report the other side for not showing up to a claimed carry")
      .addStringOption((o) => o
        .setName("request")
        .setDescription("Carry request UUID; optional inside a carry ticket")
        .setRequired(false)
        .setMinLength(36)
        .setMaxLength(36))
      .addStringOption((o) => o
        .setName("reason")
        .setDescription("Optional details")
        .setMaxLength(500)))
    .addSubcommand((s) => s
      .setName("summary")
      .setDescription("View a member's 30-day no-show count")
      .addUserOption((o) => o.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      return interaction.options.getSubcommand() === "report"
        ? reportCommand(interaction)
        : summaryCommand(interaction);
    } catch (error) {
      console.error("[NOSHOW]", error);
      const text = `❌ ${error.message || "No-show command failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(text);
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
