/**
 * Combat System
 *
 * Combat mechanics, damage calculation, XP/leveling, romance state management,
 * and choice consequence application.
 */

import type {
  Emotion,
  AdventureSession,
  AdventurePluginConfig,
  SceneChoice,
  RomanceBoundaries,
  RomanceState,
} from "./types";

// ─── Romance Boundaries ────────────────────────────────────────────────────────

export function getRomanceBoundaries(pluginConfig: AdventurePluginConfig): RomanceBoundaries {
  const defaults: RomanceBoundaries = {
    allowPhysical: true,
    allowExplicit: false,
  };
  const cfg = pluginConfig.romanceBoundaries || {};
  return {
    allowPhysical:
      typeof cfg.allowPhysical === "boolean"
        ? cfg.allowPhysical
        : defaults.allowPhysical,
    allowExplicit:
      typeof cfg.allowExplicit === "boolean"
        ? cfg.allowExplicit
        : defaults.allowExplicit,
  };
}

// ─── Intimacy Stage ────────────────────────────────────────────────────────────

export function calculateIntimacyStage(
  affectionScore: number,
  boundaries: RomanceBoundaries,
): RomanceState["intimacyStage"] {
  if (affectionScore >= 85 && boundaries.allowExplicit) {
    return "passionate";
  }
  if (affectionScore >= 60) {
    return "tender";
  }
  return "playful";
}

// ─── Initial Romance State ─────────────────────────────────────────────────────

export function buildInitialRomanceState(pluginConfig: AdventurePluginConfig): RomanceState {
  const boundaries = getRomanceBoundaries(pluginConfig);
  const affection = Math.min(
    100,
    Math.max(0, pluginConfig.romanceInitialAffection ?? 45),
  );
  const trustLevel = Math.min(80, Math.max(25, affection - 5));

  return {
    affectionScore: affection,
    trustLevel,
    intimacyStage: calculateIntimacyStage(affection, boundaries),
    boundaries,
    momentum: "steady",
    streak: 0,
    recentMemories: [],
    lastInteractionAt: Date.now(),
  };
}

// ─── Update Romance State ──────────────────────────────────────────────────────

export function updateRomanceState(
  session: AdventureSession,
  change: {
    affection?: number;
    trust?: number;
    summary?: string;
    tags?: string[];
  },
  pluginConfig: AdventurePluginConfig,
): {
  affectionDelta: number;
  trustDelta: number;
  romanceState: RomanceState;
} {
  const now = Date.now();
  const current = session.romanceState || buildInitialRomanceState(pluginConfig);
  const affectionDelta = change.affection ?? 0;
  const trustDelta = change.trust ?? 0;

  let affectionScore = Math.max(
    0,
    Math.min(100, current.affectionScore + affectionDelta),
  );
  let trustLevel = Math.max(
    0,
    Math.min(100, current.trustLevel + trustDelta),
  );

  if (trustLevel > affectionScore + 20) {
    trustLevel = affectionScore + 20;
  }
  if (trustLevel < affectionScore - 40) {
    trustLevel = Math.max(0, affectionScore - 40);
  }

  const boundaries = getRomanceBoundaries(pluginConfig);
  const intimacyStage = calculateIntimacyStage(
    affectionScore,
    boundaries,
  );

  const recentMemories = current.recentMemories.slice(-4);
  if (change.summary) {
    recentMemories.push(change.summary);
  }

  let momentum: RomanceState["momentum"] = "steady";
  if (affectionDelta > 3) momentum = "surging";
  else if (affectionDelta < -2) momentum = "cooling";

  const romanceState: RomanceState = {
    affectionScore,
    trustLevel,
    intimacyStage,
    boundaries,
    momentum,
    streak: current.streak,
    recentMemories,
    lastInteractionAt: now,
    lastAffectionDelta: affectionDelta,
    lastTrustDelta: trustDelta,
  };

  session.romanceState = romanceState;
  session.romanceHistory = session.romanceHistory || [];
  session.romanceHistory.push({
    timestamp: now,
    summary: change.summary || "Romance interaction",
    affectionDelta,
    trustDelta,
    tags: change.tags,
  });

  if (current.lastInteractionAt) {
    const hours = (now - current.lastInteractionAt) / (1000 * 60 * 60);
    if (hours <= 18) {
      romanceState.streak = Math.min(current.streak + 1, 999);
    } else if (hours > 48) {
      romanceState.streak = 0;
    } else {
      romanceState.streak = current.streak;
    }
  }

  return { affectionDelta, trustDelta, romanceState };
}

// ─── Choice Consequences ───────────────────────────────────────────────────────

export function applyChoiceConsequences(
  session: AdventureSession,
  choice: SceneChoice,
  pluginConfig: AdventurePluginConfig,
): { affectionDelta?: number; romanceState?: RomanceState } {
  session.gameState.player.experience += 15;
  if (
    session.gameState.player.experience >=
    session.gameState.player.level * 120
  ) {
    session.gameState.player.experience = 0;
    session.gameState.player.level += 1;
    session.gameState.player.maxHealth += 10;
    session.gameState.player.maxMana += 5;
    session.gameState.player.health = session.gameState.player.maxHealth;
    session.gameState.player.mana = session.gameState.player.maxMana;
  }

  if (session.experienceType !== "date") {
    session.gameState.player.mood = "excited";
    return {};
  }

  const tags = choice.tags || [];
  const lower = choice.text.toLowerCase();
  const boundaries =
    session.romanceState?.boundaries || getRomanceBoundaries(pluginConfig);
  const stage = session.romanceState?.intimacyStage || "playful";

  let affectionChange = 2;
  let trustChange = 1;

  if (tags.includes("physical")) affectionChange += 2;
  if (tags.includes("emotional")) trustChange += 2;
  if (
    tags.includes("bold") ||
    lower.includes("kiss") ||
    lower.includes("close")
  )
    affectionChange += 3;
  if (tags.includes("consent")) trustChange += 3;
  if (tags.includes("playful")) affectionChange += 1;

  if (!boundaries.allowPhysical && tags.includes("physical")) {
    affectionChange -= 3;
    trustChange -= 1;
  }
  if (!boundaries.allowExplicit && tags.includes("explicit")) {
    affectionChange -= 5;
    trustChange -= 2;
  }

  if (
    lower.includes("leave") ||
    lower.includes("goodbye") ||
    lower.includes("ignore")
  ) {
    affectionChange -= 4;
    trustChange -= 3;
  }

  if (stage === "passionate") {
    affectionChange += 1;
  } else if (stage === "tender") {
    trustChange += 1;
  }

  const result = updateRomanceState(session, {
    affection: affectionChange,
    trust: trustChange,
    summary: `Choice: ${choice.text}`,
    tags,
  }, pluginConfig);

  session.gameState.player.mood =
    result.romanceState.intimacyStage === "passionate"
      ? "passionate"
      : result.romanceState.intimacyStage === "tender"
        ? "tender"
        : "flirty";

  return {
    affectionDelta: result.affectionDelta,
    romanceState: result.romanceState,
  };
}
