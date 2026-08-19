const BASELINE = Object.freeze({
  mood: "observant",
  curiosity: 0.62,
  confidence: 0.74,
  familiarity: 0,
  lastSeenAt: null,
});

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function inspectSignals(message) {
  const text = normalize(message).toLowerCase();
  return {
    question: text.includes("?"),
    greeting: /\b(hi|hello|hey|yo)\b/.test(text),
    challenge: /\b(fake|bot|prove|wrong)\b/.test(text),
    lore: /\b(vault|breach|sentient|core|gate|err_02)\b/.test(text),
  };
}

export class BartenderCognitionSimulation {
  constructor(seed = {}) {
    this.state = { ...BASELINE, ...seed };
    this.members = new Map();
    this.timeline = [];
  }

  observe({ memberId, displayName, content, timestamp = Date.now() } = {}) {
    const signals = inspectSignals(content);

    this.state = {
      ...this.state,
      mood: signals.challenge ? "dry" : signals.question ? "curious" : this.state.mood,
      curiosity: clamp(this.state.curiosity + (signals.question ? 0.03 : 0)),
      familiarity: clamp(this.state.familiarity + 0.01),
      lastSeenAt: timestamp,
    };

    if (memberId) {
      const current = this.members.get(memberId) || {
        displayName: displayName || "unknown",
        encounters: 0,
        tone: "neutral",
      };

      this.members.set(memberId, {
        ...current,
        displayName: displayName || current.displayName,
        encounters: current.encounters + 1,
        tone: signals.challenge ? "skeptical" : current.tone,
        lastSeenAt: timestamp,
      });
    }

    this.timeline.push({
      timestamp,
      memberId: memberId || null,
      mood: this.state.mood,
      signals,
      excerpt: normalize(content).slice(0, 160),
    });

    if (this.timeline.length > 32) this.timeline.shift();
    return this.snapshot();
  }

  snapshot() {
    return {
      state: { ...this.state },
      knownMembers: this.members.size,
      timeline: this.timeline.slice(-8),
    };
  }
}

export function createBartenderCognitionSimulation(seed) {
  return new BartenderCognitionSimulation(seed);
}
