const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const {
  displayName,
  formatServiceMinutes,
  marketplaceBaseUrl,
  requireLinkedProfile,
} = require("../platform/helpers");
const roblox = require("./roblox");

const GOLD = 0xf2b705;
const GREEN = 0x2ecc71;
const FOOTER = "The Carry Tavern • Tavern Account";

function profileActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_my_carries")
      .setLabel("My Carries")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("tavern_help_open")
      .setLabel("Help Center")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function profileCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const supabase = getSupabase();
  const [{ data: fullProfile }, { data: roles }, { data: carrier }, { data: achievements }] = await Promise.all([
    supabase
      .from("profiles")
      .select("roblox_username,roblox_display_name,roblox_verified_at,roblox_community_member,roblox_community_role")
      .eq("id", profile.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", profile.id),
    supabase
      .from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes")
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase
      .from("user_achievements")
      .select("achievement:achievements(name,icon)")
      .eq("user_id", profile.id)
      .limit(8),
  ]);

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • MEMBER PROFILE" })
    .setTitle(`🍺 ${displayName(profile)}`)
    .setDescription("Your Tavern identity across carries, trading, Roblox and community systems.")
    .addFields(
      { name: "⚔️ Carries", value: `**${profile.total_carries ?? 0}**`, inline: true },
      { name: "⏱️ Service", value: `**${formatServiceMinutes(profile.total_service_minutes ?? 0)}**`, inline: true },
      { name: "💰 Trades", value: `**${profile.completed_trades ?? 0}**`, inline: true },
      { name: "⭐ Trust", value: `**${profile.trust_score ?? 100}**`, inline: true },
      { name: "🎮 DQ Level", value: profile.dq_level == null ? "Not set" : `**${profile.dq_level}**`, inline: true },
      { name: "🛡️ Trader", value: profile.verified_trader ? "✅ Verified" : "Standard", inline: true },
      {
        name: "🏷️ Tavern Roles",
        value: roles?.length ? roles.map((role) => `\`${role.role}\``).join(" ") : "`member`",
        inline: false,
      },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (fullProfile?.roblox_username) {
    embed.addFields({
      name: "🟥 Roblox Identity",
      value: [
        `**${fullProfile.roblox_display_name || fullProfile.roblox_username}** (@${fullProfile.roblox_username})`,
        fullProfile.roblox_community_member
          ? `✅ Carry Tavern community${fullProfile.roblox_community_role ? ` • ${fullProfile.roblox_community_role}` : ""}`
          : "Not marked as a Tavern community member",
      ].join("\n"),
      inline: false,
    });
  }

  if (carrier) {
    embed.addFields({
      name: "🍻 Carrier Record",
      value: `**${carrier.carrier_rank}** • ${carrier.completed_carries} carries • ${formatServiceMinutes(carrier.service_minutes)} verified service`,
      inline: false,
    });
  }

  if (achievements?.length) {
    embed.addFields({
      name: "🏅 Achievements",
      value: achievements
        .map((entry) => `${entry.achievement?.icon ?? "🏅"} ${entry.achievement?.name ?? "Achievement"}`)
        .join("\n")
        .slice(0, 1024),
      inline: false,
    });
  }

  if (base) embed.setURL(`${base}/profile/${profile.id}`);
  return interaction.editReply({ embeds: [embed], components: [profileActions()] });
}

async function statusCommand(interaction) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_status")
    .select("service,status,message,last_heartbeat_at")
    .order("service");

  if (error) throw new Error(error.message);

  const now = Date.now();
  const records = (data || []).map((row) => {
    let status = row.status;
    if (
      row.service === "discord_bot" &&
      (!row.last_heartbeat_at || now - new Date(row.last_heartbeat_at).getTime() > 180_000)
    ) {
      status = "outage";
    }

    const icon = status === "operational"
      ? "🟢"
      : status === "maintenance"
        ? "🟡"
        : status === "degraded"
          ? "🟠"
          : status === "outage"
            ? "🔴"
            : "⚪";

    return { ...row, status, icon };
  });

  const operational = records.filter((row) => row.status === "operational").length;
  const healthy = records.length > 0 && operational === records.length;
  const base = marketplaceBaseUrl();

  const embed = new EmbedBuilder()
    .setColor(healthy ? GREEN : GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • SYSTEM STATUS" })
    .setTitle(healthy ? "🟢 All Systems Operational" : "⚙️ Platform Status")
    .setDescription(
      records.length
        ? records
            .map((row) => `${row.icon} **${row.service.replaceAll("_", " ")}** • ${row.status}${row.message ? `\n> ${row.message}` : ""}`)
            .join("\n\n")
        : "No platform status records are available.",
    )
    .addFields({
      name: "Health",
      value: records.length ? `**${operational}/${records.length}** services operational` : "No telemetry",
      inline: true,
    })
    .setFooter({ text: "The Carry Tavern • live service telemetry" })
    .setTimestamp();

  if (base) embed.setURL(`${base}/status`);
  return interaction.reply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tavern")
    .setDescription("Tavern account, Roblox identity and platform status")
    .addSubcommand((subcommand) => subcommand.setName("profile").setDescription("Open your Tavern profile"))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("View live Tavern platform status"))
    .addSubcommand((subcommand) => subcommand.setName("roblox-sync").setDescription("Sync your Roblox identity from Bloxlink"))
    .addSubcommand((subcommand) => subcommand
      .setName("roblox-profile")
      .setDescription("View a member’s Roblox + Tavern profile")
      .addUserOption((option) => option.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "profile") return await profileCommand(interaction);
      if (subcommand === "status") return await statusCommand(interaction);
      if (subcommand === "roblox-sync") return await roblox.syncCommand(interaction);
      return await roblox.profileCommand(interaction);
    } catch (error) {
      console.error("[TAVERN]", error);
      const text = `❌ ${error.message || "Tavern request failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: text, embeds: [], components: [] });
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
