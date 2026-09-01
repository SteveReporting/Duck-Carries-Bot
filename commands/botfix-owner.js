const { MessageFlags } = require("discord.js");
const botfix = require("./botfix");

const MASTER_OWNER_ID = "1178367418955989053";

module.exports = {
  data: botfix.data,

  async execute(interaction) {
    if (interaction.user.id !== MASTER_OWNER_ID) {
      return interaction.reply({
        content: "❌ This command is restricted to the bot owner.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return botfix.execute(interaction);
  },
};
