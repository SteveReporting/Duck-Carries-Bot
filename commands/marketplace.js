const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const crypto = require("crypto");

const { getSupabase } = require("../marketplace/supabase");

const MAX_GOLD = 9_000_000_000_000_000;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const GOLD_SUFFIXES = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  t: 1_000_000_000_000,
};
const ALLOWED_PROOF_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function parseGold(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase().replace(/gold|g\b/g, "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[,\s_]/g, "");
  const match = /^(\d+(?:\.\d+)?)([kmbt])?$/.exec(cleaned);
  if (!match) return null;

  const base = Number.parseFloat(match[1]);
  const multiplier = match[2] ? GOLD_SUFFIXES[match[2]] : 1;
  const total = Math.floor(base * multiplier);

  if (!Number.isFinite(total) || total < 0 || total > MAX_GOLD) return null;
  return total;
}

function formatGold(value) {
  return Number(value).toLocaleString("en-US");
}

function marketplaceBaseUrl() {
  const value = (process.env.MARKETPLACE_URL || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

async function getLinkedProfile(supabase, discordId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_username, discord_display_name")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (error) throw new Error(`Could not check your marketplace account: ${error.message}`);
  return data;
}

async function findCatalogueItem(supabase, itemName) {
  const { data, error } = await supabase
    .from("items")
    .select("id, name")
    .ilike("name", itemName)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

function validateDiscordAttachment(attachment) {
  if (!attachment) return null;
  if (attachment.size > MAX_PROOF_BYTES) {
    throw new Error("Proof image must be 5 MB or smaller.");
  }

  const contentType = (attachment.contentType || "").toLowerCase();
  const extension = ALLOWED_PROOF_TYPES.get(contentType);
  if (!extension) {
    throw new Error("Proof must be a PNG, JPEG, WebP or GIF image.");
  }

  const url = new URL(attachment.url);
  const trustedHost =
    url.protocol === "https:" &&
    (url.hostname === "cdn.discordapp.com" ||
      url.hostname.endsWith(".discordapp.com") ||
      url.hostname === "media.discordapp.net");
  if (!trustedHost) {
    throw new Error("Discord returned an unexpected attachment URL.");
  }

  return { contentType, extension, url: url.toString() };
}

async function uploadProof(supabase, profileId, attachment) {
  const validated = validateDiscordAttachment(attachment);
  if (!validated) return null;

  const response = await fetch(validated.url, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Could not download the proof image from Discord.");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PROOF_BYTES) {
    throw new Error("The downloaded proof image was invalid or too large.");
  }

  const path = `${profileId}/${crypto.randomUUID()}.${validated.extension}`;
  const { error } = await supabase.storage
    .from("proof-images")
    .upload(path, bytes, {
      contentType: validated.contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw new Error(`Proof upload failed: ${error.message}`);
  return path;
}

async function requireProfile(interaction, supabase) {
  const profile = await getLinkedProfile(supabase, interaction.user.id);
  if (profile) return profile;

  const baseUrl = marketplaceBaseUrl();
  const linkText = baseUrl ? `\nSign in with Discord first: ${baseUrl}/auth` : "";
  await interaction.editReply(
    `❌ Your Discord account is not linked to a Tavern Marketplace profile.${linkText}`,
  );
  return null;
}

async function addListing(interaction, supabase, profile) {
  const itemName = interaction.options.getString("item", true).trim();
  const priceInput = interaction.options.getString("price", true);
  const quantity = interaction.options.getInteger("quantity") ?? 1;
  const potentialInput = interaction.options.getString("potential");
  const stats = interaction.options.getString("stats")?.trim() || null;
  const notes = interaction.options.getString("notes")?.trim() || null;
  const proof = interaction.options.getAttachment("proof");

  const price = parseGold(priceInput);
  if (price === null || price <= 0) {
    await interaction.editReply("❌ Invalid price. Examples: `250k`, `1.5m`, `3b`. ");
    return;
  }

  const potential = potentialInput ? parseGold(potentialInput) : null;
  if (potentialInput && potential === null) {
    await interaction.editReply("❌ Invalid potential. Examples: `250k`, `1.2m`.");
    return;
  }

  const catalogueItem = await findCatalogueItem(supabase, itemName);
  let proofPath = null;

  try {
    proofPath = await uploadProof(supabase, profile.id, proof);
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`);
    return;
  }

  const { data, error } = await supabase
    .from("listings")
    .insert({
      seller_id: profile.id,
      item_id: catalogueItem?.id ?? null,
      item_name: catalogueItem?.name ?? itemName,
      price_gold: price,
      quantity,
      potential,
      stats_text: stats,
      description: notes,
      proof_image_url: proofPath,
      source: "discord",
      status: "available",
    })
    .select("id, item_name, price_gold, quantity, potential")
    .single();

  if (error) {
    if (proofPath) {
      await supabase.storage.from("proof-images").remove([proofPath]).catch(() => {});
    }
    throw new Error(`Could not create the listing: ${error.message}`);
  }

  const baseUrl = marketplaceBaseUrl();
  const listingUrl = baseUrl ? `${baseUrl}/market/${data.id}` : null;

  const embed = new EmbedBuilder()
    .setTitle("🍺 Marketplace Listing Created")
    .setDescription(`**${data.item_name}** is now live on The Carry Tavern Marketplace.`)
    .addFields(
      { name: "💰 Price", value: `${formatGold(data.price_gold)} gold`, inline: true },
      { name: "📦 Quantity", value: String(data.quantity), inline: true },
      {
        name: "⭐ Potential",
        value: data.potential == null ? "Not set" : formatGold(data.potential),
        inline: true,
      },
      { name: "Listing ID", value: `\`${data.id}\`` },
    );

  if (listingUrl) embed.setURL(listingUrl);
  await interaction.editReply({ embeds: [embed] });
}

async function listMine(interaction, supabase, profile) {
  const { data, error } = await supabase
    .from("listings")
    .select("id, item_name, price_gold, quantity, status, created_at")
    .eq("seller_id", profile.id)
    .in("status", ["available", "reserved"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(`Could not load your listings: ${error.message}`);
  if (!data?.length) {
    await interaction.editReply("You do not have any active marketplace listings.");
    return;
  }

  const lines = data.map(
    (listing) =>
      `**${listing.item_name}** — ${formatGold(listing.price_gold)} gold × ${listing.quantity} — ${listing.status}\n\`${listing.id}\``,
  );

  const embed = new EmbedBuilder()
    .setTitle("🍺 Your Tavern Listings")
    .setDescription(lines.join("\n\n"));

  await interaction.editReply({ embeds: [embed] });
}

async function removeListing(interaction, supabase, profile) {
  const listingId = interaction.options.getString("listing", true).trim();

  const { data: listing, error: readError } = await supabase
    .from("listings")
    .select("id, item_name, status")
    .eq("id", listingId)
    .eq("seller_id", profile.id)
    .maybeSingle();

  if (readError) throw new Error(`Could not check that listing: ${readError.message}`);
  if (!listing) {
    await interaction.editReply("❌ I could not find one of your listings with that ID.");
    return;
  }
  if (listing.status !== "available") {
    await interaction.editReply(
      `❌ **${listing.item_name}** is currently \`${listing.status}\` and cannot be removed through Discord.`,
    );
    return;
  }

  const { error } = await supabase
    .from("listings")
    .update({ status: "removed" })
    .eq("id", listing.id)
    .eq("seller_id", profile.id)
    .eq("status", "available");

  if (error) throw new Error(`Could not remove the listing: ${error.message}`);
  await interaction.editReply(`✅ Removed **${listing.item_name}** from the marketplace.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("marketplace")
    .setDescription("Manage your Carry Tavern Marketplace listings")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("List an item on the marketplace")
        .addStringOption((option) =>
          option
            .setName("item")
            .setDescription("Item name")
            .setRequired(true)
            .setMaxLength(120),
        )
        .addStringOption((option) =>
          option
            .setName("price")
            .setDescription("Price in gold, e.g. 250k, 1.5m, 3b")
            .setRequired(true)
            .setMaxLength(32),
        )
        .addIntegerOption((option) =>
          option
            .setName("quantity")
            .setDescription("How many are for sale")
            .setMinValue(1)
            .setMaxValue(999),
        )
        .addStringOption((option) =>
          option
            .setName("potential")
            .setDescription("Optional potential, e.g. 250k")
            .setMaxLength(32),
        )
        .addStringOption((option) =>
          option
            .setName("stats")
            .setDescription("Optional item stats")
            .setMaxLength(1000),
        )
        .addStringOption((option) =>
          option
            .setName("notes")
            .setDescription("Optional notes for buyers")
            .setMaxLength(1000),
        )
        .addAttachmentOption((option) =>
          option
            .setName("proof")
            .setDescription("Optional proof screenshot"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("mine")
        .setDescription("Show your active marketplace listings"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove one of your available listings")
        .addStringOption((option) =>
          option
            .setName("listing")
            .setDescription("Listing UUID from /marketplace mine")
            .setRequired(true)
            .setMinLength(36)
            .setMaxLength(36),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let supabase;
    try {
      supabase = getSupabase();
    } catch (error) {
      await interaction.editReply(`❌ ${error.message}`);
      return;
    }

    try {
      const profile = await requireProfile(interaction, supabase);
      if (!profile) return;

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "add") return await addListing(interaction, supabase, profile);
      if (subcommand === "mine") return await listMine(interaction, supabase, profile);
      if (subcommand === "remove") return await removeListing(interaction, supabase, profile);
    } catch (error) {
      console.error("[MARKETPLACE]", error);
      await interaction.editReply(
        "❌ The marketplace request failed. Nothing was changed. Check the bot logs for details.",
      );
    }
  },
};
