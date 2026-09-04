function minutes(ms) {
  return Math.max(0, Math.floor(Number(ms || 0) / 60000));
}

function pressureFor({ waiting = 0, oldestMinutes = 0, availableCarriers = 0 }) {
  const score = Math.max(0, Number(waiting) * 10 + Math.min(60, Number(oldestMinutes) || 0) - Number(availableCarriers) * 12);
  if (Number(waiting) <= 0) return { level: "clear", score: 0, label: "🟢 Clear" };
  if (score >= 85 || Number(oldestMinutes) >= 50) return { level: "critical", score, label: "🔴 Critical" };
  if (score >= 45 || Number(oldestMinutes) >= 30) return { level: "high", score, label: "🟠 High" };
  if (score >= 20) return { level: "medium", score, label: "🟡 Medium" };
  return { level: "low", score, label: "🟢 Low" };
}

function formatAge(ms) {
  const mins = minutes(ms);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${hours}h ${rest}m`;
}

function stageForStatus(status, serviceStatus = "not_started") {
  if (status === "queued") return { step: 1, label: "Waiting", ribbon: "🟡 WAITING → ⚪ CLAIMED → ⚪ READY → ⚪ LIVE → ⚪ DONE" };
  if (status === "claimed" && serviceStatus === "not_started") return { step: 2, label: "Claimed", ribbon: "✅ WAITING → 🔵 CLAIMED → ⚪ READY → ⚪ LIVE → ⚪ DONE" };
  if (status === "claimed" && serviceStatus === "stopped") return { step: 3, label: "Ready / Resume", ribbon: "✅ WAITING → ✅ CLAIMED → 🟠 READY → ⚪ LIVE → ⚪ DONE" };
  if (status === "in_progress" || serviceStatus === "running" || serviceStatus === "checkpoint") return { step: 4, label: "Live", ribbon: "✅ WAITING → ✅ CLAIMED → ✅ READY → 🟢 LIVE → ⚪ DONE" };
  if (status === "completed" || serviceStatus === "completed") return { step: 5, label: "Done", ribbon: "✅ WAITING → ✅ CLAIMED → ✅ READY → ✅ LIVE → 🏆 DONE" };
  return { step: 0, label: "Unknown", ribbon: "⚪ WAITING → ⚪ CLAIMED → ⚪ READY → ⚪ LIVE → ⚪ DONE" };
}

module.exports = {
  formatAge,
  minutes,
  pressureFor,
  stageForStatus,
};
