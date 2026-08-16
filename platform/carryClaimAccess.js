const { MessageFlags } = require("discord.js");

const DEFAULT_CARRY_CLAIM_ROLE_ID = "1538643501737058404";

function carryClaimRoleId() {
  return String(process.env.CARRY_CLAIM_ROLE_ID || DEFAULT_CARRY_CLAIM_ROLE_ID).trim();
}

function isCarryClaimInteraction(interaction) {
  if (!interaction?.guildId) return false;

  if (interaction.isChatInputCommand?.()) {
    if (interaction.commandName !== "queue") return false;
    try {
      return interaction.options.getSubcommand(false) === "claim";
    } catch {
      return false;
    }
  }

  if (interaction.isStringSelectMenu?.()) {
    return interaction.customId === "queue_group_select" || interaction.customId === "queue_run_select";
  }

  if (interaction.isButton?.()) {
    return String(interaction.customId || "").startsWith("claim_");
  }

  return false;
}

function memberHasCarryClaimRole(interaction) {
  const requiredRoleId = carryClaimRoleId();
  const member = interaction?.member;
  if (!requiredRoleId || !member) return false;

  if (member.roles?.cache?.has) {
    return member.roles.cache.has(requiredRoleId);
  }

  if (Array.isArray(member.roles)) {
    return member.roles.includes(requiredRoleId);
  }

  return false;
}

async function guardCarryClaimInteraction(interaction) {
  if (!isCarryClaimInteraction(interaction)) return true;
  if (memberHasCarryClaimRole(interaction)) return true;

  const requiredRoleId = carryClaimRoleId();
  const payload = {
    content: `❌ You must have <@&${requiredRoleId}> to claim Carry Tickets.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { roles: [] },
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    console.warn("[CARRY CLAIM ACCESS] Could not deny claim interaction:", error.message);
  }

  return false;
}

module.exports = {
  DEFAULT_CARRY_CLAIM_ROLE_ID,
  carryClaimRoleId,
  guardCarryClaimInteraction,
  isCarryClaimInteraction,
  memberHasCarryClaimRole,
};
