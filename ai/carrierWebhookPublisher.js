const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const BRAND = {
    name: "The Carry Tavern",
    colour: 0xF2B705,
    footer: "The Carry Tavern • Carrier Department",
};

const LINKS = {
    orbat: "https://docs.google.com/spreadsheets/d/119xodlgCqI53utupRWxyIrVy9HG-q5Yky1RAKCrcX3s/edit?usp=drivesdk",
    governance: "https://docs.google.com/document/d/1zDwtqoi8r4XwP6dlNeorwmk5sN7vKZWCb_xmccyGtV4/edit?usp=drivesdk",
    recruitment: "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk",
    management: "https://docs.google.com/document/d/14hrTRmQGagid2QU96nM37dATmPqn3e0-GzN5DwZUxiY/edit?usp=drivesdk",
    reporting: "https://docs.google.com/document/d/1BlSZgaPnL1H9y_4MFmVLd2RjWb5baJMJ1TepXn9LWnE/edit?usp=drivesdk",
    forms: "https://docs.google.com/document/d/1ABQsN3d6T3LWCra5f_1tgTqAgywQ06CBReozKGWDqiE/edit?usp=drivesdk",
    launch: "https://docs.google.com/document/d/1K4TqxPe818xWF9jT16FDanoHh68DNYG8cNQNdkR0OQY/edit?usp=drivesdk",
    control: "https://docs.google.com/spreadsheets/d/14wzmRRKKH3abkdR08lH512h2erMDF67jsv-oXzUUbJA/edit?usp=drivesdk",
    bloxlink: "https://blox.link/",
    carlbot: "https://carl.gg/",
    appy: "https://appy.bot/discord-form-bot",
    statbot: "https://statbot.net/",
};

function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findRole(guild, name) {
    const wanted = normalizeName(name);
    return guild.roles.cache.find((role) => !role.managed && normalizeName(role.name) === wanted) || null;
}

function findCarrierCategory(guild) {
    return guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildCategory && normalizeName(channel.name) === "carrierteam"
    ) || null;
}

function findTextChannel(category, guild, name) {
    const wanted = normalizeName(name);
    return guild.channels.cache.find((channel) =>
        channel.type === ChannelType.GuildText &&
        channel.parentId === category.id &&
        normalizeName(channel.name) === wanted
    ) || null;
}

function linkButton(label, url, emoji) {
    const button = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(label)
        .setURL(url);
    if (emoji) button.setEmoji(emoji);
    return button;
}

function rowsFromButtons(buttons) {
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
    }
    return rows;
}

function embed(title, description, tag) {
    return new EmbedBuilder()
        .setColor(BRAND.colour)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: `${BRAND.footer} • ${tag}` })
        .setTimestamp();
}

async function attachmentBuffer(attachment) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Could not download webhook avatar (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
}

async function getBrandedWebhook(channel, avatarBuffer, reason) {
    const guild = channel.guild;
    const botMember = guild.members.me;
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageWebhooks)) {
        throw new Error("The bot needs Manage Webhooks to publish branded Carrier posts.");
    }

    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find((item) => item.owner?.id === botMember.id && item.name === BRAND.name) || null;

    if (!webhook) {
        webhook = await channel.createWebhook({
            name: BRAND.name,
            avatar: avatarBuffer,
            reason,
        });
    } else {
        await webhook.edit({ name: BRAND.name, avatar: avatarBuffer, reason }).catch(() => {});
    }

    return webhook;
}

async function clearTagged(channel, tag) {
    const marker = `${BRAND.footer} • ${tag}`;
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recent) return 0;

    let removed = 0;
    for (const message of recent.values()) {
        if (!message.webhookId) continue;
        const tagged = message.embeds.some((item) => item.footer?.text === marker);
        if (!tagged) continue;
        await message.delete().catch(() => {});
        removed += 1;
    }
    return removed;
}

async function publish(channel, avatarBuffer, payload, { pin = false, replace = true, reason, tag }) {
    if (replace) await clearTagged(channel, tag);
    const webhook = await getBrandedWebhook(channel, avatarBuffer, reason);
    const sent = await webhook.send(payload);

    if (pin) {
        await channel.messages.pin(sent.id, reason).catch(() => {});
    }

    return sent;
}

function channelLink(guildId, channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
}

