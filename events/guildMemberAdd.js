module.exports = {
  name: "guildMemberAdd",

  async execute(member) {
    try {
      await member.send([
        "🍺 **Welcome to The Carry Tavern!**",
        "",
        "Roblox identity for the carry queue is handled through **Bloxlink**.",
        "Make sure your Roblox account is linked through Bloxlink, then the Tavern bot will automatically use the correct Roblox username when you request a carry.",
        "",
        "There is no separate Carry Tavern Roblox verification step anymore.",
      ].join("\n")).catch(() => {});
    } catch (error) {
      console.error(`[JOIN] ${member.id}:`, error);
    }
  },
};
