const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const LEGACY_FOOTER = "The Carry Tavern • Support Tickets";
const PREMIUM_FOOTER = "The Carry Tavern • Support Concierge";

function premiumSupportPayload() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xf2b705)
        .setAuthor({ name: "THE CARRY TAVERN • SUPPORT CONCIERGE" })
        .setTitle("🛟 Need a hand?")
        .setDescription([
          "Open one private case and the Tavern team will take it from there.",
          "",
          "### We can help with",
          "⚔️ **Carries** • queue, Carrier, no-show or ticket problems",
          "💰 **Trading** • marketplace questions, disputes or scams",
          "🏦 **Treasury** • borrowing, returns or stock issues",
          "🛡️ **Server Support** • staff, moderation or technical problems",
          "",
          "When the ticket opens, your issue and details are placed into a clean case card for staff. You can attach screenshots directly inside the private channel.",
          "",
          "**One active Support case per person.**",
        ].join("\n"))
        .addFields(
          { name: "🔒 Privacy", value: "Private requester + staff channel", inline: true },
          { name: "🙋 Ownership", value: "Staff claim + assignment tracking", inline: true },
          { name: "📊 Status", value: "Live staff dashboard", inline: true },
        )
        .setFooter({ text: PREMIUM_FOOTER })
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("support_ticket_open")
          .setLabel("Open Support Case")
          .setEmoji("🛟")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("premium_my_carries")
          .setLabel("My Carries")
          .setEmoji("⚔️")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("tavern_help_open")
          .setLabel("Help Center")
          .setEmoji("❓")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function refreshPremiumSupportPanel(publicChannel, botId) {
  if (!publicChannel?.isTextBased?.()) return null;
  const messages = await publicChannel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return null;

  const panel = messages.find((message) =>
    message.author?.id === botId &&
    (message.embeds || []).some((embed) => {
      const footer = String(embed.footer?.text || "");
      return footer.includes(LEGACY_FOOTER) || footer.includes(PREMIUM_FOOTER);
    }),
  );

  if (!panel) return null;
  await panel.edit(premiumSupportPayload()).catch(() => null);
  if (!panel.pinned) await panel.pin("Permanent Carry Tavern Support Concierge").catch(() => {});
  return panel;
}

module.exports = {
  PREMIUM_FOOTER,
  premiumSupportPayload,
  refreshPremiumSupportPanel,
};