function makeChannelPayloads(guild, channels) {
    const carrierGuideButtons = rowsFromButtons([
        linkButton("Live ORBAT", LINKS.orbat, "📊"),
        linkButton("Governance", LINKS.governance, "🛡️"),
        linkButton("Recruitment SOP", LINKS.recruitment, "🎓"),
        linkButton("Management SOP", LINKS.management, "⚖️"),
        linkButton("Forms", LINKS.forms, "📝"),
        linkButton("Control Sheet", LINKS.control, "📈"),
    ]);

    const managementButtons = rowsFromButtons([
        linkButton("Live ORBAT", LINKS.orbat, "📊"),
        linkButton("Governance", LINKS.governance, "🛡️"),
        linkButton("Management SOP", LINKS.management, "⚖️"),
        linkButton("Reporting Pack", LINKS.reporting, "📋"),
        linkButton("Control Sheet", LINKS.control, "📈"),
        linkButton("Forms", LINKS.forms, "📝"),
    ]);

    const channelPayloads = [
        {
            key: "become-a-carrier",
            tag: "channel-become-v1",
            pin: true,
            embeds: [embed(
                "⚔️ Become a Carrier",
                [
                    "Welcome to **The Carry Tavern Carrier Recruitment**.",
                    "",
                    "Our Carrier Team provides completely free Dungeon Quest carries to the community. New applicants now follow a structured recruitment, training and probation process.",
                    "",
                    "**📋 Recruitment Path**",
                    "`Application → Review → Interview if required → Trainee Carrier → Training → Practical Assessment → 7-Day Probation → Full Carrier`",
                    "",
                    "**🍺 Free Carry Policy**",
                    "Official Tavern carries are **completely free**. Carriers may never demand Robux, gold, items, gifts or payment of any kind.",
                    "",
                    "**✅ What We Look For**",
                    "Reliable • Mature • Helpful • Capable • Communicative • Willing to learn",
                    "",
                    "Do not repeatedly DM management asking for an application review.",
                ].join("\n"),
                "channel-become-v1"
            )],
            components: rowsFromButtons([
                linkButton("Recruitment & Training SOP", LINKS.recruitment, "🎓"),
                linkButton("Carrier Handbook Resources", LINKS.governance, "📚"),
            ]),
        },
        {
            key: "bartender-chat",
            tag: "channel-chat-v1",
            pin: true,
            embeds: [embed(
                "🍺 Carrier Team Chat",
                [
                    "This is the main private chat for members of **The Carry Tavern Carrier Team**.",
                    "",
                    "Use it for general Carrier discussion, dungeon questions, team coordination and helping other Carriers.",
                    "",
                    "**This is not a disciplinary channel.** Sensitive reports or complaints belong in the proper management process rather than being argued about here.",
                    "",
                    "Represent the Tavern properly, keep disagreements civil and help each other where possible.",
                ].join("\n"),
                "channel-chat-v1"
            )],
        },
        {
            key: "carrier-news",
            tag: "channel-news-v1",
            pin: true,
            embeds: [embed(
                "📢 Carrier News",
                [
                    "Official information from **Carrier Leadership and Tavern Management** is posted here.",
                    "",
                    "Expect management appointments, policy changes, training updates, recruitment changes, queue/system updates, Carrier milestones and maintenance notices.",
                    "",
                    "Carriers are expected to keep up with important information posted here. If an announcement changes a procedure, the newest announcement and current handbook take priority over outdated instructions.",
                ].join("\n"),
                "channel-news-v1"
            )],
        },
        {
            key: "carrier-guide",
            tag: "channel-guide-v1",
            pin: true,
            embeds: [embed(
                "📚 Carrier Department Library",
                [
                    "The central documentation hub for **The Carry Tavern Carrier Department**.",
                    "",
                    "**⚔️ Core Documents**",
                    "• Carrier Department ORBAT",
                    "• Governance & Authority",
                    "• Recruitment, Training & Probation SOP",
                    "• Management, Discipline & Appeals SOP",
                    "• Forms & Operational Templates",
                    "• Carrier Department Control Sheet",
                    "",
                    "**⏱️ Verified Service Time**",
                    "A Ready Check does **not** start verified service time. The Carrier must use **▶ Start Carry**.",
                    "",
                    "Grouped carries record actual wall-clock carrying time once. Carrying five people for 30 minutes is **30 verified minutes**, not 150.",
                ].join("\n"),
                "channel-guide-v1"
            )],
            components: carrierGuideButtons,
        },
        {
            key: "carrier-leaderboard",
            tag: "channel-leaderboard-v1",
            pin: true,
            embeds: [embed(
                "🏅 Carrier Leaderboard",
                [
                    "This channel tracks Carrier contribution through verified service time, completed carries, dungeon runs, Carrier rank and activity.",
                    "",
                    "The leaderboard exists to recognise contribution. It is **not** permission to fake service time, rush members, farm meaningless runs or abuse grouped carries.",
                    "",
                    "Quality, reliability and conduct matter just as much as numbers. Management positions are not awarded purely from leaderboard placement.",
                ].join("\n"),
                "channel-leaderboard-v1"
            )],
        },
        {
            key: "carrier-training",
            tag: "channel-training-v1",
            pin: true,
            embeds: [embed(
                "🎓 Carrier Training Centre",
                [
                    "Every **Trainee Carrier** must complete the training programme before receiving full Carrier access.",
                    "",
                    "**📚 Modules**",
                    "I • Carrier Conduct",
                    "II • Carry Queue",
                    "III • Ready Checks",
                    "IV • Starting a Carry",
                    "V • Running Carries",
                    "VI • Verified Service Time",
                    "VII • Practical Assessment",
                    "",
                    "**⚔️ Practical Assessment**",
                    "Gameplay **/5** • Communication **/5** • System Knowledge **/5** • Conduct **/5**",
                    "",
                    "**Pass requirement: 16/20**",
                    "",
                    "Passing moves the Trainee into a **7-day probation period**.",
                ].join("\n"),
                "channel-training-v1"
            )],
            components: rowsFromButtons([
                linkButton("Training SOP", LINKS.recruitment, "🎓"),
                linkButton("Training Forms", LINKS.forms, "📝"),
            ]),
        },
        {
            key: "training-reports",
            tag: "channel-training-reports-v1",
            pin: true,
            embeds: [embed(
                "📝 Training Reports",
                [
                    "Use a consistent report for every Trainee.",
                    "",
                    "**Training ID:** `TRN-2026-___`",
                    "**Trainee:**",
                    "**Roblox:**",
                    "**Mentor:**",
                    "**Date:**",
                    "",
                    "**Module Status**",
                    "Conduct • Queue Knowledge • Ready Check/Start Carry • Verified Time • Carry Procedure • Difficult Situations",
                    "",
                    "**Practical Assessment**",
                    "Gameplay __/5 • Communication __/5 • System Knowledge __/5 • Conduct __/5",
                    "",
                    "**Recommendation:** PASS TO PROBATION / RETRAIN / FAIL",
                ].join("\n"),
                "channel-training-reports-v1"
            )],
            components: rowsFromButtons([linkButton("Full Templates", LINKS.forms, "📝")]),
        },
        {
            key: "carrier-management",
            tag: "channel-management-v1",
            pin: true,
            embeds: [embed(
                "🛡️ Carrier Management Command",
                [
                    "Central command channel for **The Carry Tavern Carrier Department**.",
                    "",
                    "**🍺 Chain of Command**",
                    "Tavern Ownership → Head of Carriers → Deputy Head → Recruitment / Training Leads → Carrier Supervisors → Carrier Mentors → Carrier Team",
                    "",
                    "**📌 Management Principles**",
                    "• Evidence before serious punishment",
                    "• Do not handle a serious case you are personally involved in",
                    "• Friendship does not affect decisions",
                    "• Management information remains private",
                    "• Supervisors escalate rather than overstep",
                    "• Mentors train, they are not moderators",
                    "• Appeals are reviewed above the original decision-maker",
                    "• Tavern Ownership retains final authority",
                ].join("\n"),
                "channel-management-v1"
            )],
            components: managementButtons,
        },
        {
            key: "application-reviews",
            tag: "channel-app-reviews-v1",
            pin: true,
            embeds: [embed(
                "📋 Carrier Application Reviews",
                [
                    "All applications should be reviewed consistently.",
                    "",
                    "**📊 Scoring**",
                    "Capability **/5**",
                    "Reliability / Activity **/4**",
                    "Communication **/3**",
                    "Attitude / Maturity **/3**",
                    "Dungeon Knowledge **/3**",
                    "Application Effort **/2**",
                    "",
                    "**17-20:** Strong Accept",
                    "**14-16:** Accept / Trial",
                    "**11-13:** Interview / Further Review",
                    "**0-10:** Normally Deny",
                    "",
                    "Use IDs such as **APP-2026-001** and record the reviewer, score, interview requirement, decision, reasoning and next action.",
                ].join("\n"),
                "channel-app-reviews-v1"
            )],
            components: rowsFromButtons([
                linkButton("Recruitment SOP", LINKS.recruitment, "📋"),
                linkButton("Review Templates", LINKS.forms, "📝"),
            ]),
        },
        {
            key: "carrier-reports",
            tag: "channel-reports-v1",
            pin: true,
            embeds: [embed(
                "⚠️ Carrier Reports & Case Management",
                [
                    "This channel contains private Carrier conduct and disciplinary cases. Do not discuss cases outside authorised management areas.",
                    "",
                    "Use IDs such as **CAR-2026-001**.",
                    "",
                    "**Case Record**",
                    "Reported Carrier • Reporter • Date • Assigned Manager • Issue • Evidence • Response • Findings • Action • Status",
                    "",
                    "**Actions**",
                    "No Action • Informal Coaching • Carrier Warning • Final Warning • Suspension • Removal",
                    "",
                    "**Statuses**",
                    "OPEN • INVESTIGATING • AWAITING RESPONSE • RESOLVED • APPEALED • CLOSED",
                    "",
                    "**Appeals**",
                    "Supervisor → Deputy / Head • Lead → Deputy / Head • Head → Tavern Ownership",
                ].join("\n"),
                "channel-reports-v1"
            )],
            components: rowsFromButtons([
                linkButton("Discipline SOP", LINKS.management, "⚖️"),
                linkButton("Case Templates", LINKS.forms, "📝"),
            ]),
        },
    ];

    return channelPayloads;
}

