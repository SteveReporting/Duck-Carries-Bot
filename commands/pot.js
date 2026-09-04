const {
  EmbedBuilder,
  SlashCommandBuilder,
} = require("discord.js");

const { chatCompletion, getLocalAiModel } = require("../ai/localChat");
const {
  calculatePotential,
  formatPower,
  normalizeUpgradeData,
  parsePower,
  parseUpgradeSpec,
} = require("../platform/potCalculator");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const GOLD = 0xf2b705;

function visionModel() {
  return String(
    process.env.POT_VISION_MODEL ||
    process.env.SECURITY_AI_MODEL ||
    process.env.LOCAL_VISION_MODEL ||
    getLocalAiModel("qwen3-vl:8b")
  ).trim();
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("The image reader returned an empty response.");

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch {}
  }

  const object = raw.match(/\{[\s\S]*\}/)?.[0];
  if (object) {
    try { return JSON.parse(object); } catch {}
  }

  throw new Error("The image reader could not return structured weapon figures.");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

async function readWeaponImage(attachment, statPreference) {
  const contentType = String(attachment.contentType || "").toLowerCase();
  if (!IMAGE_TYPES.has(contentType)) {
    throw new Error("Weapon screenshots must be PNG, JPEG or WebP images.");
  }
  if (Number(attachment.size || 0) > MAX_IMAGE_BYTES) {
    throw new Error("Weapon screenshots must be 8 MB or smaller.");
  }

  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Discord's weapon screenshot could not be downloaded.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("The weapon screenshot was empty or too large.");

  const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
  const statInstruction = statPreference === "physical"
    ? "Read the current PHYSICAL damage/power stat."
    : statPreference === "spell"
      ? "Read the current SPELL power/damage stat."
      : "Choose the weapon's relevant visible damage/power stat; if both physical and spell are shown, prefer the clearly dominant/intended weapon stat.";

  const completion = await chatCompletion({
    model: visionModel(),
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "You are a strict OCR/parser for Dungeon Quest weapon item-card screenshots.",
          "Extract only values visibly supported by the image. Never invent a missing number and never calculate potential yourself.",
          "Return ONLY one JSON object with these keys:",
          "item_name: string|null",
          "stat_type: physical|spell|unknown",
          "current_power: number|null",
          "upgrades_used: number|null",
          "total_upgrades: number|null",
          "upgrades_remaining: number|null",
          "confidence: number from 0 to 1",
          "If the card displays upgrade progress like 34/120, use 34 as upgrades_used and 120 as total_upgrades.",
          "If it explicitly displays upgrades remaining/left, put that number in upgrades_remaining.",
          "Do not turn an unclear lone upgrade number into used or remaining unless the image labels what it means.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          { type: "text", text: `${statInstruction}\nRead this weapon card and return the JSON object only.` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  }, { timeoutMs: 90_000 });

  const raw = completion?.choices?.[0]?.message?.content;
  const parsed = extractJson(raw);
  const currentPower = parsePower(parsed.current_power);
  const used = numberOrNull(parsed.upgrades_used);
  const total = numberOrNull(parsed.total_upgrades);
  const remaining = numberOrNull(parsed.upgrades_remaining);
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));

  return {
    itemName: parsed.item_name ? String(parsed.item_name).slice(0, 100) : null,
    statType: ["physical", "spell"].includes(String(parsed.stat_type).toLowerCase())
      ? String(parsed.stat_type).toLowerCase()
      : "unknown",
    currentPower,
    used,
    total,
    remaining,
    confidence,
    model: visionModel(),
  };
}

function inputSummary(result, source, imageData) {
  const lines = [
    `**Current power:** ${formatPower(result.currentPower)}`,
    result.appliedUpgrades === null ? null : `**Upgrades applied:** ${result.appliedUpgrades.toLocaleString("en-US")}`,
    result.totalUpgrades === null ? null : `**Total upgrades:** ${result.totalUpgrades.toLocaleString("en-US")}`,
    `**Upgrades remaining:** ${result.remainingUpgrades.toLocaleString("en-US")}`,
    `**Source:** ${source}`,
  ].filter(Boolean);

  if (imageData) {
    lines.push(`**Image read confidence:** ${Math.round(imageData.confidence * 100)}%`);
  }
  return lines.join("\n");
}

