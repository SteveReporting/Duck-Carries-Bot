const { handleGoldDonationInteraction } = require("../treasury/goldDonations");

module.exports = {
    name: "interactionCreate",

    async execute(interaction) {
        try {
            await handleGoldDonationInteraction(interaction);
        } catch (error) {
            console.error("[TREASURY GOLD] Interaction failed:", error);

            if (!interaction.isRepliable?.()) return;

            const payload = {
                content: "❌ Gold donation submission failed. Please try again.",
                flags: 64,
            };

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    },
};