function botResourcesPayload() {
    return {
        tag: "management-bot-resources-v1",
        embeds: [embed(
            "🤖 Carrier Department Bot & Resource Directory",
            [
                "Recommended services for the Carrier Department and wider Tavern setup.",
                "",
                "**Bloxlink** • Roblox verification and role linking",
                "**Appy** • Temporary application/forms option while native Tavern applications are built",
                "**Carl-bot** • Optional embeds, reaction roles and general utility",
                "**Statbot** • Optional server analytics and activity statistics",
                "",
                "Duck Carries Bot remains the primary system for the carry queue, Carrier timers, verified service time and department automation.",
            ].join("\n"),
            "management-bot-resources-v1"
        )],
        components: rowsFromButtons([
            linkButton("Bloxlink", LINKS.bloxlink, "🔗"),
            linkButton("Appy", LINKS.appy, "📝"),
            linkButton("Carl-bot", LINKS.carlbot, "🤖"),
            linkButton("Statbot", LINKS.statbot, "📊"),
        ]),
    };
}

function restructurePayload(carrierRole) {
    return {
        tag: "announcement-restructure-v1",
        content: carrierRole ? `${carrierRole}` : undefined,
        allowedMentions: carrierRole ? { roles: [carrierRole.id] } : { parse: [] },
        embeds: [embed(
            "⚔️ Carrier Team Restructure",
            [
                "Carrier Team has grown massively, but the way we manage it has not grown with it.",
                "",
                "Me and Chicken have decided to reorganise Carrier Team into a properly managed department within **The Carry Tavern**.",
                "",
                "**🍺 New Structure**",
                "Tavern Ownership",
                "↓",
                "Head of Carriers",
                "↓",
                "Deputy Head of Carriers",
                "↓",
                "Recruitment Lead / Training Lead",
                "↓",
                "Carrier Supervisors",
                "↓",
                "Carrier Mentors",
                "↓",
                "Carrier Team",
                "",
                "**🏆 Progression Ranks Stay**",
                "Barback • Bartender • Caskkeeper • Tapmaster • Brewmaster • Master of the Tap",
                "",
                "Those ranks represent carrying experience and contribution. The new management roles represent responsibility and authority within the department.",
                "",
                "**🎓 New Recruitment Path**",
                "`Application → Review → Trainee Carrier → Training → Practical Assessment → 7-Day Probation → Full Carrier`",
                "",
                "The goal is proper training, consistent recruitment, clear leadership, fair issue handling and a structure that can continue growing without becoming a mess.",
            ].join("\n"),
            "announcement-restructure-v1"
        )],
        components: rowsFromButtons([
            linkButton("Live ORBAT", LINKS.orbat, "📊"),
            linkButton("Carrier Governance", LINKS.governance, "🛡️"),
        ]),
    };
}

