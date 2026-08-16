const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const crypto = require("crypto");

const { getSupabase } = require("../marketplace/supabase");

const MAX_GOLD = 9_000_000_000_000_000;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const GOLD_SUFFIXES = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };
const ALLOWED_PROOF_TYPES = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"]]);

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
function formatGold(value) { return Number(value).toLocaleString("en-US"); }
function marketplaceBaseUrl() { const value = (process.env.MARKETPLACE_URL || "").trim(); return value ? value.replace(/\/+$/, "") : null; }

async function getLinkedProfile(supabase, discordId) {
  const { data, error } = await supabase.from("profiles").select("id, discord_username, discord_display_name").eq("discord_id", discordId).maybeSingle();
  if (error) throw new Error(`Could not check your marketplace account: ${error.message}`);
  return data;
}
async function requireProfile(interaction, supabase) {
  const profile = await getLinkedProfile(supabase, interaction.user.id);
  if (profile) return profile;
  const baseUrl = marketplaceBaseUrl();
  await interaction.editReply(`❌ Your Discord account is not linked to a Tavern Marketplace profile.${baseUrl ? `\nSign in with Discord first: ${baseUrl}/auth` : ""}`);
  return null;
}
async function findCatalogueItem(supabase, itemName) {
  const { data } = await supabase.from("items").select("id, name").ilike("name", itemName).limit(1).maybeSingle();
  return data || null;
}
function validateDiscordAttachment(attachment) {
  if (!attachment) return null;
  if (attachment.size > MAX_PROOF_BYTES) throw new Error("Proof image must be 5 MB or smaller.");
  const contentType = (attachment.contentType || "").toLowerCase();
  const extension = ALLOWED_PROOF_TYPES.get(contentType);
  if (!extension) throw new Error("Proof must be a PNG, JPEG, WebP or GIF image.");
  const url = new URL(attachment.url);
  const trustedHost = url.protocol === "https:" && (url.hostname === "cdn.discordapp.com" || url.hostname.endsWith(".discordapp.com") || url.hostname === "media.discordapp.net");
  if (!trustedHost) throw new Error("Discord returned an unexpected attachment URL.");
  return { contentType, extension, url: url.toString() };
}
async function uploadProof(supabase, profileId, attachment) {
  const validated = validateDiscordAttachment(attachment);
  if (!validated) return null;
  const response = await fetch(validated.url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Could not download the proof image from Discord.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PROOF_BYTES) throw new Error("The downloaded proof image was invalid or too large.");
  const path = `${profileId}/${crypto.randomUUID()}.${validated.extension}`;
  const { error } = await supabase.storage.from("proof-images").upload(path, bytes, { contentType: validated.contentType, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`Proof upload failed: ${error.message}`);
  return path;
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
  if (price === null || price <= 0) return interaction.editReply("❌ Invalid price. Examples: `250k`, `1.5m`, `3b`.");
  const potential = potentialInput ? parseGold(potentialInput) : null;
  if (potentialInput && potential === null) return interaction.editReply("❌ Invalid potential. Examples: `250k`, `1.2m`.");
  const catalogueItem = await findCatalogueItem(supabase, itemName);
  let proofPath = null;
  try { proofPath = await uploadProof(supabase, profile.id, proof); } catch (error) { return interaction.editReply(`❌ ${error.message}`); }
  const { data, error } = await supabase.from("listings").insert({ seller_id: profile.id, item_id: catalogueItem?.id ?? null, item_name: catalogueItem?.name ?? itemName, price_gold: price, quantity, potential, stats_text: stats, description: notes, proof_image_url: proofPath, source: "discord", status: "available" }).select("id, item_name, price_gold, quantity, potential, expires_at").single();
  if (error) {
    if (proofPath) await supabase.storage.from("proof-images").remove([proofPath]).catch(() => {});
    throw new Error(`Could not create the listing: ${error.message}`);
  }
  const baseUrl = marketplaceBaseUrl();
  const embed = new EmbedBuilder().setTitle("🍺 Marketplace Listing Created").setDescription(`**${data.item_name}** is now live on The Carry Tavern Marketplace.`).addFields(
    { name: "💰 Price", value: `${formatGold(data.price_gold)} gold`, inline: true },
    { name: "📦 Quantity", value: String(data.quantity), inline: true },
    { name: "⭐ Potential", value: data.potential == null ? "Not set" : formatGold(data.potential), inline: true },
    { name: "Listing ID", value: `\`${data.id}\`` },
  );
  if (baseUrl) embed.setURL(`${baseUrl}/market/${data.id}`);
  return interaction.editReply({ embeds: [embed] });
}

async function listMine(interaction, supabase, profile) {
  const { data, error } = await supabase.from("listings").select("id, item_name, price_gold, quantity, status, expires_at, created_at").eq("seller_id", profile.id).in("status", ["available", "reserved"]).order("created_at", { ascending: false }).limit(10);
  if (error) throw new Error(`Could not load your listings: ${error.message}`);
  if (!data?.length) return interaction.editReply("You do not have any active marketplace listings.");
  const lines = data.map((listing) => `**${listing.item_name}** — ${formatGold(listing.price_gold)} gold × ${listing.quantity} — ${listing.status}${listing.expires_at ? `\nExpires <t:${Math.floor(new Date(listing.expires_at).getTime() / 1000)}:R>` : ""}\n\`${listing.id}\``);
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("🍺 Your Tavern Listings").setDescription(lines.join("\n\n"))] });
}

