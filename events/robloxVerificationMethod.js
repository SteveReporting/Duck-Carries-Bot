const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile } = require("../platform/helpers");
const { verificationGameUrl } = require("../platform/robloxAccounts");

const SELECT_PREFIX = "roblox_verify_method:";

function joinGameButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Join Verification Game")
      .setEmoji("🎮")
      .setURL(verificationGameUrl()),
  );
}

async function pendingForDiscordUser(discordId, requestId) {
  const profile = await getLinkedProfile(discordId).catch(() => null);
  if (!profile?.id) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("roblox_link_requests")
    .select("id,user_id,roblox_username,roblox_user_id,verification_code,status,created_at")
    .eq("id", requestId)
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return { profile, request: data };
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

    // Re-arm the exact pending record when the user explicitly chooses game
    // verification. The Roblox place sends player.UserId on PlayerAdded, so
    // joining the game is the verification action after this point.
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
        "✅ Your verification request is armed for this exact Roblox account.",
        "",
        "Press **Join Verification Game** below while logged into that account.",
        "**The instant the account joins the verification place, it is verified automatically.**",
        "You do not need to run `/roblox verify` afterwards.",
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
    if (!interaction.isStringSelectMenu?.() || !interaction.customId.startsWith(SELECT_PREFIX)) return;

    try {
      return await chooseVerificationMethod(interaction);
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