function headAnnouncementPayload(headMember) {
    const mention = headMember ? `${headMember}` : "the appointed Head of Carriers";
    return {
        tag: "announcement-head-v1",
        embeds: [embed(
            "🍻 New Head of Carriers",
            [
                `As the first leadership appointment under the Carrier Team restructure, **${mention}** is being appointed as **Head of Carriers**.`,
                "",
                "The Head of Carriers oversees day-to-day Carrier Department operations, including recruitment, training, Carrier standards, department performance, internal issues and organisation.",
                "",
                "They will not be expected to do everything personally. A Deputy Head, Recruitment Lead, Training Lead, Supervisors and Mentors will operate underneath the Head.",
                "",
                "Tavern Ownership remains above the department for major decisions, serious appeals and overall direction.",
                "",
                "Now we build the management team around the new department leadership. 🍺",
            ].join("\n"),
            "announcement-head-v1"
        )],
        components: rowsFromButtons([linkButton("View Department ORBAT", LINKS.orbat, "📊")]),
    };
}

function managementApplicationsPayload(url) {
    return {
        tag: "announcement-management-apps-v1",
        embeds: [embed(
            "🛡️ Carrier Management Applications",
            [
                "Applications are now open for the first members of **Carrier Management**.",
                "",
                "**📋 Recruitment Lead** • Applications, interviews and recruitment standards",
                "**🎓 Training Lead** • Trainees, Mentors, assessments and probation",
                "**🔨 Carrier Supervisor** • Everyday Carrier operations, standards and smaller internal issues",
                "**📚 Carrier Mentor** • Training, questions and practical assessments",
                "",
                "We are looking for people who are reliable, mature, active, fair, approachable and genuinely interested in improving Carrier Team.",
                "",
                "Having the most carries or highest leaderboard position does **not** automatically make someone management material. These are working positions, not collectible roles.",
            ].join("\n"),
            "announcement-management-apps-v1"
        )],
        components: rowsFromButtons([linkButton("Apply for Carrier Management", url, "📝")]),
    };
}

