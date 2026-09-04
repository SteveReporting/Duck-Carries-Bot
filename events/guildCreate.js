const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { isGuildConfigured } = require("../platform/guildConfig");

module.exports = {
  name: "guildCreate",
  async execute(guild) {
    console.log(`🌍 Joined guild ${guild.name} (${guild.id}) • ${guild.memberCount || 0} member(s).`);
    if (isGuildConfigured(guild.id)) return;

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const candidates = [guild.systemChannel, ...guild.channels.cache.values()]
      .filter(Boolean)
      .filter((channel, index, array) => array.findIndex((item) => item.id === channel.id) === index)
      .filter((channel) => channel.isTextBased?.())
      .filter((channel) => !me || channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages));

    const target = candidates[0];
    if (!target) return;

    const embed = new EmbedBuilder()
      .setTitle("🍺 The Carry Tavern is ready to install")
      .setDescription([
        "Thanks for adding me. This server has its own isolated Discord configuration.",
        "",
        "A server manager should run **`/setup`** once.",
        "I can automatically create the carry queue, completed channel, ticket category, waiting voice, Carrier role, staff role, logs and operations channels.",
        "",
        "Until setup is complete, the other Tavern commands stay safely locked.",
      ].join("\n"))
      .setFooter({ text: `Guild ${guild.id}` });

    await target.send({ embeds: [embed] }).catch(() => null);
  },
};
