function cleanIds(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function chooseConfiguredGuildId({ configuredIds = [], visibleIds = [], preferredIds = [] } = {}) {
  const configured = new Set(cleanIds(configuredIds));
  const visible = new Set(cleanIds(visibleIds));
  const eligible = cleanIds(configuredIds).filter((id) => visible.has(id));
  if (!eligible.length) return null;

  for (const id of cleanIds(preferredIds)) {
    if (configured.has(id) && visible.has(id)) return id;
  }
  return eligible[0];
}

module.exports = {
  chooseConfiguredGuildId,
  cleanIds,
};