function carrierApplicationsPayload(url) {
    return {
        tag: "announcement-carrier-apps-v1",
        embeds: [embed(
            "⚔️ Carrier Applications Reopened",
            [
                "Carrier recruitment is officially reopening under the new **Carrier Department system**.",
                "",
                "**📋 New Path**",
                "`Application → Management Review → Trainee Carrier → Training → Practical Assessment → 7-Day Probation → Full Carrier Team`",
                "",
                "The purpose is not to make becoming a Carrier unnecessarily difficult. We want everyone representing The Carry Tavern to understand the queue, claiming, Ready Checks, starting carries, verified service time, completing sessions and Carrier standards.",
                "",
                "**🍺 Carries remain completely free.** Carriers may never demand Robux, gold, items or payment for an official Tavern carry.",
            ].join("\n"),
            "announcement-carrier-apps-v1"
        )],
        components: rowsFromButtons([linkButton("Apply to Become a Carrier", url, "📝")]),
    };
}

function weeklyReportPayload() {
    return {
        tag: "management-weekly-report-v1",
        embeds: [embed(
            "📊 Weekly Carrier Department Report",
            [
                "**Week:**",
                "**Submitted By:** Head of Carriers",
                "",
                "**⚔️ Operations**",
                "Active Carriers • Carries Completed • Dungeon Runs • Verified Service Hours",
                "",
                "**📋 Recruitment**",
                "Applications Received • Accepted • Denied • Awaiting Review",
                "",
                "**🎓 Training**",
                "Current Trainees • Training Passed • Probation Passed • Extended • Failed/Withdrawn",
                "",
                "**🛡️ Conduct**",
                "New Cases • Warnings • Final Warnings • Suspensions • Removals • Appeals",
                "",
                "**👥 Management**",
                "Appointments • Vacancies • Inactive Management • Reviews Due",
                "",
                "**🌍 Coverage**",
                "Dungeon Coverage Problems • Timezone Coverage Problems • Queue/Demand Problems",
                "",
                "**🍺 Head Notes**",
                "Major Issues • Recommended Changes • Support Required From Tavern Ownership",
            ].join("\n"),
            "management-weekly-report-v1"
        )],
        components: rowsFromButtons([
            linkButton("Reporting Pack", LINKS.reporting, "📋"),
            linkButton("Control Sheet", LINKS.control, "📈"),
        ]),
    };
}

