const { PermissionFlagsBits } = require("discord.js");

const SEPARATOR_SPECS = [
    { key: "leadership", name: "━━━ 🍺 TAVERN LEADERSHIP ━━━" },
    { key: "management", name: "━━━ 🛡️ CARRIER MANAGEMENT ━━━" },
    { key: "progression", name: "━━━ 🏆 CARRIER PROGRESSION ━━━" },
    { key: "additional", name: "━━━ ➕ ADDITIONAL ROLES ━━━" },
];

const OBSOLETE_SEPARATOR_NAMES = [
    "━━━ 🔔 PINGS ━━━",
    "━━━ 📈 LEVELS ━━━",
];

const HOISTED_CARRIER_ROLES = [
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

const VISUAL_ORDER = [
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

function detectMiscRoleObjects(guild) {
    return [...guild.roles.cache.values()]
        .filter((role) => role.id !== guild.id && !role.managed)
        .filter((role) => {
            const name = String(role.name || "");
            const normalized = normalizeName(name);
            const isLevel = /^\s*(?:[^a-z0-9]*\s*)?lvl\s*\d+/i.test(name);
            const isPing = /\bping\b/i.test(name);
            const isSeparator = SEPARATOR_SPECS.some((spec) => normalizeName(spec.name) === normalized);
            return !isSeparator && (isLevel || isPing);
        })
        .sort((a, b) => b.position - a.position);
}

function detectMiscRoles(guild) {
    return detectMiscRoleObjects(guild).map((role) => role.name);
}

async function ensureCarrierRoleSeparators(interaction) {
    const guild = interaction.guild;
    const botMember = guild.members.me;
    const reason = `Carrier/server role separators requested by ${interaction.user.tag}`;

    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error("The bot needs Manage Roles to create role separators.");
    }

    const created = [];
    const deletedObsolete = [];
    const hoistedRoles = [];
    const warnings = [];

    for (const obsoleteName of OBSOLETE_SEPARATOR_NAMES) {
        const obsolete = findRole(guild, obsoleteName);
        if (!obsolete) continue;

        if (botMember.roles.highest.comparePositionTo(obsolete) <= 0) {
            warnings.push(`${obsolete.name} is above the bot and could not be removed.`);
            continue;
        }

        try {
            await obsolete.delete(`Obsolete role separator replaced by Additional Roles by ${interaction.user.tag}`);
            deletedObsolete.push(obsoleteName);
        } catch (error) {
            warnings.push(`Could not delete obsolete separator ${obsolete.name}: ${error.message}`);
        }
    }

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
    }

    // Display every real Carrier management/progression/access role separately
    // in Discord's member list. Separator roles remain non-hoisted.
    for (const roleName of HOISTED_CARRIER_ROLES) {
        const role = findRole(guild, roleName);
        if (!role) continue;
        if (botMember.roles.highest.comparePositionTo(role) <= 0) {
            warnings.push(`${role.name} is above the bot and its member-list display setting could not be changed.`);
            continue;
        }
        try {
            if (!role.hoist) await role.setHoist(true, reason);
            hoistedRoles.push(role.name);
        } catch (error) {
            warnings.push(`Could not enable member-list display for ${role.name}: ${error.message}`);
        }
    }

    // Only the Additional Roles separator is auto-positioned. The misc roles
    // themselves are never moved. Put the separator one slot above the highest
    // detected level/ping role so it visually labels the whole misc section.
    const additional = findRole(guild, "━━━ ➕ ADDITIONAL ROLES ━━━");
    const miscRoles = detectMiscRoleObjects(guild);
    let additionalPositioned = false;
    if (additional && miscRoles.length && botMember.roles.highest.comparePositionTo(additional) > 0) {
        const highestMisc = miscRoles[0];
        const target = highestMisc.position + 1;
        if (target < botMember.roles.highest.position) {
            try {
                await additional.setPosition(target, { reason });
                additionalPositioned = true;
            } catch (error) {
                warnings.push(`Could not place Additional Roles above ${highestMisc.name}: ${error.message}`);
            }
        } else {
            warnings.push(`Additional Roles could not be placed above ${highestMisc.name} because that position is too close to or above the bot role.`);
        }
    }

    return {
        created,
        deleted_obsolete: deletedObsolete,
        hoisted_roles: hoistedRoles,
        separators: SEPARATOR_SPECS.map((spec) => spec.name),
        visual_order: VISUAL_ORDER,
        hierarchy_changed: false,
        detected_misc_roles: detectMiscRoles(guild),
        additional_separator_positioned: additionalPositioned,
        warnings,
    };
}

async function positionCarrierHierarchy(interaction, anchorRole) {
    const guild = interaction.guild;
    const botMember = guild.members.me;
    const reason = `Carrier hierarchy repair requested by ${interaction.user.tag}`;

    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        throw new Error("The bot needs Manage Roles to repair the Carrier hierarchy.");
    }

    if (!anchorRole || anchorRole.id === guild.id) {
        throw new Error("Choose a real server role as the anchor.");
    }

    await ensureCarrierRoleSeparators(interaction);

    const orderedRoles = VISUAL_ORDER.map((name) => findRole(guild, name));
    const missing = VISUAL_ORDER.filter((name, index) => !orderedRoles[index]);
    if (missing.length) {
        throw new Error(`Cannot repair hierarchy because these roles are missing: ${missing.join(", ")}`);
    }

    if (orderedRoles.some((role) => role.id === anchorRole.id)) {
        throw new Error("The anchor must be an existing non-Carrier role above the Carrier block, not one of the Carrier Department roles.");
    }

    const botHighest = botMember.roles.highest;
    if (anchorRole.position > botHighest.position && anchorRole.id !== botHighest.id) {
        throw new Error(`The anchor ${anchorRole.name} is above the bot's highest role. Choose the bot role itself or another role below it.`);
    }

    if (anchorRole.position - VISUAL_ORDER.length < 1) {
        throw new Error("That anchor is too low in the hierarchy to fit the full Carrier block beneath it. Choose a higher anchor role.");
    }

    for (const role of orderedRoles) {
        if (botHighest.comparePositionTo(role) <= 0) {
            throw new Error(`${role.name} is at or above the bot's highest role and cannot be moved safely.`);
        }
    }

    for (let pass = 0; pass < 2; pass += 1) {
        let previous = guild.roles.cache.get(anchorRole.id) || anchorRole;

        for (const roleName of VISUAL_ORDER) {
            const role = findRole(guild, roleName);
            const target = Math.max(1, previous.position - 1);
            await role.setPosition(target, { reason });
            previous = role;
        }
    }

    return {
        anchor: { id: anchorRole.id, name: anchorRole.name },
        visual_order: VISUAL_ORDER,
        moved_roles: VISUAL_ORDER.length,
        note: "Only Carrier Department/progression/separator roles were explicitly moved. Unrelated roles retained their relative order.",
    };
}

module.exports = {
    ensureCarrierRoleSeparators,
    positionCarrierHierarchy,
    detectMiscRoles,
    VISUAL_ORDER,
};
