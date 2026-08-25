const { PermissionFlagsBits } = require("discord.js");

const SEPARATOR_SPECS = [
    { key: "leadership", name: "━━━ 🍺 TAVERN LEADERSHIP ━━━" },
    { key: "management", name: "━━━ 🛡️ CARRIER MANAGEMENT ━━━" },
    { key: "progression", name: "━━━ 🏆 CARRIER PROGRESSION ━━━" },
];

function normalizeName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
}

function findRole(guild, name) {
    const wanted = normalizeName(name);
    return guild.roles.cache.find(
        (role) => !role.managed && normalizeName(role.name) === wanted
    ) || null;
}

async function ensureCarrierRoleSeparators(interaction) {
    const guild = interaction.guild;
    const botMember = guild.members.me;
    const reason = `Carrier role separators requested by ${interaction.user.tag}`;

    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error("The bot needs Manage Roles to create and position Carrier separators.");
    }

    const requiredRoleNames = [
        "Head of Carriers",
        "Deputy Head of Carriers",
        "Recruitment Lead",
        "Training Lead",
        "Carrier Supervisor",
        "Carrier Mentor",
        "Master of the Tap",
        "Brewmaster",
        "Tapmaster",
        "Caskkeeper",
        "Bartender",
        "Barback",
        "Carrier Team",
        "Trainee Carrier",
    ];

    const roles = {};
    for (const name of requiredRoleNames) roles[name] = findRole(guild, name);

    if (!roles["Carrier Team"]) {
        throw new Error("Carrier Team role was not found, so separator placement was not attempted.");
    }

    const created = [];
    const warnings = [];
    const separators = {};

    for (const spec of SEPARATOR_SPECS) {
        let role = findRole(guild, spec.name);
        if (!role) {
            role = await guild.roles.create({
                name: spec.name,
                permissions: [],
                hoist: false,
                mentionable: false,
                color: 0,
                reason,
            });
            created.push(role.name);
        }

        if (botMember.roles.highest.comparePositionTo(role) > 0) {
            await role.setPermissions([], reason).catch((error) => warnings.push(`${role.name} permissions: ${error.message}`));
            await role.setHoist(false, reason).catch(() => {});
            await role.setMentionable(false, reason).catch(() => {});
            await role.setColor(0, reason).catch(() => {});
        } else {
            warnings.push(`${role.name} is above the bot and could not be normalised.`);
        }

        separators[spec.key] = role;
    }

    // Discord role position numbers increase upward. This is intentionally the
    // reverse of the visual top-to-bottom order requested for the role list.
    const bottomToTop = [
        separators.progression,
        roles.Barback,
        roles.Bartender,
        roles.Caskkeeper,
        roles.Tapmaster,
        roles.Brewmaster,
        roles["Master of the Tap"],
        separators.management,
        roles["Carrier Mentor"],
        roles["Carrier Supervisor"],
        roles["Training Lead"],
        roles["Recruitment Lead"],
        separators.leadership,
        roles["Deputy Head of Carriers"],
        roles["Head of Carriers"],
    ].filter(Boolean);

    // Run a few passes because moving a Discord role can shift the numeric
    // positions of the surrounding roles. Re-anchoring to Carrier Team makes
    // the final ordering deterministic without moving unrelated server roles
    // any higher than necessary.
    for (let pass = 0; pass < 3; pass += 1) {
        const carrierTeam = findRole(guild, "Carrier Team");
        const anchor = carrierTeam.position;
        const highestNeeded = anchor + bottomToTop.length;
        const botHighest = botMember.roles.highest.position;

        if (highestNeeded >= botHighest) {
            warnings.push(`Bot role is not high enough to place the full Carrier hierarchy. Needed below position ${highestNeeded}, bot is at ${botHighest}.`);
            break;
        }

        let offset = 1;
        for (const role of bottomToTop) {
            if (botMember.roles.highest.comparePositionTo(role) <= 0) {
                warnings.push(`${role.name} is above the bot and could not be positioned.`);
                offset += 1;
                continue;
            }
            await role.setPosition(anchor + offset, { reason }).catch((error) => {
                warnings.push(`Could not position ${role.name}: ${error.message}`);
            });
            offset += 1;
        }

        const trainee = findRole(guild, "Trainee Carrier");
        const freshCarrierTeam = findRole(guild, "Carrier Team");
        if (trainee && botMember.roles.highest.comparePositionTo(trainee) > 0) {
            await trainee.setPosition(Math.max(1, freshCarrierTeam.position - 1), { reason }).catch((error) => {
                warnings.push(`Could not position Trainee Carrier: ${error.message}`);
            });
        }
    }

    return {
        created,
        separators: SEPARATOR_SPECS.map((spec) => spec.name),
        visual_order: [
            "Head of Carriers",
            "Deputy Head of Carriers",
            "━━━ 🍺 TAVERN LEADERSHIP ━━━",
            "Recruitment Lead",
            "Training Lead",
            "Carrier Supervisor",
            "Carrier Mentor",
            "━━━ 🛡️ CARRIER MANAGEMENT ━━━",
            "Master of the Tap",
            "Brewmaster",
            "Tapmaster",
            "Caskkeeper",
            "Bartender",
            "Barback",
            "━━━ 🏆 CARRIER PROGRESSION ━━━",
            "Carrier Team",
            "Trainee Carrier",
        ],
        warnings,
    };
}

module.exports = { ensureCarrierRoleSeparators };
