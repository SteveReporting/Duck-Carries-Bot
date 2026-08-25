const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const db = require("../database/database");
const { verifiedServiceBoard } = require("./carryServiceTime");

const BRAND = {
  name: "The Carry Tavern",
  colour: 0xF2B705,
};

const SERVICE_TIME_RESET_AT = Date.parse("2026-08-24T03:53:00+01:00");
const REFRESH_MS = 60_000;
const WEBSITE_URL = "https://carry-tavern-official.lovable.app";

// Preserved verified service-time totals from before the service-time reset.
// These are added once to post-reset verified sessions so Discord stays aligned
// with the restored website leaderboard instead of losing those known minutes.
const PRESERVED_BASELINE = new Map([
  ["619639952828923935", { seconds: 52 * 60, sessions: 2 }],
  ["893135357367943218", { seconds: 43 * 60, sessions: 2 }],
  ["1144979479442235492", { seconds: 43 * 60, sessions: 1 }],
  ["850488844788563999", { seconds: 20 * 60, sessions: 1 }],
]);

const PROGRESSION_ROLES = [
  "Master of the Tap",
  "Brewmaster",
  "Tapmaster",
  "Caskkeeper",
  "Bartender",
  "Barback",
];

let refreshTimer = null;
let refreshRunning = false;

