const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { verifiedServiceBoard } = require("../platform/carryServiceTime");

// Leaderboard season reset. Historical records are preserved, but anything
// before this timestamp no longer contributes to any leaderboard metric.
const LEADERBOARD_RESET_AT = Date.parse("2026-08-24T03:53:00+01:00");

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

function leaderboardSinceMs(timeframe) {
  return Math.max(LEADERBOARD_RESET_AT, sinceMsFor(timeframe));
}

function leaderboardSinceIso(timeframe) {
  return new Date(leaderboardSinceMs(timeframe)).toISOString();
}

function timeframeLabel(value) {
  return { day: "Last 24 Hours", week: "Last 7 Days", month: "Last 30 Days", all: "All Time" }[value] || "All Time";
}

function metricLabel(value) {
  return { runs: "Runs Completed", carries: "Carry Requests", service: "Verified Service Time", rating: "Carrier Rating" }[value] || "Verified Service Time";
}

function formatTime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds || 0)) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

async function activityBoard(timeframe, metric) {
  const supabase = getSupabase();
  let query = supabase.from("carry_activity")
    .select("carrier_id,runs,service_minutes,completed_at")
    .order("completed_at", { ascending: false })
    .limit(5000)
    .gte("completed_at", leaderboardSinceIso(timeframe));
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

  const { data: profiles, error: profileError } = await supabase.from("profiles")
    .select("id,discord_id,discord_username,discord_display_name,roblox_username")
    .in("id", rows.map((r) => r.carrierId));
  if (profileError) throw new Error(profileError.message);
  const map = new Map((profiles || []).map((p) => [p.id, p]));
  return rows.map((row) => ({ ...row, profile: map.get(row.carrierId) || null }));
}

function ratingBoard(guildId, timeframe) {
  const since = leaderboardSinceMs(timeframe);
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Carrier leaderboard by timeframe and metric")
    .addStringOption((o) => o.setName("timeframe").setDescription("Leaderboard period")
      .addChoices(
        { name: "Today / 24h", value: "day" },
        { name: "Weekly / 7d", value: "week" },
        { name: "Monthly / 30d", value: "month" },
        { name: "All time", value: "all" },
      ))
    .addStringOption((o) => o.setName("metric").setDescription("What to rank")
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
        lines = rows.map((row, index) => `${index + 1}. <@${row.carrier}> • ⭐ **${row.average}/5** • ${row.ratings} rating${row.ratings === 1 ? "" : "s"}`);
      } else if (metric === "service") {
        const rows = verifiedServiceBoard(interaction.guildId, leaderboardSinceMs(timeframe), 10);
        lines = rows.map((row, index) => [
          `${index + 1}. <@${row.carrier}> • ⏱️ **${formatTime(row.service_seconds)}**`,
          `   ${row.sessions} verified session${Number(row.sessions) === 1 ? "" : "s"} • ${row.runs_completed} dungeon run${Number(row.runs_completed) === 1 ? "" : "s"}`,
        ].join("\n"));
      } else {
        const rows = await activityBoard(timeframe, metric);
        lines = rows.map((row, index) => {
          const who = row.profile?.discord_id ? `<@${row.profile.discord_id}>` : (row.profile?.roblox_username ? `@${row.profile.roblox_username}` : "Unknown Carrier");
          const value = metric === "carries" ? `${row.carries} carries` : `${row.runs} runs`;
          return `${index + 1}. ${who} • **${value}**`;
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🏆 The Carry Tavern Carrier Leaderboard")
        .setDescription(lines.length ? lines.join("\n\n") : "No Carrier activity has been recorded for this period yet.")
        .addFields(
          { name: "Period", value: timeframeLabel(timeframe), inline: true },
          { name: "Metric", value: metricLabel(metric), inline: true },
        )
        .setFooter({ text: metric === "service" ? "Service time only counts verified carry windows. Grouped requesters never multiply time." : "Verified service time is the Tavern's primary Carrier metric." })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[LEADERBOARD]", error);
      return interaction.editReply(`❌ ${error.message || "Could not load the Carrier leaderboard."}`);
    }
  },
};
