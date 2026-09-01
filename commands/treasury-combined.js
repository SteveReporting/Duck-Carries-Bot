const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const treasury = require("./treasury");
const treasuryAdmin = require("./treasury-admin");
const treasuryClose = require("./treasury-close");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("treasury")
    .setDescription("Carry Tavern Treasury")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("stock")
        .setDescription("Open the interactive Treasury stock panel"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("admin")
        .setDescription("Treasury staff administration")
        .addSubcommand((sub) =>
          sub
            .setName("view")
            .setDescription("View a member's Treasury profile")
            .addUserOption((option) =>
              option.setName("user").setDescription("Member to inspect").setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("trust")
            .setDescription("Set a member's Treasury Trust Score")
            .addUserOption((option) =>
              option.setName("user").setDescription("Member to edit").setRequired(true),
            )
            .addIntegerOption((option) =>
              option
                .setName("score")
                .setDescription("Trust Score from 0 to 100")
                .setMinValue(0)
                .setMaxValue(100)
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("clear-scam")
            .setDescription("Clear a Treasury scam block after staff review")
            .addUserOption((option) =>
              option.setName("user").setDescription("Member to unblock").setRequired(true),
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close the resolved Treasury ticket you are currently in"),
    ),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (group === "admin") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: "❌ Manage Server permission is required for Treasury administration.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return treasuryAdmin.execute(interaction);
    }

    if (sub === "close") return treasuryClose.execute(interaction);
    return treasury.execute(interaction);
  },
};