// Persist the exact webhook + message so the panel is always edited in place.
db.exec(`
  CREATE TABLE IF NOT EXISTS live_carrier_leaderboard (
    guild TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    webhook_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findCarrierCategory(guild) {
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalizeName(channel.name) === "carrierteam"
  ) || null;
}

function findLeaderboardChannel(guild) {
  const category = findCarrierCategory(guild);
  if (!category) return null;
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText &&
    channel.parentId === category.id &&
    normalizeName(channel.name) === "carrierleaderboard"
  ) || null;
}

function formatTime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds || 0)) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 100) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function progressBar(value, max, width = 10) {
  if (!max || max <= 0) return "░".repeat(width);
  const filled = Math.max(1, Math.min(width, Math.round((Number(value || 0) / max) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function combinedRows(guildId) {
  const liveRows = verifiedServiceBoard(guildId, SERVICE_TIME_RESET_AT, 1000);
  const merged = new Map();

  for (const [carrier, baseline] of PRESERVED_BASELINE.entries()) {
    merged.set(String(carrier), {
      carrier: String(carrier),
      service_seconds: Number(baseline.seconds || 0),
      sessions: Number(baseline.sessions || 0),
      runs_completed: 0,
      request_count: 0,
    });
  }

  for (const row of liveRows) {
    const id = String(row.carrier);
    const current = merged.get(id) || {
      carrier: id,
      service_seconds: 0,
      sessions: 0,
      runs_completed: 0,
      request_count: 0,
    };
    current.service_seconds += Number(row.service_seconds || 0);
    current.sessions += Number(row.sessions || 0);
    current.runs_completed += Number(row.runs_completed || 0);
    current.request_count += Number(row.request_count || 0);
    merged.set(id, current);
  }

  return [...merged.values()]
    .filter((row) => Number(row.service_seconds || 0) > 0)
    .sort((a, b) =>
      Number(b.service_seconds || 0) - Number(a.service_seconds || 0) ||
      Number(b.sessions || 0) - Number(a.sessions || 0)
    );
}

async function memberRank(guild, discordId) {
  let member = guild.members.cache.get(String(discordId)) || null;
  if (!member) member = await guild.members.fetch(String(discordId)).catch(() => null);
  if (!member) return "Carrier";

  for (const roleName of PROGRESSION_ROLES) {
    const found = member.roles.cache.find((role) => normalizeName(role.name) === normalizeName(roleName));
    if (found) return roleName;
  }
  return member.roles.cache.some((role) => normalizeName(role.name) === "traineecarrier")
    ? "Trainee Carrier"
    : "Carrier Team";
}

async function buildPayload(guild) {
  const rows = combinedRows(guild.id);
  const top = rows.slice(0, 10);
  const maxSeconds = Number(top[0]?.service_seconds || 0);

  const topWithRanks = [];
  for (const row of top) {
    topWithRanks.push({ ...row, rankName: await memberRank(guild, row.carrier) });
  }

  const podium = [0, 1, 2].map((index) => {
    const row = topWithRanks[index];
    const medals = ["🥇", "🥈", "🥉"];
    if (!row) {
      return {
        name: `${medals[index]} #${index + 1}`,
        value: "*Open position*",
        inline: true,
      };
    }
    return {
      name: `${medals[index]} #${index + 1}`,
      value: [
        `<@${row.carrier}>`,
        `⏱️ **${formatTime(row.service_seconds)}**`,
        `🏅 ${row.rankName}`,
        `✅ ${row.sessions} verified session${Number(row.sessions) === 1 ? "" : "s"}`,
      ].join("\n"),
      inline: true,
    };
  });

  const ladder = topWithRanks.length > 3
    ? topWithRanks.slice(3).map((row, index) => {
        const place = index + 4;
        return [
          `**#${place}** <@${row.carrier}>`,
          `\`${progressBar(row.service_seconds, maxSeconds)}\` **${formatTime(row.service_seconds)}** • ${row.rankName}`,
        ].join("\n");
      }).join("\n\n")
    : "More Carrier activity is needed to fill the Top 10.";

  const totalSeconds = rows.reduce((sum, row) => sum + Number(row.service_seconds || 0), 0);
  const totalSessions = rows.reduce((sum, row) => sum + Number(row.sessions || 0), 0);
  const totalRuns = rows.reduce((sum, row) => sum + Number(row.runs_completed || 0), 0);

  const main = new EmbedBuilder()
    .setColor(BRAND.colour)
    .setTitle("🏆 THE CARRY TAVERN • LIVE CARRIER LEADERBOARD")
    .setDescription([
      "### Verified Service Time • All Time",
      "`🟢 LIVE`  This board automatically refreshes every **60 seconds** by editing this same message.",
      "",
      "Service time is the primary ranking metric. Grouped requesters never multiply time.",
    ].join("\n"))
    .addFields(...podium)
    .setFooter({ text: "The Carry Tavern • Live Carrier Rankings • Verified time only" })
    .setTimestamp();

  const standings = new EmbedBuilder()
    .setColor(0xD49A00)
    .setTitle("📜 TOP 10 STANDINGS")
    .setDescription(ladder)
    .addFields(
      {
        name: "⏱️ Verified Time",
        value: `**${formatTime(totalSeconds)}**`,
        inline: true,
      },
      {
        name: "✅ Verified Sessions",
        value: `**${totalSessions.toLocaleString("en-GB")}**`,
        inline: true,
      },
      {
        name: "⚔️ Recorded Runs",
        value: `**${totalRuns.toLocaleString("en-GB")}**`,
        inline: true,
      },
      {
        name: "📊 How ranking works",
        value: "Verified carry windows only. A Ready Check alone does not count time, and grouped carries count wall-clock time once.",
        inline: false,
      },
    );

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Open Carrier Website")
        .setEmoji("🌐")
        .setURL(WEBSITE_URL),
    ),
  ];

  return {
    embeds: [main, standings],
    components,
    allowedMentions: { parse: [] },
  };
}

async function attachmentBuffer(attachment) {
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Could not download leaderboard avatar (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function getOrCreateWebhook(channel, avatarBuffer, reason) {
  const botMember = channel.guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageWebhooks)) {
    throw new Error("The bot needs Manage Webhooks to manage the live leaderboard.");
  }

  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find((item) => item.owner?.id === botMember.id && item.name === BRAND.name) || null;
  if (!webhook) {
    webhook = await channel.createWebhook({ name: BRAND.name, avatar: avatarBuffer, reason });
  } else if (avatarBuffer) {
    await webhook.edit({ name: BRAND.name, avatar: avatarBuffer, reason }).catch(() => {});
  }
  return webhook;
}

async function findExistingLeaderboardMessage(channel) {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return null;

  return recent.find((message) => {
    if (!message.webhookId) return false;
    return message.embeds.some((item) => {
      const footer = String(item.footer?.text || "");
      const title = String(item.title || "");
      return footer.includes("channel-leaderboard-v1") ||
        footer.includes("Live Carrier Rankings") ||
        title.includes("LIVE CARRIER LEADERBOARD");
    });
  }) || null;
}

