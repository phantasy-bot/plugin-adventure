/**
 * Adventure Plugin Type Definitions
 *
 * All adventure-related types, interfaces, and type aliases.
 */

import type { PluginConfig } from "@phantasy/agent/plugins";

// ─── Emotion ───────────────────────────────────────────────────────────────────

export type Emotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "confused"
  | "excited"
  | "worried"
  | "determined"
  | "thinking"
  | "curious"
  | "amazed"
  | "tender"
  | "playful"
  | "flirty"
  | "passionate";

// ─── Plugin Configuration ──────────────────────────────────────────────────────

export interface AdventurePluginConfig extends PluginConfig {
  defaultGenre?: string;
  defaultTheme?: string;
  autoStartKeywords?: string[];
  imageProvider?: string;
  playerName?: string;
  dateModeEnabled?: boolean;
  defaultDateTheme?: string;
  romanceBoundaries?: Partial<RomanceBoundaries>;
  romanceInitialAffection?: number;
  datePresets?: Array<{
    title: string;
    genre: string;
    theme: string;
    description: string;
    mood?: Emotion;
  }>;
  dateMusic?: {
    intro?: string;
    loop?: string;
    swell?: string;
  };
  preStartGuidance?: string;
}

// ─── Player & Game State ───────────────────────────────────────────────────────

export interface PlayerState {
  name: string;
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  mood: Emotion;
}

export interface GameState {
  player: PlayerState;
  flags: Record<string, boolean>;
  inventory: string[];
}

// ─── Scene & Dialogue ──────────────────────────────────────────────────────────

export interface SceneChoice {
  id: string;
  text: string;
  description?: string;
  nextSceneId?: string;
  consequences?: string[];
  enabled: boolean;
  tags?: string[];
}

export interface DialogueLine {
  speaker: string;
  speakerName: string;
  content: string;
  emotion: Emotion;
  animation?: string;
}

export interface AdventureScene {
  id: string;
  title: string;
  description: string;
  backgroundUrl?: string;
  backgroundPrompt?: string;
  musicUrl?: string;
  characterEmotion: Emotion;
  characterAnimation?: string;
  dialogue: DialogueLine;
  choices: SceneChoice[];
}

// ─── Chronicle & Snapshots ─────────────────────────────────────────────────────

