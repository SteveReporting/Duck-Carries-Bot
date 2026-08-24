const MARKET_IMAGE_BUCKET = "market-item-images";
const MAX_MARKET_IMAGE_BYTES = 5 * 1024 * 1024;

let marketImageBucketReady = false;

function normalizeItemName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferItemMetadata(itemName) {
  const name = normalizeItemName(itemName);

  let marketCategory = "legendary";
  let itemType = "weapon";
  let rarity = "legendary";

  if (/\b(god pot|godly potion|potion)\b/.test(name)) {
    marketCategory = "god_pot";
    itemType = "potion";
    rarity = null;
  } else if (/\b(spell|ability)\b/.test(name)) {
    marketCategory = "legendary_spell";
    itemType = "spell";
    rarity = "legendary";
  } else if (/\bult(imate)?\b/.test(name)) {
    marketCategory = "ult";
    itemType = "ult";
    rarity = "ult";
  } else if (/\b(armor|armour|helmet|helm|chestplate|robe|hood)\b/.test(name)) {
    marketCategory = "collectible";
    itemType = "armor";
    rarity = null;
  }

  let itemClass = null;
  if (/\b(mage|staff|wand|tome|spell)\b/.test(name)) itemClass = "mage";
  else if (/\b(guardian|shield)\b/.test(name)) itemClass = "guardian";
  else if (/\b(warrior|sword|greatsword|scythe|warscythe|axe|hammer|spear|blade)\b/.test(name)) itemClass = "warrior";

  return {
    market_category: marketCategory,
    item_type: itemType,
    rarity,
    item_class: itemClass,
  };
}

async function loadCatalogue(supabase) {
  const { data, error } = await supabase
    .from("items")
    .select("id,name,image_url,item_type,item_class,rarity,market_category,collect_color")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`Could not load Marketplace catalogue: ${error.message}`);
  return data || [];
}

async function findOrCreateCatalogueItem(supabase, itemName) {
  const cleanName = String(itemName || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!cleanName) throw new Error("Item name cannot be empty.");

  const normalized = normalizeItemName(cleanName);
  const items = await loadCatalogue(supabase);
  const existing = items.find((item) => normalizeItemName(item.name) === normalized);
  if (existing) return existing;

  const metadata = inferItemMetadata(cleanName);
  const { data, error } = await supabase
    .from("items")
    .insert({
      name: cleanName,
      ...metadata,
    })
    .select("id,name,image_url,item_type,item_class,rarity,market_category,collect_color")
    .single();
  if (error) throw new Error(`Could not add ${cleanName} to the Marketplace catalogue: ${error.message}`);

  console.log(`[MARKETPLACE] Added catalogue item: ${data.name} (${data.id})`);
  return data;
}

async function ensureMarketImageBucket(supabase) {
  if (marketImageBucketReady) return true;

  const { data, error } = await supabase.storage.getBucket(MARKET_IMAGE_BUCKET);
  if (!error && data) {
    if (!data.public) {
      const { error: updateError } = await supabase.storage.updateBucket(MARKET_IMAGE_BUCKET, {
        public: true,
        fileSizeLimit: MAX_MARKET_IMAGE_BYTES,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      });
      if (updateError) throw updateError;
    }
    marketImageBucketReady = true;
    return true;
  }

  const { error: createError } = await supabase.storage.createBucket(MARKET_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_MARKET_IMAGE_BYTES,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  });
  if (createError && !/already exists/i.test(String(createError.message || ""))) throw createError;
  marketImageBucketReady = true;
  return true;
}

function extensionFromReference(reference, contentType = "") {
  const contentMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  if (contentMap[contentType]) return contentMap[contentType];
  const match = String(reference || "").toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/);
  const ext = match?.[1];
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "png";
}

async function publishItemImageBytes(supabase, item, bytes, contentType, extension) {
  if (!item?.id || item.image_url || !bytes?.length) return item;
  if (bytes.length > MAX_MARKET_IMAGE_BYTES) return item;

  try {
    await ensureMarketImageBucket(supabase);
    const path = `${item.id}.${extension || extensionFromReference("", contentType)}`;
    const { error: uploadError } = await supabase.storage
      .from(MARKET_IMAGE_BUCKET)
      .upload(path, bytes, {
        contentType: contentType || "image/png",
        cacheControl: "86400",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(MARKET_IMAGE_BUCKET).getPublicUrl(path);
    const publicUrl = data?.publicUrl || null;
    if (!publicUrl) return item;

    const { error: updateError } = await supabase
      .from("items")
      .update({ image_url: publicUrl })
      .eq("id", item.id);
    if (updateError) throw updateError;

    item.image_url = publicUrl;
    console.log(`[MARKETPLACE] Set catalogue image for ${item.name}.`);
  } catch (error) {
    console.warn(`[MARKETPLACE] Could not publish item image for ${item.name}:`, error.message);
  }

  return item;
}

async function publishItemImageFromProof(supabase, item, proofReference) {
  if (!item?.id || item.image_url || !proofReference) return item;

  try {
    if (/^https?:\/\//i.test(proofReference)) {
      const response = await fetch(proofReference, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return item;
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = String(response.headers.get("content-type") || "image/png").split(";")[0];
      return publishItemImageBytes(
        supabase,
        item,
        bytes,
        contentType,
        extensionFromReference(proofReference, contentType),
      );
    }

    const { data: blob, error } = await supabase.storage.from("proof-images").download(proofReference);
    if (error || !blob) return item;
    const bytes = Buffer.from(await blob.arrayBuffer());
    const contentType = blob.type || "image/png";
    return publishItemImageBytes(
      supabase,
      item,
      bytes,
      contentType,
      extensionFromReference(proofReference, contentType),
    );
  } catch (error) {
    console.warn(`[MARKETPLACE] Could not use listing proof as catalogue image:`, error.message);
    return item;
  }
}

async function repairOrphanListings(supabase) {
  const { data, error } = await supabase
    .from("listings")
    .select("id,item_id,item_name,proof_image_url,status")
    .is("item_id", null)
    .limit(1000);
  if (error) throw new Error(`Could not inspect orphan Marketplace listings: ${error.message}`);
  if (!data?.length) return { repaired: 0, created: 0 };

  let repaired = 0;
  const beforeIds = new Set((await loadCatalogue(supabase)).map((item) => item.id));
  const itemCache = new Map();

  for (const listing of data) {
    const key = normalizeItemName(listing.item_name);
    if (!key) continue;

    let item = itemCache.get(key);
    if (!item) {
      item = await findOrCreateCatalogueItem(supabase, listing.item_name);
      itemCache.set(key, item);
    }

    if (!item.image_url && listing.proof_image_url) {
      item = await publishItemImageFromProof(supabase, item, listing.proof_image_url);
      itemCache.set(key, item);
    }

    const { error: updateError } = await supabase
      .from("listings")
      .update({ item_id: item.id, item_name: item.name })
      .eq("id", listing.id)
      .is("item_id", null);
    if (updateError) throw new Error(`Could not repair listing ${listing.id}: ${updateError.message}`);
    repaired += 1;
  }

  const created = [...itemCache.values()].filter((item) => !beforeIds.has(item.id)).length;
  if (repaired) {
    console.log(`[MARKETPLACE] Repaired ${repaired} orphan listing(s); created ${created} catalogue item(s).`);
  }
  return { repaired, created };
}

module.exports = {
  findOrCreateCatalogueItem,
  inferItemMetadata,
  normalizeItemName,
  publishItemImageBytes,
  publishItemImageFromProof,
  repairOrphanListings,
};