function saveState(guildId, channelId, webhookId, messageId) {
  db.prepare(`
    INSERT INTO live_carrier_leaderboard(guild,channel_id,webhook_id,message_id,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(guild) DO UPDATE SET
      channel_id=excluded.channel_id,
      webhook_id=excluded.webhook_id,
      message_id=excluded.message_id,
      updated_at=excluded.updated_at
  `).run(String(guildId), String(channelId), String(webhookId), String(messageId), Date.now());
}

async function installLiveCarrierLeaderboard(interaction, avatar) {
  const guild = interaction.guild;
  const channel = findLeaderboardChannel(guild);
  if (!channel) throw new Error("Could not find carrier-leaderboard inside the exact CARRIER TEAM category.");

  const avatarBuffer = await attachmentBuffer(avatar);
  const reason = `Live Carrier leaderboard configured by ${interaction.user.tag}`;
  const webhooks = await channel.fetchWebhooks();
  const existingMessage = await findExistingLeaderboardMessage(channel);
  let webhook = existingMessage?.webhookId ? webhooks.get(existingMessage.webhookId) || null : null;

  if (!webhook) webhook = await getOrCreateWebhook(channel, avatarBuffer, reason);
  else await webhook.edit({ name: BRAND.name, avatar: avatarBuffer, reason }).catch(() => {});

  const payload = await buildPayload(guild);
  let message = null;
  let reused = false;

  if (existingMessage && existingMessage.webhookId === webhook.id) {
    message = await webhook.editMessage(existingMessage.id, payload).catch(() => null);
    reused = Boolean(message);
  }

  if (!message) {
    const prior = db.prepare("SELECT * FROM live_carrier_leaderboard WHERE guild=?").get(String(guild.id));
    if (prior && String(prior.webhook_id) === String(webhook.id)) {
      message = await webhook.editMessage(String(prior.message_id), payload).catch(() => null);
      reused = Boolean(message);
    }
  }

  if (!message) {
    message = await webhook.send(payload);
  }

  await channel.messages.pin(message.id, reason).catch(() => {});
  saveState(guild.id, channel.id, webhook.id, message.id);

  return {
    channelId: channel.id,
    messageId: message.id,
    webhookId: webhook.id,
    reused,
    refreshSeconds: REFRESH_MS / 1000,
  };
}

async function refreshState(client, state) {
  const guild = await client.guilds.fetch(String(state.guild)).catch(() => null);
  if (!guild) return false;
  const channel = await guild.channels.fetch(String(state.channel_id)).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const webhooks = await channel.fetchWebhooks().catch(() => null);
  const webhook = webhooks?.get(String(state.webhook_id)) || null;
  if (!webhook) return false;

  const payload = await buildPayload(guild);
  const edited = await webhook.editMessage(String(state.message_id), payload).catch(() => null);
  if (!edited) return false;

  db.prepare("UPDATE live_carrier_leaderboard SET updated_at=? WHERE guild=?")
    .run(Date.now(), String(state.guild));
  return true;
}

async function refreshAll(client) {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    const states = db.prepare("SELECT * FROM live_carrier_leaderboard").all();
    for (const state of states) {
      const ok = await refreshState(client, state).catch((error) => {
        console.warn(`[LIVE LEADERBOARD] ${state.guild}: ${error.message}`);
        return false;
      });
      if (!ok) {
        console.warn(`[LIVE LEADERBOARD] Could not edit the configured message for guild ${state.guild}. Run /live-leaderboard again if the message or webhook was deleted.`);
      }
    }
  } finally {
    refreshRunning = false;
  }
}

function startLiveCarrierLeaderboard(client) {
  if (refreshTimer) return;
  void refreshAll(client);
  refreshTimer = setInterval(() => void refreshAll(client), REFRESH_MS);
  refreshTimer.unref?.();
  console.log("✅ Live Carrier leaderboard updater started (60s in-place edits).");
}

module.exports = {
  buildPayload,
  installLiveCarrierLeaderboard,
  startLiveCarrierLeaderboard,
};