export interface ChronicleEntry {
  id: string;
  type: "scene" | "choice" | "action";
  sceneId: string;
  summary: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AdventureSnapshot {
  id: string;
  createdAt: number;
  label: string;
  sceneId: string;
  gameState: GameState;
  chronicle: ChronicleEntry[];
}

// ─── Session ───────────────────────────────────────────────────────────────────

export interface AdventureSession {
  id: string;
  userId: string;
  title: string;
  genre: string;
  experienceType: "adventure" | "date";
  theme?: string;
  status: "active" | "paused" | "completed" | "abandoned";
  createdAt: number;
  updatedAt: number;
  currentSceneId: string;
  history: string[];
  gameState: GameState;
  chronicle: ChronicleEntry[];
  metadata: Record<string, unknown>;
  saves: Record<string, AdventureSnapshot>;
  lastScene?: AdventureScene;
  romanceState?: RomanceState;
  romanceHistory?: Array<{
    timestamp: number;
    summary: string;
    affectionDelta: number;
    trustDelta: number;
    tags?: string[];
  }>;
}

// ─── Adventure Data (Wire Format) ──────────────────────────────────────────────

export interface AdventureData {
  type:
    | "adventure_start"
    | "adventure_scene"
    | "choice_result"
    | "background_change"
    | "dialogue"
    | "choices"
    | "music"
    | "adventure_end"
    | "character_emotion"
    | "status_update";
  sessionId: string;
  userId: string;
  mode?: "adventure" | "date";
  scene?: AdventureScene;
  choices?: SceneChoice[];
  emotion?: Emotion;
  animation?: string;
  message?: string;
  gameState?: GameState;
  chronicle?: ChronicleEntry[];
  background?: {
    url?: string;
    prompt?: string;
  };
  status?: "active" | "paused" | "completed" | "abandoned";
  romanceState?: RomanceState;
  affectionDelta?: number;
  choiceContext?: {
    id: string;
    text: string;
    tags?: string[];
  };
}

// ─── Tool Payloads ─────────────────────────────────────────────────────────────

export interface AdventureToolPayload {
  sessionId: string;
  userId: string;
  summary?: string;
  scene?: AdventureScene;
  choice?: SceneChoice;
  backgroundImage?: {
    url?: string;
    data?: string;
    mimeType?: string;
    prompt?: string;
  };
  adventureData: AdventureData;
  gameState?: GameState;
  chronicle?: ChronicleEntry[];
  romanceState?: RomanceState;
  sessions?: Array<{
    id: string;
    title?: string;
    status?: AdventureSession["status"];
    createdAt?: number;
    updatedAt?: number;
    genre?: string;
    theme?: string;
  }>;
  saves?: Array<{
    saveId: string;
    label: string;
    createdAt: number;
    sessionId: string;
  }>;
}

export type AdventureToolResult =
  | { success: true; data: AdventureToolPayload }
  | { success: false; error: string };

// ─── Romance ───────────────────────────────────────────────────────────────────

export interface RomanceBoundaries {
  allowPhysical: boolean;
  allowExplicit: boolean;
}

export interface RomanceState {
  affectionScore: number; // 0 - 100
  trustLevel: number; // 0 - 100
  intimacyStage: "playful" | "tender" | "passionate";
  boundaries: RomanceBoundaries;
  momentum: "cooling" | "steady" | "surging";
  streak: number;
  recentMemories: string[];
  lastInteractionAt: number;
  lastAffectionDelta?: number;
  lastTrustDelta?: number;
}

// ─── Tool Handler Param Interfaces ─────────────────────────────────────────────

export interface StartAdventureParams {
  genre?: string;
  theme?: string;
  playerName?: string;
  mood?: Emotion;
  userId?: string;
  mode?: "adventure" | "date";
}

export interface MakeChoiceParams {
  adventureId?: string;
  choiceId: string;
  userId?: string;
}

export interface PerformActionParams {
  adventureId?: string;
  action: string;
  target?: string;
  userId?: string;
}

export interface ChangeBackgroundParams {
  adventureId?: string;
  backgroundUrl?: string;
  description?: string;
  transition?: "fade" | "slide" | "zoom" | "none";
}

export interface EmotionParams {
  adventureId?: string;
  emotion: Emotion;
  animation?: string;
  duration?: number;
}

export interface DialogueParams {
  adventureId?: string;
  speaker: string;
  content: string;
  emotion?: Emotion;
  animation?: string;
}

export interface PresentChoicesParams {
  adventureId?: string;
  choices: Array<Pick<SceneChoice, "id" | "text" | "description">>;
  timeout?: number;
}

export interface SaveAdventureParams {
  adventureId: string;
  slot?: number;
  name?: string;
}

export interface LoadAdventureParams {
  saveId: string;
}

export interface GenerateSceneParams {
  adventureId: string;
  sceneType?: "story" | "battle" | "social";
  context?: string;
}

// ─── LLM Scene Result ──────────────────────────────────────────────────────────

export interface LLMSceneResult {
  title: string;
  description: string;
  backgroundDescription: string;
  choices: Array<{ text: string; description?: string }>;
  plot: string;
  goal: string;
  stakes: string;
}

// ─── Planned Scene ─────────────────────────────────────────────────────────────

export interface PlannedScene {
  title: string;
  description: string;
  backgroundUrl?: string;
  backgroundPrompt?: string;
  dialogue?: string[];
  musicCue?: string;
  sprites?: Array<{
    character?: string;
    pose?: string;
    emotion?: string;
    layer?: string;
    visible?: boolean;
  }>;
  id?: string;
  choices: Array<{
    id?: string;
    text: string;
    description?: string;
    nextId?: string;
  }>;
}
