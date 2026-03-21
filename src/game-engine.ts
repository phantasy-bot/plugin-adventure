/**
 * Game Engine
 *
 * Core game state machine, session management, turn processing,
 * scene storage, and persistence.
 */

import { kvService } from "@phantasy/agent/plugin-runtime";
import type { PluginContext } from "@phantasy/agent/plugins";

import type {
  Emotion,
  AdventureSession,
  AdventureScene,
  AdventureSnapshot,
  ChronicleEntry,
  AdventurePluginConfig,
} from "./types";

import {
  generateId,
  generateTitle,
  DATE_KEYWORDS,
} from "./narrative-engine";

import { buildInitialRomanceState } from "./combat-system";

import type { StartAdventureParams } from "./types";

// ─── KV Key Helpers ────────────────────────────────────────────────────────────

export function kvKeySession(id: string): string {
  return `adventure:session:${id}`;
}

export function kvKeySessionByUser(userId: string): string {
  return `adventure:sessionByUser:${userId}`;
}

export function kvKeySave(sessionId: string, saveId: string): string {
  return `adventure:save:${sessionId}:${saveId}`;
}

// ─── Session Creation ──────────────────────────────────────────────────────────

export function createSession(
  userId: string,
  genre: string,
  theme: string,
  playerName: string,
  mood: Emotion | undefined,
  experienceType: "adventure" | "date",
  pluginConfig: AdventurePluginConfig,
): AdventureSession {
  const now = Date.now();
  const romanceState =
    experienceType === "date" ? buildInitialRomanceState(pluginConfig) : undefined;
  return {
    id: generateId("adv"),
    userId,
    title: generateTitle(genre, theme),
    genre,
    experienceType,
    theme,
    status: "active",
    createdAt: now,
    updatedAt: now,
    currentSceneId: "scene_intro",
    history: [],
    gameState: {
      player: {
        name: playerName,
        level: 1,
        experience: 0,
        health: 100,
        maxHealth: 100,
        mana: 40,
        maxMana: 40,
        mood: mood || "excited",
      },
      flags: {},
      inventory: [],
    },
    chronicle: [],
    metadata: {},
    saves: {},
    romanceState,
    romanceHistory: romanceState ? [] : undefined,
  };
}

// ─── Chronicle Entry ───────────────────────────────────────────────────────────

export function createChronicleEntry(
  type: "scene" | "choice" | "action",
  sceneId: string,
  summary: string,
  metadata?: Record<string, unknown>,
): ChronicleEntry {
  return {
    id: generateId("chronicle"),
    type,
    sceneId,
    summary,
    timestamp: Date.now(),
    metadata,
  };
}

// ─── Session Persistence ───────────────────────────────────────────────────────

export async function persistSession(session: AdventureSession): Promise<void> {
  await kvService.set(kvKeySession(session.id), session);
  await kvService.set(kvKeySessionByUser(session.userId), session.id);
}

// ─── User / Session Resolution ─────────────────────────────────────────────────

export function resolveUserId(
  explicitUserId: string | null | undefined,
  lastSeenUserId: string | null,
): string | null {
  if (explicitUserId && String(explicitUserId).trim().length > 0)
    return explicitUserId;
  if (lastSeenUserId) return lastSeenUserId;
  return "admin";
}

export function resolveSession(
  adventureId: string | undefined,
  userId: string | null | undefined,
  sessions: Map<string, AdventureSession>,
  sessionByUser: Map<string, string>,
  lastSeenUserId: string | null,
): AdventureSession | null {
  if (adventureId && sessions.has(adventureId)) {
    return sessions.get(adventureId)!;
  }
  const resolvedUserId = resolveUserId(userId ?? null, lastSeenUserId);
  if (resolvedUserId) {
    const sessionId = sessionByUser.get(resolvedUserId);
    if (sessionId) {
      return sessions.get(sessionId) || null;
    }
  }
  return null;
}

