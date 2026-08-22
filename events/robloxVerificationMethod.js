const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile } = require("../platform/helpers");
const { verificationGameUrl } = require("../platform/robloxAccounts");

const SELECT_PREFIX = "roblox_verify_method:";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function methodSelector(requestId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${SELECT_PREFIX}${requestId}`)
      .setPlaceholder("Choose how you want to verify")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Verification Game")
          .setDescription("Join the Roblox game and verify automatically")
          .setEmoji("🎮")
          .setValue("game"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Roblox Bio / About")
          .setDescription("Put a unique code in your Roblox About")
          .setEmoji("📝")
          .setValue("bio"),
      ),
  );
}

function joinGameButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Join Verification Game")
      .setEmoji("🎮")
      .setURL(verificationGameUrl()),
  );
}

async function pendingForDiscordUser(discordId, requestId = null) {
  const profile = await getLinkedProfile(discordId).catch(() => null);
  if (!profile?.id) return null;

  const supabase = getSupabase();
  let query = supabase
    .from("roblox_link_requests")
    .select("id,user_id,roblox_username,roblox_user_id,verification_code,status,created_at")
    .eq("user_id", profile.id)
    .eq("status", "pending");

  if (requestId) query = query.eq("id", requestId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { profile, request: data };
}

async function replaceLinkReplyWithSelector(interaction) {
  // /roblox link itself resolves the Roblox username and writes the pending
  // request. Wait for that operation to finish, then replace its old two-method
  // wall of text with one clean method picker.
  let state = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await sleep(attempt === 0 ? 450 : 300);
    state = await pendingForDiscordUser(interaction.user.id).catch(() => null);
    if (state?.request?.roblox_user_id) break;
  }
  if (!state?.request) return;

  const request = state.request;
  await interaction.editReply({
    content: [
      `🟥 **Roblox verification started for @${request.roblox_username}.**`,
      "",
      "Choose how you want to verify this Roblox account:",
      "",
      "🎮 **Verification Game** — select this, then join the game. The moment this exact Roblox account joins, it verifies automatically.",
      "📝 **Roblox Bio / About** — select this to receive a unique code for your Roblox About.",
    ].join("\n"),
    components: [methodSelector(request.id)],
  });
}

async function chooseVerificationMethod(interaction) {
  const requestId = interaction.customId.slice(SELECT_PREFIX.length);
  const selected = interaction.values?.[0];
  const state = await pendingForDiscordUser(interaction.user.id, requestId);

  if (!state?.request) {
    return interaction.reply({
      content: "❌ That Roblox verification request is no longer pending. Run `/roblox link` again.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { request } = state;
  const supabase = getSupabase();

  if (selected === "game") {
    if (!request.roblox_user_id) {
      return interaction.update({
        content: "❌ This verification request is missing the Roblox User ID. Run `/roblox link` again.",
        components: [],
      });
    }

    // Re-arm the exact pending row at the moment Game Verification is selected.
    // The Roblox place submits player.UserId, so the website verifier can now
    // match this immutable ID immediately when the player joins.
    const { error } = await supabase
      .from("roblox_link_requests")
      .update({
        roblox_user_id: String(request.roblox_user_id),
        roblox_username: request.roblox_username,
        created_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("user_id", state.profile.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);

    return interaction.update({
      content: [
        `🎮 **Game Verification selected for @${request.roblox_username}.**`,
        "",
        "✅ Your verification is ready.",
        "",
        "Join the Carry Tavern verification game while logged into **this exact Roblox account**.",
        "**As soon as you join, the game verifies you automatically.** You do not need to run `/roblox verify` afterwards.",
        "",
        `Roblox User ID locked to this request: \`${request.roblox_user_id}\``,
      ].join("\n"),
      components: [joinGameButton()],
    });
  }

  if (selected === "bio") {
    return interaction.update({
      content: [
        `📝 **Bio Verification selected for @${request.roblox_username}.**`,
        "",
        "Put this exact code anywhere in the Roblox account's **About / description** and save it:",
        `\`${request.verification_code}\``,
        "",
        "Then run `/roblox verify` in Discord. The bot checks Roblox several times to allow for profile update delay.",
      ].join("\n"),
      components: [],
    });
  }

  return interaction.reply({
    content: "❌ Unknown verification method.",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
    try {
      if (
        interaction.isChatInputCommand?.() &&
        interaction.commandName === "roblox" &&
        interaction.options.getSubcommand(false) === "link"
      ) {
        return await replaceLinkReplyWithSelector(interaction);
      }

      if (
        interaction.isStringSelectMenu?.() &&
        interaction.customId.startsWith(SELECT_PREFIX)
      ) {
        return await chooseVerificationMethod(interaction);
      }
    } catch (error) {
      console.error("[ROBLOX METHOD SELECT]", error);
      const message = `❌ ${error.message || "Could not select a Roblox verification method."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
