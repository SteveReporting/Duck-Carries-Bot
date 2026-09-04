const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { verifiedServiceBoard } = require("../platform/carryServiceTime");

const SERVICE_TIME_RESET_AT = Date.parse("2026-08-31T03:11:31+01:00");
const GOLD = 0xf2b705;
const MEDALS = ["🥇", "🥈", "🥉"];

function sinceFor(timeframe) {
  const now = Date.now();
  if (timeframe === "day") return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (timeframe === "week") return new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (timeframe === "month") return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function sinceMsFor(timeframe) {
  const iso = sinceFor(timeframe);
  return iso ? new Date(iso).getTime() : 0;
}

function serviceSinceMs(timeframe) {
  return Math.max(SERVICE_TIME_RESET_AT, sinceMsFor(timeframe));
}

function timeframeLabel(value) {
  return {
    day: "Last 24 Hours",
    week: "Last 7 Days",
    month: "Last 30 Days",
    all: "All Time",
  }[value] || "All Time";
}

function metricLabel(value) {
  return {
    runs: "Runs Completed",
    carries: "Carry Requests",
    service: "Verified Service Time",
    rating: "Carrier Rating",
  }[value] || "Verified Service Time";
}

function formatTime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds || 0)) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function rankPrefix(index) {
  return MEDALS[index] || `**#${index + 1}**`;
}

async function activityBoard(timeframe, metric) {
  const supabase = getSupabase();
  let query = supabase
    .from("carry_activity")
    .select("carrier_id,runs,service_minutes,completed_at")
    .order("completed_at", { ascending: false })
    .limit(5000);

  const since = sinceFor(timeframe);
  if (since) query = query.gte("completed_at", since);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const scores = new Map();
  for (const row of data || []) {
    const current = scores.get(row.carrier_id) || { carrierId: row.carrier_id, runs: 0, carries: 0 };
    current.runs += Number(row.runs || 0);
    current.carries += 1;
    scores.set(row.carrier_id, current);
  }

  const rows = [...scores.values()].sort((a, b) => b[metric] - a[metric]).slice(0, 10);
  if (!rows.length) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,discord_id,discord_username,discord_display_name,roblox_username")
    .in("id", rows.map((row) => row.carrierId));

  if (profileError) throw new Error(profileError.message);
  const map = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return rows.map((row) => ({ ...row, profile: map.get(row.carrierId) || null }));
}

function ratingBoard(guildId, timeframe) {
  const since = sinceMsFor(timeframe);
  return db.prepare(`
    SELECT carrier,COUNT(*) AS ratings,ROUND(AVG(score),2) AS average,
      SUM(CASE WHEN score=5 THEN 1 ELSE 0 END) AS five_star
    FROM carrier_ratings
    WHERE guild=? AND created_at>=?
    GROUP BY carrier
    HAVING COUNT(*) >= 1
    ORDER BY average DESC,ratings DESC,five_star DESC
    LIMIT 10
  `).all(String(guildId), since);
}

function legacyFallback() {
  return db.prepare("SELECT user,completed FROM stats ORDER BY completed DESC LIMIT 10").all();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the Tavern Carrier leaderboard")
    .addStringOption((option) => option
      .setName("timeframe")
      .setDescription("Leaderboard period")
      .addChoices(
        { name: "Today / 24h", value: "day" },
        { name: "Weekly / 7d", value: "week" },
        { name: "Monthly / 30d", value: "month" },
        { name: "All time", value: "all" },
      ))
    .addStringOption((option) => option
      .setName("metric")
      .setDescription("What to rank")
      .addChoices(
        { name: "Verified service time", value: "service" },
        { name: "Runs completed", value: "runs" },
        { name: "Carry requests completed", value: "carries" },
        { name: "Carrier rating", value: "rating" },
      )),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      const timeframe = interaction.options.getString("timeframe") || "week";
      const metric = interaction.options.getString("metric") || "service";
      let lines = [];

      if (metric === "rating") {
        const rows = ratingBoard(interaction.guildId, timeframe);
        lines = rows.map((row, index) =>
          `${rankPrefix(index)} <@${row.carrier}>\n> ⭐ **${row.average}/5** • ${row.ratings} rating${row.ratings === 1 ? "" : "s"} • ${row.five_star} five-star`,
        );
      } else if (metric === "service") {
        const rows = verifiedServiceBoard(interaction.guildId, serviceSinceMs(timeframe), 10);
        lines = rows.map((row, index) =>
          `${rankPrefix(index)} <@${row.carrier}>\n> ⏱️ **${formatTime(row.service_seconds)}** • ${row.sessions} verified session${Number(row.sessions) === 1 ? "" : "s"} • ${row.runs_completed} run${Number(row.runs_completed) === 1 ? "" : "s"}`,
        );
      } else {
        const rows = await activityBoard(timeframe, metric);
        lines = rows.map((row, index) => {
          const who = row.profile?.discord_id
            ? `<@${row.profile.discord_id}>`
            : row.profile?.roblox_username
              ? `@${row.profile.roblox_username}`
              : "Unknown Carrier";
          const value = metric === "carries" ? `${row.carries} carries` : `${row.runs} runs`;
          return `${rankPrefix(index)} ${who}\n> ⚔️ **${value}**`;
        });
      }

      if (!lines.length && timeframe === "all" && (metric === "runs" || metric === "carries")) {
        lines = legacyFallback().map((row, index) => `${rankPrefix(index)} <@${row.user}>\n> ⚔️ **${row.completed} legacy carries**`);
      }

      const embed = new EmbedBuilder()
        .setColor(GOLD)
        .setAuthor({ name: "THE CARRY TAVERN • CARRIER RANKINGS" })
        .setTitle("🏆 Carrier Leaderboard")
        .setDescription(lines.length ? lines.join("\n\n") : "No Carrier activity has been recorded for this period yet.")
        .addFields(
          { name: "📅 Period", value: `**${timeframeLabel(timeframe)}**`, inline: true },
          { name: "📊 Metric", value: `**${metricLabel(metric)}**`, inline: true },
          { name: "✅ Integrity", value: metric === "service" ? "Verified time only" : "Recorded completions", inline: true },
        )
        .setFooter({
          text: metric === "service"
            ? "The Carry Tavern • grouped requesters never multiply verified service time"
            : "The Carry Tavern • verified service time remains the primary Carrier metric",
        })
        .setTimestamp();

      return interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("premium_queue_open")
              .setLabel("Live Queue")
              .setEmoji("⚔️")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId("premium_carrier_desk")
              .setLabel("Carrier Desk")
              .setEmoji("🍻")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    } catch (error) {
      console.error("[LEADERBOARD]", error);
      return interaction.editReply(`❌ ${error.message || "Could not load the Carrier leaderboard."}`);
    }
  },
};