async function removeListing(interaction, supabase, profile) {
  const listingId = interaction.options.getString("listing", true).trim();
  const { data: listing, error: readError } = await supabase.from("listings").select("id, item_name, status").eq("id", listingId).eq("seller_id", profile.id).maybeSingle();
  if (readError) throw new Error(`Could not check that listing: ${readError.message}`);
  if (!listing) return interaction.editReply("❌ I could not find one of your listings with that ID.");
  if (listing.status !== "available") return interaction.editReply(`❌ **${listing.item_name}** is currently \`${listing.status}\` and cannot be removed through Discord.`);
  const { error } = await supabase.from("listings").update({ status: "removed" }).eq("id", listing.id).eq("seller_id", profile.id).eq("status", "available");
  if (error) throw new Error(`Could not remove the listing: ${error.message}`);
  return interaction.editReply(`✅ Removed **${listing.item_name}** from the marketplace.`);
}

async function searchListings(interaction, supabase) {
  const query = interaction.options.getString("item", true).trim();
  const maxPriceInput = interaction.options.getString("max-price");
  const maxPrice = maxPriceInput ? parseGold(maxPriceInput) : null;
  if (maxPriceInput && maxPrice === null) return interaction.editReply("❌ Invalid max price.");
  let request = supabase.from("listings").select("id,item_name,price_gold,quantity,potential,expires_at").eq("status", "available").gt("quantity", 0).ilike("item_name", `%${query}%`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order("price_gold", { ascending: true }).limit(10);
  if (maxPrice != null) request = request.lte("price_gold", maxPrice);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  if (!data?.length) return interaction.editReply(`No active listings found for **${query}**.`);
  const base = marketplaceBaseUrl();
  const lines = data.map((l) => `**${l.item_name}** — ${formatGold(l.price_gold)} gold × ${l.quantity}${l.potential ? ` · potential ${formatGold(l.potential)}` : ""}\n${base ? `${base}/market/${l.id}` : `\`${l.id}\``}`);
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔎 Marketplace: ${query}`).setDescription(lines.join("\n\n").slice(0, 4000))] });
}

async function makeOffer(interaction, supabase, profile) {
  const listingId = interaction.options.getString("listing", true).trim();
  const amount = parseGold(interaction.options.getString("amount", true));
  const quantity = interaction.options.getInteger("quantity") ?? 1;
  const message = interaction.options.getString("message")?.trim() || null;
  if (!amount || amount <= 0) return interaction.editReply("❌ Invalid offer amount.");
  const { data: listing, error } = await supabase.from("listings").select("id,seller_id,item_name,quantity,status,expires_at").eq("id", listingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!listing || listing.status !== "available" || listing.quantity < quantity || (listing.expires_at && new Date(listing.expires_at) <= new Date())) return interaction.editReply("❌ That listing is no longer available in the requested quantity.");
  if (listing.seller_id === profile.id) return interaction.editReply("❌ You cannot make an offer on your own listing.");
  const { data: offer, error: offerError } = await supabase.from("offers").insert({ listing_id: listing.id, buyer_id: profile.id, seller_id: listing.seller_id, proposed_by: profile.id, offer_gold: amount, quantity, message, status: "pending", expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() }).select("id").single();
  if (offerError) throw new Error(`Could not create offer: ${offerError.message}`);
  const base = marketplaceBaseUrl();
  return interaction.editReply(`✅ Offered **${formatGold(amount)} gold × ${quantity}** on **${listing.item_name}**.\nOffer ID: \`${offer.id}\`${base ? `\nManage offers: ${base}/market/${listing.id}/offers` : ""}`);
}

async function listOffers(interaction, supabase, profile) {
  const { data, error } = await supabase.from("offers").select("id,listing_id,buyer_id,seller_id,proposed_by,offer_gold,quantity,status,created_at,listing:listings(item_name)").or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`).order("created_at", { ascending: false }).limit(15);
  if (error) throw new Error(error.message);
  if (!data?.length) return interaction.editReply("You have no marketplace offers yet.");
  const base = marketplaceBaseUrl();
  const lines = data.map((o) => `**${o.listing?.item_name || "Listing"}** — ${formatGold(o.offer_gold)} gold × ${o.quantity ?? 1} — ${o.status}\n${o.proposed_by === profile.id ? "You proposed" : "Other party proposed"} · \`${o.id}\`${base ? `\n${base}/market/${o.listing_id}/offers` : ""}`);
  return interaction.editReply({ embeds: [new EmbedBuilder().setTitle("💬 Your Marketplace Offers").setDescription(lines.join("\n\n").slice(0, 4000))] });
}