export async function resolveOrLoadSession(
  adventureId: string | undefined,
  userId: string | undefined,
  sessions: Map<string, AdventureSession>,
  sessionByUser: Map<string, string>,
  lastSeenUserId: string | null,
): Promise<AdventureSession | null> {
  const resolvedUserId = resolveUserId(userId ?? null, lastSeenUserId);

  const inMem = resolveSession(adventureId, resolvedUserId, sessions, sessionByUser, lastSeenUserId);
  if (inMem) return inMem;
  if (adventureId) {
    const sess = await kvService.get<AdventureSession>(
      kvKeySession(adventureId),
    );
    if (sess) {
      sessions.set(sess.id, sess);
      if (sess.userId) sessionByUser.set(sess.userId, sess.id);
      return sess;
    }
  }
  if (resolvedUserId) {
    const sessionId = await kvService.get<string>(
      kvKeySessionByUser(resolvedUserId),
    );
    if (sessionId) {
      const sess = await kvService.get<AdventureSession>(
        kvKeySession(sessionId),
      );
      if (sess) {
        sessions.set(sess.id, sess);
        sessionByUser.set(sess.userId, sess.id);
        return sess;
      }
    }
  }
  return null;
}

// ─── Experience Type Resolution ────────────────────────────────────────────────

export function detectDateIntent(message: string | undefined | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return DATE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function resolveExperienceType(
  params: StartAdventureParams,
  userId: string,
  pluginConfig: AdventurePluginConfig,
  contextByUser: Map<string, PluginContext>,
): "adventure" | "date" {
  if (pluginConfig.dateModeEnabled === false) {
    return "adventure";
  }

  if (params.mode === "date") return "date";
  if (params.mode === "adventure") return "adventure";

  const genre = params.genre?.toLowerCase() || "";
  if (genre.includes("romance") || genre.includes("date")) {
    return "date";
  }

  const theme = params.theme?.toLowerCase() || "";
  if (theme.includes("date") || theme.includes("romance")) {
    return "date";
  }

  const context = contextByUser.get(userId);
  const lastMessage = context?.message || "";
  if (detectDateIntent(lastMessage)) return "date";

  const metadataIntent = (
    context?.metadata as Record<string, unknown> | undefined
  )?.adventureIntent;
  if (
    metadataIntent &&
    typeof metadataIntent === "object" &&
    (metadataIntent as Record<string, unknown>).mode === "date"
  ) {
    return "date";
  }

  return "adventure";
}

// ─── Scene Store Management ────────────────────────────────────────────────────

export function ensureSceneStore(
  sessionId: string,
  scenesBySession: Map<string, Map<string, AdventureScene>>,
): Map<string, AdventureScene> {
  if (!scenesBySession.has(sessionId)) {
    scenesBySession.set(sessionId, new Map());
  }
  return scenesBySession.get(sessionId)!;
}

export function saveScene(
  sessionId: string,
  scene: AdventureScene,
  scenesBySession: Map<string, Map<string, AdventureScene>>,
): void {
  ensureSceneStore(sessionId, scenesBySession).set(scene.id, scene);
}

export function getStoredScene(
  session: AdventureSession,
  sceneId: string,
  scenesBySession: Map<string, Map<string, AdventureScene>>,
): AdventureScene | null {
  const store = scenesBySession.get(session.id);
  if (!store) {
    if (session.lastScene && session.lastScene.id === sceneId) {
      return session.lastScene;
    }
    return null;
  }
  const s = store.get(sceneId) || null;
  if (!s && session.lastScene && session.lastScene.id === sceneId) {
    return session.lastScene;
  }
  return s;
}

export function dropSession(
  sessionId: string,
  sessions: Map<string, AdventureSession>,
  scenesBySession: Map<string, Map<string, AdventureScene>>,
): void {
  sessions.delete(sessionId);
  scenesBySession.delete(sessionId);
}
