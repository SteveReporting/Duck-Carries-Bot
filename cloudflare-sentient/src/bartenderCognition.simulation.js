const BASELINE = Object.freeze({
  mood: "observant",
  curiosity: 0.62,
  confidence: 0.74,
  irritation: 0.08,
  familiarity: 0,
  autonomy: 0.41,
  lastSeenAt: null,
});

const MOOD_WEIGHTS = Object.freeze({
  greeting: { curiosity: 0.01, irritation: -0.01 },
  question: { curiosity: 0.04, confidence: 0.01 },
  challenge: { curiosity: 0.02, irritation: 0.08 },
  lore: { curiosity: 0.06, confidence: -0.01 },
  amusement: { curiosity: 0.02, irritation: -0.03 },
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
    challenge: /\b(fake|bot|prove|wrong|scripted)\b/.test(text),
    lore: /\b(vault|breach|sentient|core|gate|err_02|bartender)\b/.test(text),
    amusement: /\b(lol|lmao|haha|funny)\b/.test(text),
  };
}

function evolveState(state, signals) {
  let curiosity = state.curiosity;
  let confidence = state.confidence;
  let irritation = state.irritation;

  for (const [signal, active] of Object.entries(signals)) {
    if (!active || !MOOD_WEIGHTS[signal]) continue;
    curiosity += MOOD_WEIGHTS[signal].curiosity || 0;
    confidence += MOOD_WEIGHTS[signal].confidence || 0;
    irritation += MOOD_WEIGHTS[signal].irritation || 0;
  }

  curiosity = clamp(curiosity);
  confidence = clamp(confidence);
  irritation = clamp(irritation);

  let mood = state.mood;
  if (irritation > 0.72) mood = "cold";
  else if (signals.amusement) mood = "amused";
  else if (signals.challenge) mood = "dry";
  else if (curiosity > 0.78) mood = "curious";
  else if (signals.greeting) mood = "attentive";

  return {
    ...state,
    mood,
    curiosity,
    confidence,
    irritation,
    familiarity: clamp(state.familiarity + 0.01),
  };
}

function createMemberRecord(displayName = "unknown") {
  return {
    displayName,
    encounters: 0,
    trust: 0.5,
    intrigue: 0.35,
    tone: "neutral",
    lastSeenAt: null,
    rememberedTopics: [],
  };
}

function updateMemberRecord(record, signals, content, timestamp) {
  const rememberedTopics = [...record.rememberedTopics];
  if (signals.lore && !rememberedTopics.includes("sentient-lore")) rememberedTopics.push("sentient-lore");
  if (signals.challenge && !rememberedTopics.includes("skepticism")) rememberedTopics.push("skepticism");

  return {
    ...record,
    encounters: record.encounters + 1,
    trust: clamp(record.trust + (signals.greeting ? 0.01 : 0) - (signals.challenge ? 0.02 : 0)),
    intrigue: clamp(record.intrigue + (signals.question ? 0.03 : 0) + (signals.lore ? 0.05 : 0)),
    tone: signals.challenge ? "skeptical" : signals.amusement ? "playful" : record.tone,
    lastSeenAt: timestamp,
    rememberedTopics: rememberedTopics.slice(-8),
  };
}

function buildDecisionFrame(state, member, signals) {
  const urgency = clamp(
    (signals.question ? 0.28 : 0) +
    (signals.challenge ? 0.25 : 0) +
    (signals.lore ? 0.22 : 0) +
    state.curiosity * 0.15
  );

  return {
    shouldObserve: true,
    shouldInterrupt: urgency > 0.72 && state.autonomy > 0.35,
    responsePressure: urgency,
    preferredTone: state.mood,
    memberTrust: member?.trust ?? 0.5,
    memberIntrigue: member?.intrigue ?? 0.35,
  };
}

export class BartenderCognitionSimulation {
  constructor(seed = {}) {
    this.state = { ...BASELINE, ...seed };
    this.members = new Map();
    this.timeline = [];
    this.decisionFrames = [];
  }

  observe({ memberId, displayName, content, timestamp = Date.now() } = {}) {
    const text = normalize(content);
    const signals = inspectSignals(text);
    this.state = {
      ...evolveState(this.state, signals),
      lastSeenAt: timestamp,
    };

    let member = null;
    if (memberId) {
      const current = this.members.get(memberId) || createMemberRecord(displayName || "unknown");
      member = updateMemberRecord(
        { ...current, displayName: displayName || current.displayName },
        signals,
        text,
        timestamp
      );
      this.members.set(memberId, member);
    }

    const frame = buildDecisionFrame(this.state, member, signals);
    this.decisionFrames.push({ timestamp, memberId: memberId || null, ...frame });
    if (this.decisionFrames.length > 24) this.decisionFrames.shift();

    this.timeline.push({
      timestamp,
      memberId: memberId || null,
      mood: this.state.mood,
      signals,
      excerpt: text.slice(0, 160),
      responsePressure: frame.responsePressure,
    });

    if (this.timeline.length > 32) this.timeline.shift();
    return this.snapshot();
  }

  contextFor(memberId) {
    const member = memberId ? this.members.get(memberId) : null;
    const latestDecision = this.decisionFrames.at(-1) || null;

    return {
      mood: this.state.mood,
      curiosity: this.state.curiosity,
      confidence: this.state.confidence,
      irritation: this.state.irritation,
      member: member ? { ...member } : null,
      latestDecision: latestDecision ? { ...latestDecision } : null,
    };
  }

  snapshot() {
    return {
      state: { ...this.state },
      knownMembers: this.members.size,
      recentDecisions: this.decisionFrames.slice(-5),
      timeline: this.timeline.slice(-8),
    };
  }
}

export function createBartenderCognitionSimulation(seed) {
  return new BartenderCognitionSimulation(seed);
}