async function publishCarrierDepartment(interaction, options) {
    const guild = interaction.guild;
    const category = findCarrierCategory(guild);
    if (!category) throw new Error("Could not find the exact CARRIER TEAM category.");

    const botMember = guild.members.me;
    if (!botMember?.permissions?.has(PermissionFlagsBits.ManageWebhooks)) {
        throw new Error("The bot needs Manage Webhooks.");
    }

    const avatarBuffer = await attachmentBuffer(options.avatar);
    const reason = `Carrier Department webhook publish requested by ${interaction.user.tag}`;
    const channelNames = [
        "become-a-carrier",
        "bartender-chat",
        "carrier-news",
        "carrier-guide",
        "carrier-leaderboard",
        "carrier-training",
        "training-reports",
        "carrier-management",
        "application-reviews",
        "carrier-reports",
    ];
    const channels = {};
    for (const name of channelNames) channels[name] = findTextChannel(category, guild, name);

    const missing = Object.entries(channels).filter(([, channel]) => !channel).map(([name]) => name);
    if (missing.length) throw new Error(`Missing Carrier channels: ${missing.join(", ")}`);

    const result = { published: [], skipped: [] };
    const scope = options.scope || "all";

    if (scope === "all" || scope === "channels") {
        for (const item of makeChannelPayloads(guild, channels)) {
            const channel = channels[item.key];
            await publish(channel, avatarBuffer, {
                embeds: item.embeds,
                components: item.components || [],
                allowedMentions: { parse: [] },
            }, { pin: item.pin, replace: true, reason, tag: item.tag });
            result.published.push(`#${channel.name}: ${item.embeds[0].data.title}`);
        }

        const management = channels["carrier-management"];
        const bots = botResourcesPayload();
        await publish(management, avatarBuffer, {
            embeds: bots.embeds,
            components: bots.components,
            allowedMentions: { parse: [] },
        }, { pin: true, replace: true, reason, tag: bots.tag });
        result.published.push(`#${management.name}: Bot & Resource Directory`);

        const weekly = weeklyReportPayload();
        await publish(management, avatarBuffer, {
            embeds: weekly.embeds,
            components: weekly.components,
            allowedMentions: { parse: [] },
        }, { pin: true, replace: true, reason, tag: weekly.tag });
        result.published.push(`#${management.name}: Weekly Report Template`);
    }

    if (scope === "all" || scope === "launch") {
        const news = channels["carrier-news"];
        const carrierRole = findRole(guild, "Carrier Team");
        const restructure = restructurePayload(carrierRole);
        await publish(news, avatarBuffer, {
            content: restructure.content,
            embeds: restructure.embeds,
            components: restructure.components,
            allowedMentions: restructure.allowedMentions,
        }, { pin: false, replace: true, reason, tag: restructure.tag });
        result.published.push(`#${news.name}: Carrier Team Restructure`);

        let headMember = options.head || null;
        if (!headMember) {
            const headRole = findRole(guild, "Head of Carriers");
            headMember = headRole?.members?.first() || null;
        }
        const headPost = headAnnouncementPayload(headMember);
        await publish(news, avatarBuffer, {
            embeds: headPost.embeds,
            components: headPost.components,
            allowedMentions: headMember ? { users: [headMember.id] } : { parse: [] },
        }, { pin: false, replace: true, reason, tag: headPost.tag });
        result.published.push(`#${news.name}: Head of Carriers announcement`);

        if (options.managementApplicationUrl) {
            const managementApps = managementApplicationsPayload(options.managementApplicationUrl);
            await publish(news, avatarBuffer, {
                embeds: managementApps.embeds,
                components: managementApps.components,
                allowedMentions: carrierRole ? { roles: [carrierRole.id] } : { parse: [] },
            }, { pin: false, replace: true, reason, tag: managementApps.tag });
            result.published.push(`#${news.name}: Management Applications`);
        } else {
            result.skipped.push("Management Applications announcement (no management application URL supplied)");
        }

        if (options.carrierApplicationUrl) {
            const carrierApps = carrierApplicationsPayload(options.carrierApplicationUrl);
            await publish(news, avatarBuffer, {
                embeds: carrierApps.embeds,
                components: carrierApps.components,
                allowedMentions: { parse: [] },
            }, { pin: false, replace: true, reason, tag: carrierApps.tag });
            result.published.push(`#${news.name}: Carrier Applications Reopened`);
        } else {
            result.skipped.push("Carrier Applications Reopened announcement (no Carrier application URL supplied)");
        }
    }

    return result;
}

module.exports = { publishCarrierDepartment, LINKS };
