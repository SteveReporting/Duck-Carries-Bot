const { MessageFlags } = require("discord.js");

const TARGETS = new Set([
  "carrier_review_grade_modal",
  "carrier_review_notes_modal",
]);

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
    if (!interaction.isModalSubmit?.()) return;
    if (!TARGETS.has(interaction.customId)) return;
    if (interaction.deferred || interaction.replied) return;

    const originalReply = interaction.reply.bind(interaction);
    const originalEditReply = interaction.editReply.bind(interaction);
    let completed = false;

    // Start the Discord acknowledgement immediately so the Google bridge can
    // take longer than three seconds without Discord showing "bot didn't respond".
    const ackPromise = interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch((error) => {
      console.error(`[CARRIER APP REVIEW] Could not defer ${interaction.customId}:`, error);
      return null;
    });

    interaction.editReply = async (...args) => {
      await ackPromise;
      completed = true;
      return originalEditReply(...args);
    };

    // The existing review collector calls submitted.reply(). Once this listener
    // has deferred the modal, transparently convert that call into editReply().
    interaction.reply = async (...args) => {
      await ackPromise;
      if (interaction.deferred || interaction.replied) {
        completed = true;
        return originalEditReply(...args);
      }
      completed = true;
      return originalReply(...args);
    };

    const fallback = setTimeout(async () => {
      if (completed) return;
      completed = true;
      await originalEditReply({
        content: "❌ The Carrier review action did not finish. Try it again and check the bot logs if it keeps happening.",
      }).catch(() => {});
    }, 30_000);
    fallback.unref?.();
  },
};
