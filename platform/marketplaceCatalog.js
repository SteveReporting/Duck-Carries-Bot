const DUNGEON_QUEST_WIKI_API = "https://dungeonquestroblox.fandom.com/api.php";
const WIKI_TIMEOUT_MS = 10_000;

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

function isSellerProofCatalogueImage(value) {
  const url = String(value || "").toLowerCase();
  return url.includes("/market-item-images/") || url.includes("market-item-images");
}

function wikiPageImage(payload) {
  const pages = Object.values(payload?.query?.pages || {});
  const page = pages.find((candidate) => candidate && candidate.missing === undefined);
  return page?.original?.source || page?.thumbnail?.source || null;
}

async function fetchWikiArtwork(params) {
  const search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "pageimages",
    piprop: "original|thumbnail",
    pithumbsize: "700",
    ...params,
  });

  const response = await fetch(`${DUNGEON_QUEST_WIKI_API}?${search.toString()}`, {
    headers: {
      accept: "application/json",
      "user-agent": "TheCarryTavern-Marketplace/1.0",
    },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return wikiPageImage(payload);
}

async function resolveDungeonQuestArtwork(itemName) {
  const cleanName = String(itemName || "").trim();
  if (!cleanName) return null;

  try {
    const exact = await fetchWikiArtwork({ titles: cleanName });
    if (exact) return exact;

    // Fallback for apostrophe/spelling differences while still keeping the
    // result tied to the exact item name the seller entered.
    return await fetchWikiArtwork({
      generator: "search",
      gsrsearch: `\"${cleanName}\"`,
      gsrlimit: "1",
    });
  } catch (error) {
    console.warn(`[MARKETPLACE] Artwork lookup failed for ${cleanName}:`, error.message);
    return null;
  }
}

async function ensureCatalogueArtwork(supabase, item) {
  if (!item?.id || !item?.name) return item;

  const existingUrl = String(item.image_url || "");
  if (existingUrl && !isSellerProofCatalogueImage(existingUrl)) return item;

  const artworkUrl = await resolveDungeonQuestArtwork(item.name);
  if (!artworkUrl) {
    // A seller screenshot must never be used as the catalogue artwork. If an
    // earlier build accidentally stored one there, clear it and fall back to
    // the Tavern item placeholder until real artwork can be found.
    if (existingUrl && isSellerProofCatalogueImage(existingUrl)) {
      const { error } = await supabase.from("items").update({ image_url: null }).eq("id", item.id);
      if (!error) item.image_url = null;
    }
    return item;
  }

  const { error } = await supabase
    .from("items")
    .update({ image_url: artworkUrl })
    .eq("id", item.id);
  if (error) {
    console.warn(`[MARKETPLACE] Could not save artwork for ${item.name}:`, error.message);
    return item;
  }

  item.image_url = artworkUrl;
  console.log(`[MARKETPLACE] Set Dungeon Quest artwork for ${item.name}.`);
  return item;
}

async function findOrCreateCatalogueItem(supabase, itemName) {
  const cleanName = String(itemName || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!cleanName) throw new Error("Item name cannot be empty.");

  const normalized = normalizeItemName(cleanName);
  const items = await loadCatalogue(supabase);
  const existing = items.find((item) => normalizeItemName(item.name) === normalized);
  if (existing) return ensureCatalogueArtwork(supabase, existing);

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
  return ensureCatalogueArtwork(supabase, data);
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

  const { data: items, error: itemError } = await supabase
    .from("items")
    .select("id,name,image_url,item_type,item_class,rarity,market_category,collect_color")
    .in("id", itemIds.slice(0, 250));
  if (itemError) throw new Error(`Could not load active Marketplace items: ${itemError.message}`);

  let updated = 0;
  for (const item of items || []) {
    if (item.image_url && !isSellerProofCatalogueImage(item.image_url)) continue;
    const before = item.image_url;
    await ensureCatalogueArtwork(supabase, item);
    if (item.image_url && item.image_url !== before) updated += 1;
  }

  if (updated) console.log(`[MARKETPLACE] Refreshed real artwork for ${updated} active item(s).`);
  return { checked: items?.length || 0, updated };
}

module.exports = {
  ensureCatalogueArtwork,
  findOrCreateCatalogueItem,
  inferItemMetadata,
  normalizeItemName,
  repairActiveCatalogueArtwork,
  repairOrphanListings,
  resolveDungeonQuestArtwork,
};
