const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { recordTradeRating, tradeReputation } = require("../platform/communitySystems");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade reputation for Carry Tavern marketplace deals")
    .addSubcommand((s) => s.setName("rate").setDescription("Rate someone after a completed trade")
      .addUserOption((o) => o.setName("user").setDescription("Person you traded with").setRequired(true))
      .addIntegerOption((o) => o.setName("score").setDescription("1-5 stars").setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption((o) => o.setName("reference").setDescription("Listing ID, trade ID or unique deal reference").setRequired(true).setMaxLength(120))
      .addStringOption((o) => o.setName("note").setDescription("Optional feedback").setMaxLength(500)))
    .addSubcommand((s) => s.setName("reputation").setDescription("View someone's trade reputation")
      .addUserOption((o) => o.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "rate") {
        const target = interaction.options.getUser("user", true);
        if (target.id === interaction.user.id) return interaction.reply({ content: "❌ You cannot rate your own trade account.", flags: MessageFlags.Ephemeral });
        if (target.bot) return interaction.reply({ content: "❌ Bots cannot receive trade reputation.", flags: MessageFlags.Ephemeral });
        const score = interaction.options.getInteger("score", true);
        const reference = interaction.options.getString("reference", true).trim();
        const note = interaction.options.getString("note")?.trim() || null;
        const inserted = recordTradeRating({
          guildId: interaction.guildId,
          raterId: interaction.user.id,
          targetId: target.id,
          score,
          reference,
          note,
        });
        if (!inserted) return interaction.reply({ content: "❌ You already rated this member for that trade reference.", flags: MessageFlags.Ephemeral });
        await target.send(`💰 **New Carry Tavern trade rating**\n${"⭐".repeat(score)} from **${interaction.user.username}**${note ? `\n${note}` : ""}\nReference: \`${reference}\``).catch(() => {});
        return interaction.reply({ content: `✅ Recorded a **${score}/5** trade rating for ${target}.`, flags: MessageFlags.Ephemeral });
      }

      const target = interaction.options.getUser("user") || interaction.user;
      const rep = tradeReputation(interaction.guildId, target.id);
      const percent = rep.ratings ? Math.round((rep.positive / rep.ratings) * 100) : 0;
      const embed = new EmbedBuilder()
        .setTitle(`💰 Trade Reputation • ${target.username}`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: "Average", value: rep.average == null ? "No ratings" : `⭐ ${rep.average}/5`, inline: true },
          { name: "Ratings", value: String(rep.ratings), inline: true },
          { name: "Positive", value: rep.ratings ? `${percent}%` : "N/A", inline: true },
        )
        .setFooter({ text: "Trade ratings are separate from Carrier carry ratings." });
      return interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("[TRADE REP]", error);
      return interaction.reply({ content: `❌ ${error.message || "Trade reputation command failed."}`, flags: MessageFlags.Ephemeral });
    }
  },
};