async function watchListing(interaction, supabase, profile) {
  const listingId = interaction.options.getString("listing", true).trim();
  const { data: listing, error } = await supabase.from("listings").select("id,item_name,status").eq("id", listingId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!listing) return interaction.editReply("❌ Listing not found.");
  const { data: existing } = await supabase.from("listing_watchlist").select("listing_id").eq("user_id", profile.id).eq("listing_id", listingId).maybeSingle();
  if (existing) {
    const { error: removeError } = await supabase.from("listing_watchlist").delete().eq("user_id", profile.id).eq("listing_id", listingId);
    if (removeError) throw new Error(removeError.message);
    return interaction.editReply(`🔕 Removed **${listing.item_name}** from your watchlist.`);
  }
  const { error: addError } = await supabase.from("listing_watchlist").insert({ user_id: profile.id, listing_id: listingId });
  if (addError) throw new Error(addError.message);
  return interaction.editReply(`🔔 Watching **${listing.item_name}**. You will be notified when its price changes.`);
}

async function renewListing(interaction, supabase, profile) {
  const listingId = interaction.options.getString("listing", true).trim();
  const { data: listing, error } = await supabase.from("listings").select("id,item_name,status,quantity").eq("id", listingId).eq("seller_id", profile.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!listing || listing.status !== "available" || listing.quantity < 1) return interaction.editReply("❌ That listing cannot be renewed.");
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  const { error: updateError } = await supabase.from("listings").update({ expires_at: expires }).eq("id", listing.id).eq("seller_id", profile.id);
  if (updateError) throw new Error(updateError.message);
  return interaction.editReply(`✅ Renewed **${listing.item_name}** for another 30 days.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("marketplace").setDescription("Use the Carry Tavern Marketplace")
    .addSubcommand((s) => s.setName("add").setDescription("List an item on the marketplace")
      .addStringOption((o) => o.setName("item").setDescription("Item name").setRequired(true).setMaxLength(120))
      .addStringOption((o) => o.setName("price").setDescription("Price in gold, e.g. 250k, 1.5m, 3b").setRequired(true).setMaxLength(32))
      .addIntegerOption((o) => o.setName("quantity").setDescription("How many are for sale").setMinValue(1).setMaxValue(999))
      .addStringOption((o) => o.setName("potential").setDescription("Optional potential, e.g. 250k").setMaxLength(32))
      .addStringOption((o) => o.setName("stats").setDescription("Optional item stats").setMaxLength(1000))
      .addStringOption((o) => o.setName("notes").setDescription("Optional notes for buyers").setMaxLength(1000))
      .addAttachmentOption((o) => o.setName("proof").setDescription("Optional proof screenshot")))
    .addSubcommand((s) => s.setName("mine").setDescription("Show your active marketplace listings"))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove one of your available listings").addStringOption((o) => o.setName("listing").setDescription("Listing UUID from /marketplace mine").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("search").setDescription("Search active marketplace listings").addStringOption((o) => o.setName("item").setDescription("Item name or part of it").setRequired(true).setMaxLength(120)).addStringOption((o) => o.setName("max-price").setDescription("Optional maximum price, e.g. 2b").setMaxLength(32)))
    .addSubcommand((s) => s.setName("offer").setDescription("Make an offer on a listing").addStringOption((o) => o.setName("listing").setDescription("Listing UUID").setRequired(true).setMinLength(36).setMaxLength(36)).addStringOption((o) => o.setName("amount").setDescription("Gold per item").setRequired(true).setMaxLength(32)).addIntegerOption((o) => o.setName("quantity").setDescription("Quantity").setMinValue(1).setMaxValue(999)).addStringOption((o) => o.setName("message").setDescription("Optional note to seller").setMaxLength(1000)))
    .addSubcommand((s) => s.setName("offers").setDescription("Show your recent marketplace offers"))
    .addSubcommand((s) => s.setName("watch").setDescription("Toggle a listing on your price watchlist").addStringOption((o) => o.setName("listing").setDescription("Listing UUID").setRequired(true).setMinLength(36).setMaxLength(36)))
    .addSubcommand((s) => s.setName("renew").setDescription("Renew one of your listings for 30 days").addStringOption((o) => o.setName("listing").setDescription("Listing UUID").setRequired(true).setMinLength(36).setMaxLength(36))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let supabase;
    try { supabase = getSupabase(); } catch (error) { await interaction.editReply(`❌ ${error.message}`); return; }
    try {
      const profile = await requireProfile(interaction, supabase);
      if (!profile) return;
      const sub = interaction.options.getSubcommand();
      if (sub === "add") return await addListing(interaction, supabase, profile);
      if (sub === "mine") return await listMine(interaction, supabase, profile);
      if (sub === "remove") return await removeListing(interaction, supabase, profile);
      if (sub === "search") return await searchListings(interaction, supabase);
      if (sub === "offer") return await makeOffer(interaction, supabase, profile);
      if (sub === "offers") return await listOffers(interaction, supabase, profile);
      if (sub === "watch") return await watchListing(interaction, supabase, profile);
      if (sub === "renew") return await renewListing(interaction, supabase, profile);
    } catch (error) {
      console.error("[MARKETPLACE]", error);
      await interaction.editReply("❌ The marketplace request failed. Nothing was changed. Check the bot logs for details.");
    }
  },
};