function resultEmbed(result, { itemName, statType, source, imageData } = {}) {
  const statLabel = statType === "physical" ? "Physical" : statType === "spell" ? "Spell" : "Weapon";
  const titleName = itemName ? `${itemName} • ` : "";
  const formula = `${formatPower(result.currentPower)} + (${result.remainingUpgrades.toLocaleString("en-US")} × 10)`;

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • POT CALCULATOR" })
    .setTitle(`⚔️ ${titleName}${statLabel} Pot: ${formatPower(result.potential)}`.slice(0, 256))
    .setDescription([
      `## ${formatPower(result.potential)}`,
      "**Final weapon potential**",
      "",
      `\`${formula} = ${formatPower(result.potential)}\``,
    ].join("\n"))
    .addFields(
      { name: "📊 Figures Used", value: inputSummary(result, source, imageData), inline: false },
      {
        name: "🧮 Formula",
        value: "`Potential = current power + (remaining upgrades × 10)`",
        inline: false,
      },
    )
    .setFooter({ text: "The Carry Tavern • +10 power per remaining upgrade" })
    .setTimestamp();

  if (result.basePower !== null) {
    embed.addFields({
      name: "↩️ Reconstructed Clean Power",
      value: [
        `**${formatPower(result.basePower)}**`,
        `\`${formatPower(result.currentPower)} - (${result.appliedUpgrades.toLocaleString("en-US")} × 10) = ${formatPower(result.basePower)}\``,
        result.totalUpgrades === null
          ? null
          : `Cross-check: \`${formatPower(result.basePower)} + (${result.totalUpgrades.toLocaleString("en-US")} × 10) = ${formatPower(result.potential)}\``,
      ].filter(Boolean).join("\n"),
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pot")
    .setDescription("Dungeon Quest weapon potential calculator")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("calculate")
        .setDescription("Calculate weapon pot from a screenshot or manual figures")
        .addAttachmentOption((option) =>
          option
            .setName("image")
            .setDescription("Weapon item-card screenshot (PNG/JPEG/WebP)"),
        )
        .addStringOption((option) =>
          option
            .setName("current")
            .setDescription("Current damage/power, e.g. 25400, 1.25m"),
        )
        .addStringOption((option) =>
          option
            .setName("upgrades")
            .setDescription("Remaining upgrades or used/total, e.g. 86 or 34/120"),
        )
        .addStringOption((option) =>
          option
            .setName("stat")
            .setDescription("Which weapon stat to read from an image")
            .addChoices(
              { name: "Auto detect", value: "auto" },
              { name: "Physical", value: "physical" },
              { name: "Spell", value: "spell" },
            ),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const attachment = interaction.options.getAttachment("image");
    const manualCurrent = interaction.options.getString("current")?.trim() || null;
    const manualUpgrades = interaction.options.getString("upgrades")?.trim() || null;
    const statPreference = interaction.options.getString("stat") || "auto";

    if (!attachment && !manualCurrent) {
      return interaction.editReply([
        "❌ Give me either a **weapon screenshot** or the current weapon power.",
        "",
        "Manual example: `/pot calculate current:25400 upgrades:34/120`",
        "If the number you have is upgrades **remaining**, just use `upgrades:86`.",
      ].join("\n"));
    }

    try {
      let imageData = null;
      if (attachment) {
        try {
          imageData = await readWeaponImage(attachment, statPreference);
        } catch (error) {
          if (!manualCurrent || !manualUpgrades) {
            return interaction.editReply([
              `❌ I couldn't read that weapon card reliably: **${error.message}**`,
              "",
              "You can still calculate it instantly by adding manual figures, for example:",
              "`/pot calculate current:25400 upgrades:34/120`",
            ].join("\n"));
          }
        }
      }

      const manualPower = manualCurrent ? parsePower(manualCurrent) : null;
      if (manualCurrent && manualPower === null) {
        return interaction.editReply("❌ I couldn't understand `current`. Try a number such as `25400`, `25,400` or `1.25m`.");
      }

      let manualUpgradeData = null;
      if (manualUpgrades) manualUpgradeData = parseUpgradeSpec(manualUpgrades);

      if (imageData && imageData.confidence < 0.55 && (!manualCurrent || !manualUpgrades)) {
        return interaction.editReply([
          `⚠️ I can see the card, but the read confidence is only **${Math.round(imageData.confidence * 100)}%**.`,
          "I won't guess on a trading stat. Add the figures manually with `current:` and `upgrades:`.",
        ].join("\n"));
      }

      const currentPower = manualPower ?? imageData?.currentPower ?? null;
      const extractedUpgrades = imageData
        ? normalizeUpgradeData({ used: imageData.used, total: imageData.total, remaining: imageData.remaining })
        : { used: null, total: null, remaining: null };
      const upgradeData = manualUpgradeData || extractedUpgrades;

      if (currentPower === null) {
        return interaction.editReply("❌ I couldn't find the weapon's current damage/power in that image. Add it manually with `current:`.");
      }
      if (upgradeData.remaining === null) {
        return interaction.editReply([
          "❌ I couldn't determine how many upgrades remain.",
          "Use `upgrades:34/120` for **34 applied out of 120**, or `upgrades:86` if **86 remain**.",
        ].join("\n"));
      }

      const result = calculatePotential({ currentPower, ...upgradeData });
      const source = attachment && (manualCurrent || manualUpgrades)
        ? "Screenshot + manual override"
        : attachment
          ? "Local screenshot reader"
          : "Manual figures";

      return interaction.editReply({
        embeds: [resultEmbed(result, {
          itemName: imageData?.itemName || null,
          statType: statPreference === "auto" ? imageData?.statType : statPreference,
          source,
          imageData: attachment ? imageData : null,
        })],
      });
    } catch (error) {
      console.error("[POT CALCULATOR]", error);
      return interaction.editReply(`❌ ${error.message || "Could not calculate that weapon's potential."}`);
    }
  },
};
