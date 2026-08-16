const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { requireLinkedProfile, marketplaceBaseUrl } = require("../platform/helpers");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tavern-admin")
    .setDescription("Carry Tavern platform owner setup")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s.setName("bootstrap-owner").setDescription("Make your linked Tavern account the initial platform owner"),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.editReply("❌ Discord Administrator permission is required.");
      }
      const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
      if (!profile) return;
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("bootstrap_platform_owner", {
        _discord_id: interaction.user.id,
      });
      if (error) throw new Error(error.message);
      const base = marketplaceBaseUrl();
      await interaction.editReply(
        `✅ Platform owner access enabled for your linked Tavern account (${data}).${base ? `\nOpen Tavern Operations: ${base}/admin` : ""}`,
      );
    } catch (error) {
      console.error("[TAVERN-ADMIN]", error);
      await interaction.editReply(`❌ ${error.message}`);
    }
  },
};
