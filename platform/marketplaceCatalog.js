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
    // Older live schemas did not include `ult` in the market_category CHECK.
    // Leaving the tag null is safe because the website also infers it from item_type.
    marketCategory = null;
    itemType = "ult";
    rarity = "ult";
  } else if (/\b(armor|armour|helmet|helm|chestplate|robe|hood)\b/.test(name)) {
    // `collect` is accepted by both the original and current schemas. The UI
    // normalises it to the single Collectibles section.
    marketCategory = "collect";
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

async function loadTreasuryArtwork(supabase) {
  const { data, error } = await supabase
    .from("treasury_items")
    .select("item_name,image_url,stock_category,collect_color,value_tier")
    .not("image_url", "is", null)
    .order("item_name")
    .limit(5000);
  if (error) throw new Error(`Could not load Treasury item artwork: ${error.message}`);
  return data || [];
}

async function findTreasuryItem(supabase, itemName, treasuryRows = null) {
  const target = normalizeItemName(itemName);
  if (!target) return null;
  const rows = treasuryRows || await loadTreasuryArtwork(supabase);
  return rows.find((row) => normalizeItemName(row.item_name) === target) || null;
}

async function ensureCatalogueArtwork(supabase, item, treasuryRows = null) {
  if (!item?.id || !item?.name) return item;

  const treasuryItem = await findTreasuryItem(supabase, item.name, treasuryRows);
  const treasuryUrl = String(treasuryItem?.image_url || "").trim();
  if (!treasuryUrl) {
    console.warn(`[MARKETPLACE] No Treasury artwork found for ${item.name}.`);
    return item;
  }

  if (String(item.image_url || "") === treasuryUrl) return item;

  const patch = { image_url: treasuryUrl };

  // Treasury metadata is authoritative when available and helps keep the
  // Marketplace category/classification consistent with the stock browser.
  if (treasuryItem.stock_category === "legendary") {
    patch.market_category = "legendary";
    patch.rarity = "legendary";
  } else if (treasuryItem.stock_category === "collect") {
    patch.market_category = "collect";
    if (treasuryItem.collect_color) patch.collect_color = treasuryItem.collect_color;
  }

  const { error } = await supabase.from("items").update(patch).eq("id", item.id);
  if (error) {
    console.warn(`[MARKETPLACE] Could not copy Treasury artwork for ${item.name}:`, error.message);
    return item;
  }

  Object.assign(item, patch);
  console.log(`[MARKETPLACE] Using Treasury artwork for ${item.name}.`);
  return item;
}

async function findOrCreateCatalogueItem(supabase, itemName) {
  const cleanName = String(itemName || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!cleanName) throw new Error("Item name cannot be empty.");

  const normalized = normalizeItemName(cleanName);
  const [items, treasuryRows] = await Promise.all([
    loadCatalogue(supabase),
    loadTreasuryArtwork(supabase),
  ]);
  const existing = items.find((item) => normalizeItemName(item.name) === normalized);
  if (existing) return ensureCatalogueArtwork(supabase, existing, treasuryRows);

  const treasuryItem = await findTreasuryItem(supabase, cleanName, treasuryRows);
  const metadata = inferItemMetadata(cleanName);
  if (treasuryItem?.stock_category === "legendary") {
    metadata.market_category = "legendary";
    metadata.rarity = "legendary";
  } else if (treasuryItem?.stock_category === "collect") {
    metadata.market_category = "collect";
    metadata.rarity = null;
  }

  const insert = {
    name: treasuryItem?.item_name || cleanName,
    image_url: treasuryItem?.image_url || null,
    ...metadata,
  };
  if (treasuryItem?.collect_color) insert.collect_color = treasuryItem.collect_color;

  const { data, error } = await supabase
    .from("items")
    .insert(insert)
    .select("id,name,image_url,item_type,item_class,rarity,market_category,collect_color")
    .single();
  if (error) throw new Error(`Could not add ${cleanName} to the Marketplace catalogue: ${error.message}`);

  console.log(`[MARKETPLACE] Added catalogue item from Treasury: ${data.name} (${data.id})`);
  return data;
}

// Kept as a compatibility no-op for older command code. Seller-uploaded images
// must remain listings.proof_image_url and never become items.image_url.
async function publishItemImageBytes(_supabase, item) {
  return item;
}

async function repairOrphanListings(supabase) {
  const { data, error } = await supabase
    .from("listings")
    .select("id,item_id,item_name,status")
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

async function repairActiveCatalogueArtwork(supabase) {
  const { data: listings, error: listingError } = await supabase
    .from("listings")
    .select("item_id")
    .eq("status", "available")
    .not("item_id", "is", null)
    .limit(1000);
  if (listingError) throw new Error(`Could not inspect active Marketplace artwork: ${listingError.message}`);

  const itemIds = [...new Set((listings || []).map((row) => row.item_id).filter(Boolean))];
  if (!itemIds.length) return { checked: 0, updated: 0 };

  const [{ data: items, error: itemError }, treasuryRows] = await Promise.all([
    supabase
      .from("items")
      .select("id,name,image_url,item_type,item_class,rarity,market_category,collect_color")
      .in("id", itemIds.slice(0, 250)),
    loadTreasuryArtwork(supabase),
  ]);
  if (itemError) throw new Error(`Could not load active Marketplace items: ${itemError.message}`);

  let updated = 0;
  for (const item of items || []) {
    const before = item.image_url;
    await ensureCatalogueArtwork(supabase, item, treasuryRows);
    if (item.image_url && item.image_url !== before) updated += 1;
  }

  if (updated) console.log(`[MARKETPLACE] Synced Treasury artwork for ${updated} active item(s).`);
  return { checked: items?.length || 0, updated };
}

module.exports = {
  ensureCatalogueArtwork,
  findOrCreateCatalogueItem,
  findTreasuryItem,
  inferItemMetadata,
  normalizeItemName,
  publishItemImageBytes,
  repairActiveCatalogueArtwork,
  repairOrphanListings,
};
