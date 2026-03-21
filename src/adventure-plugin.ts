/**
 * Adventure Plugin — Entry Point
 *
 * Plugin lifecycle, tool registration, and chat hooks.
 * All heavy logic is delegated to focused modules:
 *   - types.ts          — Type definitions
 *   - narrative-engine.ts — Story/dialogue/scene generation
 *   - world-builder.ts  — Scene building, background images, preplanning
 *   - combat-system.ts  — XP, romance state, choice consequences
 *   - game-engine.ts    — Session CRUD, persistence, scene store
 */

import {
  ensureProviderRegistration,
  kvService,
  createMediaStorageService,
  ProviderImageGenerationService,
  type ImageStylePreset,
  type MediaStorageService,
} from "@phantasy/agent/plugin-runtime";
import {
  BasePlugin,
  PluginContext,
  PluginResponse,
  PluginTool,
  PluginConfig,
  PluginManifest,
} from "@phantasy/agent/plugins";

// ─── Internal module imports ───────────────────────────────────────────────────

import type {
  AdventurePluginConfig,
  AdventureSession,
  AdventureScene,
  AdventureData,
  AdventureToolResult,
  SceneChoice,
  StartAdventureParams,
  MakeChoiceParams,
  PerformActionParams,
  ChangeBackgroundParams,
  EmotionParams,
  DialogueParams,
  PresentChoicesParams,
  SaveAdventureParams,
  LoadAdventureParams,
  GenerateSceneParams,
  AdventureSnapshot,
} from "./types";

import {
  DEFAULT_AUTO_START_KEYWORDS,
  DEFAULT_ASSETS,
  mapEmotionToAnimation,
  randomFallbackBackground,
} from "./narrative-engine";

import {
  buildScene,
  preplanAdventure,
  generateBackgroundImage as generateBackgroundImageImpl,
} from "./world-builder";

import {
  applyChoiceConsequences,
  updateRomanceState,
} from "./combat-system";

import {
  createSession,
  createChronicleEntry,
  persistSession,
  resolveUserId,
  resolveOrLoadSession,
  resolveExperienceType,
  ensureSceneStore,
  saveScene as saveSceneFn,
  getStoredScene,
  dropSession,
  kvKeySession,
  kvKeySessionByUser,
  kvKeySave,
} from "./game-engine";

function readAdventureRouteString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveAdventureLlmRoute(
  agentConfig: Record<string, unknown> | null | undefined,
): { provider: string; model: string } {
  const modelRouting = agentConfig?.modelRouting as
    | {
        default?: {
          provider?: unknown;
          model?: unknown;
        };
      }
    | undefined;
  const defaultRoute = modelRouting?.default;

  return {
    provider: readAdventureRouteString(defaultRoute?.provider) || "venice",
    model:
      readAdventureRouteString(defaultRoute?.model) ||
      readAdventureRouteString(agentConfig?.model) ||
      "",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AdventurePlugin
// ═══════════════════════════════════════════════════════════════════════════════

export class AdventurePlugin extends BasePlugin {
  name = "adventure";
  version = "2.0.0";
  description =
    "Interactive adventure and visual novel system for immersive storytelling";

  private pluginConfig: AdventurePluginConfig = {};
  private sessions: Map<string, AdventureSession> = new Map();
  private sessionByUser: Map<string, string> = new Map();
  private contextByUser: Map<string, PluginContext> = new Map();
  private scenesBySession: Map<string, Map<string, AdventureScene>> = new Map();
  private imageService: ProviderImageGenerationService | null = null;
  private lastSeenUserId: string | null = null;
  private agentName: string = "Guide";
  private llmProvider: string | null = null;
  private llmModel: string | null = null;
  private agentConfigRef: Record<string, unknown> | null = null;
  private mediaStorageService: MediaStorageService | null = null;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onInit(
    agentConfig: Record<string, unknown>,
    config?: AdventurePluginConfig,
  ): Promise<void> {
    const mergedConfig: AdventurePluginConfig = {
      enabled: true,
      defaultGenre: "fantasy",
      defaultTheme: "mystical forest",
      autoStartKeywords: DEFAULT_AUTO_START_KEYWORDS,
      playerName: "Adventurer",
      dateModeEnabled: true,
      defaultDateTheme: "moonlit skyline",
      romanceBoundaries: {
        allowPhysical: true,
        allowExplicit: false,
      },
      romanceInitialAffection: 45,
      datePresets: [
        {
          title: "Neon Skyline Stroll",
          genre: "romance",
          theme: "neon-lit rooftop garden overlooking the city",
          description:
            "A night walk above the city lights with soft synthwave vibes and playful teasing.",
          mood: "excited",
        },
        {
          title: "Cozy Cafe Hideaway",
          genre: "romance",
          theme: "warm candlelit speakeasy café with vinyl playing",
          description:
            "Slow conversation, gentle touches, and a safe space to share secrets over lattes.",
          mood: "tender",
        },
        {
          title: "Arcade Date Night",
          genre: "romance",
          theme: "retro arcade with neon glow and private booths",
          description:
            "Competitive flirting, plushie prizes, and the question of a stolen kiss between games.",
          mood: "playful",
        },
      ],
      dateMusic: {
        intro: DEFAULT_ASSETS.music.romance.intro,
        loop: DEFAULT_ASSETS.music.romance.loop,
        swell: DEFAULT_ASSETS.music.romance.swell,
      },
      ...config,
    };

    await super.onInit(agentConfig as never, mergedConfig as PluginConfig);
    this.pluginConfig = mergedConfig;

    const provider =
      (mergedConfig.imageProvider || agentConfig?.image_provider || "venice") as string;
    const defaultStyle = agentConfig?.default_image_style as ImageStylePreset | undefined;

    this.imageService = new ProviderImageGenerationService({
      defaultProvider: provider,
      defaultStyle: defaultStyle,
    });

    try {
      await ensureProviderRegistration();
    } catch (e) {
      /* ignore */
    }

    const resolvedLlmRoute = resolveAdventureLlmRoute(agentConfig);
    this.llmProvider = resolvedLlmRoute.provider;
    this.llmModel = resolvedLlmRoute.model;
    this.agentConfigRef = agentConfig || null;

    this.log.info("AdventurePlugin initialized", {
      provider,
      defaultGenre: mergedConfig.defaultGenre,
      defaultTheme: mergedConfig.defaultTheme,
      llmProvider: this.llmProvider,
      llmModel: this.llmModel,
    });

    try {
      if (agentConfig?.name && typeof agentConfig.name === "string") {
        this.agentName = agentConfig.name;
      }
    } catch (e) {
      /* ignore */
    }

    try {
      const mediaCfg = agentConfig?.mediaConfig as Record<string, unknown> | undefined;
      if (mediaCfg?.enabled) {
        this.mediaStorageService = createMediaStorageService(mediaCfg);
      } else {
        this.mediaStorageService = createMediaStorageService({
          enabled: true,
          provider: "local",
          local_path: "./media",
          auto_save_generated: true,
          allowed_types: [
            "jpg", "jpeg", "png", "gif", "webp",
            "mp4", "webm", "mp3", "wav", "ogg",
          ],
        });
      }
      this.log.info("Adventure media storage initialized", {
        autoSave: this.mediaStorageService?.isAutoSaveEnabled?.(),
      });
    } catch (e) {
      this.log.warn("Failed to initialize media storage in Adventure plugin", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  getManifest(): PluginManifest {
    return {
      name: this.name,
      version: this.version,
      description: this.description || "Adventure plugin",
      workspace: "character",
      extensionKind: "behavior",
      configSchema: {
        type: "object",
        properties: {
          enabled: { type: "boolean", title: "Enabled", default: true },
          defaultGenre: {
            type: "string",
            title: "Default Genre",
            default: "fantasy",
          },
          defaultTheme: {
            type: "string",
            title: "Default Theme",
            default: "mystical forest",
          },
          playerName: {
            type: "string",
            title: "Default Player Name",
            default: "Adventurer",
          },
          imageProvider: {
            type: "string",
            title: "Image Provider",
            enum: ["venice", "alkahest", "openai"],
            default: "venice",
          },
          autoStartKeywords: {
            type: "array",
            title: "Auto-start Keywords",
            items: { type: "string" },
            default: DEFAULT_AUTO_START_KEYWORDS,
          },
          preStartGuidance: {
            type: "string",
            title: "Pre-start Guidance (System)",
            description:
              "Custom system note appended when user asks to start an adventure",
          },
        },
      },
    };
  }

  async onConfigUpdated(newConfig: PluginConfig): Promise<void> {
    this.pluginConfig = {
      ...this.pluginConfig,
      ...(newConfig as AdventurePluginConfig),
    };

    if ((newConfig as AdventurePluginConfig)?.dateMusic) {
      this.pluginConfig.dateMusic = {
        ...{
          intro: DEFAULT_ASSETS.music.romance.intro,
          loop: DEFAULT_ASSETS.music.romance.loop,
          swell: DEFAULT_ASSETS.music.romance.swell,
        },
        ...this.pluginConfig.dateMusic,
        ...(newConfig as AdventurePluginConfig).dateMusic,
      };
    }

    const provider = (this.pluginConfig.imageProvider as string) || "venice";
    const defaultStyle = (this.agentConfigRef as Record<string, unknown> | null)?.default_image_style as ImageStylePreset | undefined;
    this.imageService = new ProviderImageGenerationService({
      defaultProvider: provider,
      defaultStyle,
    });
  }

  // ─── Chat Hooks ────────────────────────────────────────────────────────────

  async beforeChat(context: PluginContext): Promise<PluginResponse> {
    if (!this.enabled) return { shouldContinue: true };

    this.contextByUser.set(context.userId, context);
    this.lastSeenUserId = context.userId;

    const sessionId = this.sessionByUser.get(context.userId);
    const metadata: Record<string, unknown> = {};
    if (sessionId) {
      metadata.adventureSessionId = sessionId;
    }

    const keywords =
      this.pluginConfig.autoStartKeywords || DEFAULT_AUTO_START_KEYWORDS;
    const messageLower = context.message.toLowerCase();
    const wantsAdventure = keywords.some((keyword) =>
      messageLower.includes(keyword),
    );

    if (wantsAdventure && !sessionId) {
      metadata.adventureIntent = {
        type: "start",
        genre: this.pluginConfig.defaultGenre,
        theme: this.pluginConfig.defaultTheme,
      };

      const defaultGuidance = `

[system note: The user asked to enter adventure mode.

You are the user's cheerful Navi and guide. Start warmly and invite the user to either:
  1) Continue a previous adventure
  2) Start a new adventure

If continuing, call the adventure_list_saved_adventures tool to fetch their adventures/saves and summarize options. When the user chooses, resume with adventure_resume_adventure (for a session) or adventure_load_adventure (for a save).

If starting new, ask for preferences (quick and fun): genre, theme (setting), player name, and mood. Offer a few quick-start presets in your message (e.g. "Fantasy Explorer", "Neon City Date Night", "Cozy Mystery"). Once the user confirms or selects a preset, call adventure_start_adventure with their choices.

Keep it friendly and cohesive. Let the user know you'll handle art and ambience. Do not start the adventure until they confirm their choice (continue or new).]`;
      const guidance = this.pluginConfig?.preStartGuidance
        ? `\n\n[system note: ${this.pluginConfig.preStartGuidance}]`
        : `\n\n${defaultGuidance}`;

      return {
        shouldContinue: true,
        modifiedMessage: `${context.message}${guidance}`,
        additionalMetadata: metadata,
      };
    }

    if (sessionId) {
      const storyNote = `\n\n[system note: Adventure Mode is active. Write vivid, cohesive narration with 2-4 sentences per turn. Use sensory details and gentle pacing. Ignore any prior brevity constraints.]`;
      return {
        shouldContinue: true,
        modifiedMessage: `${context.message}${storyNote}`,
        additionalMetadata: metadata,
      };
    }

    if (Object.keys(metadata).length > 0) {
      return {
        shouldContinue: true,
        additionalMetadata: metadata,
      };
    }

    return { shouldContinue: true };
  }

  async afterChat(
    context: PluginContext,
    reply: string,
  ): Promise<PluginResponse> {
    if (!this.enabled)
      return {
        shouldContinue: true,
        emotion: "neutral",
        animation: "idle",
        metadata: { reply },
      } as PluginResponse;

    const sessionId = this.sessionByUser.get(context.userId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    return {
      shouldContinue: true,
      emotion: session?.gameState.player.mood || "neutral",
      animation: session
        ? mapEmotionToAnimation(session.gameState.player.mood)
        : "idle",
      additionalMetadata: session
        ? {
            adventureSessionId: session.id,
            adventureStatus: session.status,
          }
        : undefined,
    };
  }

  // ─── Tools ─────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    if (!this.enabled) return [];

    return [
      {
        name: "rename_adventure",
        description: "Rename an adventure session title",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            title: { type: "string" },
          },
          required: ["adventureId", "title"],
        },
        handler: async ({
          adventureId,
          title,
        }: {
          adventureId: string;
          title: string;
        }) => {
          const session = await this._resolveOrLoadSession(adventureId);
          if (!session)
            return { success: false, error: "Adventure session not found" };
          session.title = String(title).trim() || session.title;
          session.updatedAt = Date.now();
          await this._persistSession(session);
          return {
            success: true,
            data: {
              sessionId: session.id,
              userId: session.userId,
              summary: "Adventure renamed",
              adventureData: {
                type: "status_update",
                sessionId: session.id,
                userId: session.userId,
                message: "Adventure renamed",
                gameState: session.gameState,
                chronicle: session.chronicle,
                mode: session.experienceType,
                romanceState: session.romanceState,
              },
            },
          };
        },
      },
      {
        name: "delete_adventure",
        description: "Delete/abandon an adventure session",
        parameters: {
          type: "object",
          properties: { adventureId: { type: "string" } },
          required: ["adventureId"],
        },
        handler: async ({ adventureId }: { adventureId: string }) => {
          const session = await this._resolveOrLoadSession(adventureId);
          if (!session)
            return { success: false, error: "Adventure session not found" };
          try {
            session.status = "abandoned";
            session.updatedAt = Date.now();
            await this._persistSession(session);
            try { await kvService.delete(kvKeySessionByUser(session.userId)); } catch (e) { /* ignore */ }
            try { await kvService.delete(kvKeySession(session.id)); } catch (e) { /* ignore */ }
            dropSession(session.id, this.sessions, this.scenesBySession);
            this.sessionByUser.delete(session.userId);
          } catch (e) { /* ignore */ }
          return {
            success: true,
            data: {
              sessionId: adventureId,
              userId: session.userId,
              summary: "Adventure deleted",
              adventureData: {
                type: "status_update",
                sessionId: adventureId,
                userId: session.userId,
                message: "Adventure deleted",
                mode: session.experienceType,
                romanceState: session.romanceState,
              },
            },
          };
        },
      },
      {
        name: "list_saved_adventures",
        description: "List all adventures and saves for the current user",
        parameters: { type: "object", properties: { userId: { type: "string" } } },
        handler: async (params: { userId?: string }) =>
          this.handleListSavedAdventures(params?.userId),
      },
      {
        name: "start_adventure",
        description: "Start a new interactive visual novel adventure",
        parameters: {
          type: "object",
          properties: {
            genre: { type: "string", description: "Adventure genre (fantasy, sci-fi, mystery, romance, horror)" },
            theme: { type: "string", description: "Specific theme or setting for the adventure" },
            playerName: { type: "string", description: "Player character name" },
            mood: { type: "string", description: "Initial mood for the companion's expression" },
            mode: { type: "string", enum: ["adventure", "date"], description: "Experience mode: default adventure; use date for romance sessions" },
            forceNew: { type: "boolean", description: "Force creation of a new adventure even if one is active", default: false },
          },
        },
        handler: (params: StartAdventureParams) => this.handleStartAdventure(params),
      },
      {
        name: "make_choice",
        description: "Advance the story by applying a player choice",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string", description: "Adventure session identifier" },
            choiceId: { type: "string", description: "Choice identifier to apply" },
          },
          required: ["choiceId"],
        },
        handler: (params: MakeChoiceParams) => this.handleMakeChoice(params),
      },
      {
        name: "perform_action",
        description: "Handle a free-form player action within the adventure",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            action: { type: "string" },
            target: { type: "string" },
          },
          required: ["action"],
        },
        handler: (params: PerformActionParams) => this.handlePerformAction(params),
      },
      {
        name: "change_background",
        description: "Update the visual background for the current scene",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            backgroundUrl: { type: "string" },
            description: { type: "string" },
            transition: { type: "string", enum: ["fade", "slide", "zoom", "none"], default: "fade" },
          },
        },
        handler: (params: ChangeBackgroundParams) => this.handleChangeBackground(params),
      },
      {
        name: "set_character_emotion",
        description: "Adjust the companion's expression to match the story beat",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            emotion: { type: "string" },
            animation: { type: "string" },
            duration: { type: "number" },
          },
          required: ["emotion"],
        },
        handler: (params: EmotionParams) => this.handleSetEmotion(params),
      },
      {
        name: "show_dialogue",
        description: "Render a dialogue line in the visual novel UI",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            speaker: { type: "string" },
            content: { type: "string" },
            emotion: { type: "string" },
            animation: { type: "string" },
          },
          required: ["speaker", "content"],
        },
        handler: (params: DialogueParams) => this.handleShowDialogue(params),
      },
      {
        name: "present_choices",
        description: "Display the next set of dialogue options to the player",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  description: { type: "string" },
                },
                required: ["id", "text"],
              },
            },
            timeout: { type: "number" },
          },
          required: ["choices"],
        },
        handler: (params: PresentChoicesParams) => this.handlePresentChoices(params),
      },
      {
        name: "play_music",
        description: "Play or update background music for the adventure",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            musicUrl: { type: "string" },
            volume: { type: "number" },
            loop: { type: "boolean" },
          },
          required: ["musicUrl"],
        },
        handler: (params: { musicUrl: string; volume?: number; loop?: boolean }) => this.handlePlayMusic(params),
      },
      {
        name: "save_adventure",
        description: "Create a save point for the current adventure",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            slot: { type: "number" },
            name: { type: "string" },
          },
          required: ["adventureId"],
        },
        handler: (params: SaveAdventureParams) => this.handleSaveAdventure(params),
      },
      {
        name: "load_adventure",
        description: "Restore an adventure from a saved snapshot",
        parameters: {
          type: "object",
          properties: { saveId: { type: "string" } },
          required: ["saveId"],
        },
        handler: (params: LoadAdventureParams) => this.handleLoadAdventure(params),
      },
      {
        name: "rename_save",
        description: "Rename an existing save snapshot",
        parameters: {
          type: "object",
          properties: {
            saveId: { type: "string" },
            name: { type: "string" },
          },
          required: ["saveId", "name"],
        },
        handler: (params: { saveId: string; name: string }) =>
          this.handleRenameSave(params.saveId, params.name),
      },
      {
        name: "delete_save",
        description: "Delete a saved snapshot",
        parameters: {
          type: "object",
          properties: { saveId: { type: "string" } },
          required: ["saveId"],
        },
        handler: (params: { saveId: string }) => this.handleDeleteSave(params.saveId),
      },
      {
        name: "get_adventure_status",
        description: "Retrieve current adventure session information",
        parameters: {
          type: "object",
          properties: { adventureId: { type: "string" } },
          required: ["adventureId"],
        },
        handler: ({ adventureId }: { adventureId: string }) =>
          this.handleGetStatus(adventureId),
      },
      {
        name: "pause_adventure",
        description: "Pause the current adventure so it can be resumed later",
        parameters: {
          type: "object",
          properties: { adventureId: { type: "string" } },
          required: ["adventureId"],
        },
        handler: ({ adventureId }: { adventureId: string }) =>
          this.handlePauseAdventure(adventureId),
      },
      {
        name: "resume_adventure",
        description: "Resume a paused adventure from the last scene",
        parameters: {
          type: "object",
          properties: { adventureId: { type: "string" } },
          required: ["adventureId"],
        },
        handler: ({ adventureId }: { adventureId: string }) =>
          this.handleResumeAdventure(adventureId),
      },
      {
        name: "generate_scene",
        description: "Generate a fresh scene while keeping the current session active",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            sceneType: { type: "string" },
            context: { type: "string" },
          },
          required: ["adventureId"],
        },
        handler: (params: GenerateSceneParams) => this.handleGenerateScene(params),
      },
      {
        name: "end_adventure",
        description: "End the adventure and provide a wrap-up summary",
        parameters: {
          type: "object",
          properties: {
            adventureId: { type: "string" },
            ending: { type: "string" },
            achievements: { type: "array", items: { type: "string" } },
            score: { type: "number" },
          },
          required: ["adventureId", "ending"],
        },
        handler: (params: { adventureId: string; ending: string; achievements?: string[]; score?: number }) =>
          this.handleEndAdventure(params),
      },
    ];
  }

  // ─── Internal Delegation Helpers ───────────────────────────────────────────

  private _resolveUserId(explicitUserId?: string | null): string | null {
    return resolveUserId(explicitUserId ?? null, this.lastSeenUserId);
  }

  private async _resolveOrLoadSession(
    adventureId?: string,
    userId?: string,
  ): Promise<AdventureSession | null> {
    return resolveOrLoadSession(
      adventureId,
      userId,
      this.sessions,
      this.sessionByUser,
      this.lastSeenUserId,
    );
  }

  private async _persistSession(session: AdventureSession): Promise<void> {
    return persistSession(session);
  }

  private _saveScene(sessionId: string, scene: AdventureScene): void {
    saveSceneFn(sessionId, scene, this.scenesBySession);
  }

  private _getStoredScene(session: AdventureSession, sceneId: string): AdventureScene | null {
    return getStoredScene(session, sceneId, this.scenesBySession);
  }

  private async _buildScene(
    session: AdventureSession,
    options: {
      reason: "intro" | "choice" | "action";
      previousChoice?: SceneChoice;
      action?: string;
      customContext?: string;
    },
  ): Promise<AdventureScene> {
    return buildScene(session, options, {
      pluginConfig: this.pluginConfig,
      agentName: this.agentName,
      llmProvider: this.llmProvider,
      llmModel: this.llmModel,
      agentConfigRef: this.agentConfigRef,
      imageService: this.imageService,
      mediaStorageService: this.mediaStorageService,
      log: this.log,
      persistSession: (s) => this._persistSession(s),
      saveScene: (sid, sc) => this._saveScene(sid, sc),
      generateBackgroundImage: (desc, sess, force) =>
        this._generateBackgroundImage(desc, sess, force),
    });
  }

  private async _generateBackgroundImage(
    description: string,
    session: AdventureSession,
    forceSave: boolean = false,
  ) {
    return generateBackgroundImageImpl(
      description,
      session,
      forceSave,
      this.imageService,
      this.mediaStorageService,
      this.pluginConfig,
      this.log,
    );
  }

  // ─── Tool Handlers ─────────────────────────────────────────────────────────

  private async handleStartAdventure(
    params: StartAdventureParams,
  ): Promise<AdventureToolResult> {
    const userId = this._resolveUserId(params.userId);
    if (!userId) {
      return { success: false, error: "Unable to determine user for adventure session" };
    }

    const existingSessionId =
      this.sessionByUser.get(userId) ||
      (await kvService.get<string>(kvKeySessionByUser(userId)));

    let forceNew = false;
    try {
      const ctx = this.contextByUser.get(userId);
      const msg = (ctx?.message || "").toLowerCase();
      const forceKeywords = [
        "new adventure", "start a new", "start new", "fresh adventure",
        "another adventure", "start another", "new romantic adventure",
        "new date adventure", "restart adventure", "restart date",
        "reset adventure", "reset date",
      ];
      forceNew = forceKeywords.some((k) => msg.includes(k));
    } catch (e) { /* ignore */ }

    if (params && (params as Record<string, unknown>).forceNew === true) {
      forceNew = true;
    }

    if (existingSessionId && !forceNew) {
      let session = this.sessions.get(existingSessionId);
      if (!session) {
        session =
          (await kvService.get<AdventureSession>(kvKeySession(existingSessionId))) || undefined;
        if (session) this.sessions.set(session.id, session);
      }
      if (session && session.status === "active") {
        const existingScene =
          session.lastScene || this._getStoredScene(session, session.currentSceneId);
        const scene =
          existingScene || (await this._buildScene(session, { reason: "intro" }));
        session.lastScene = scene;
        await this._persistSession(session);
        return {
          success: true,
          data: {
            sessionId: session.id,
            userId,
            summary: "Adventure already active — returning current scene",
            scene,
            adventureData: {
              type: "status_update",
              sessionId: session.id,
              userId,
              message: "Adventure already active",
              gameState: session.gameState,
              chronicle: session.chronicle,
            },
            gameState: session.gameState,
            chronicle: session.chronicle,
          },
        };
      }
    } else if (existingSessionId && forceNew) {
      try {
        const prev =
          this.sessions.get(existingSessionId) ||
          (await kvService.get<AdventureSession>(kvKeySession(existingSessionId))) ||
          null;
        if (prev) {
          prev.status = "abandoned";
          prev.updatedAt = Date.now();
          prev.chronicle.push(
            createChronicleEntry("action", prev.currentSceneId, "Adventure abandoned to start a new one"),
          );
          await this._persistSession(prev);
        }
      } catch (e) { /* ignore */ }
      try { await kvService.delete(kvKeySessionByUser(userId)); } catch (e) { /* ignore */ }
      this.sessionByUser.delete(userId);
    }

    const experienceType = resolveExperienceType(params, userId, this.pluginConfig, this.contextByUser);
    const defaultTheme =
      experienceType === "date"
        ? this.pluginConfig.defaultDateTheme || "moonlit skyline"
        : this.pluginConfig.defaultTheme || "mystical forest";
    const genre = (
      params.genre ||
      (experienceType === "date"
        ? "romance"
        : this.pluginConfig.defaultGenre || "fantasy")
    ).toLowerCase();
    const theme = params.theme || defaultTheme;
    const playerName = params.playerName || this.pluginConfig.playerName || "Adventurer";
    const initialMood = params.mood || (experienceType === "date" ? "happy" : undefined);

    const session = createSession(userId, genre, theme, playerName, initialMood, experienceType, this.pluginConfig);
    this.sessions.set(session.id, session);
    this.sessionByUser.set(userId, session.id);
    await kvService.set(kvKeySessionByUser(userId), session.id);
    await this._persistSession(session);
    ensureSceneStore(session.id, this.scenesBySession);

    await preplanAdventure(
      session,
      this.llmProvider,
      this.llmModel,
      this.agentConfigRef,
      this.imageService,
      this.pluginConfig,
      this.log,
      (s) => this._persistSession(s),
      (desc, sess, force) => this._generateBackgroundImage(desc, sess, force),
    );

    const scene = await this._buildScene(session, { reason: "intro" });

    session.currentSceneId = scene.id;
    session.history.push(scene.id);
    const introSummary =
      experienceType === "date"
        ? `Romantic date begins at the ${theme}`
        : `Adventure begins in the ${theme}`;
    session.chronicle.push(createChronicleEntry("scene", scene.id, introSummary));
    session.updatedAt = Date.now();
    session.lastScene = scene;
    await this._persistSession(session);

    const adventureData: AdventureData = {
      type: "adventure_start",
      sessionId: session.id,
      userId,
      mode: experienceType,
      scene,
      gameState: session.gameState,
      chronicle: session.chronicle,
      romanceState: session.romanceState,
      background: scene.backgroundUrl
        ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
        : undefined,
    };

    const summary =
      experienceType === "date"
        ? `Started a romantic date called "${session.title}"`
        : `Started a ${genre} adventure called "${session.title}"`;

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId,
        scene,
        summary,
        adventureData,
        gameState: session.gameState,
        chronicle: session.chronicle,
        romanceState: session.romanceState,
        backgroundImage: scene.backgroundUrl
          ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
          : undefined,
      },
    };
  }

  private async handleMakeChoice(params: MakeChoiceParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId, params.userId);
    if (!session) return { success: false, error: "Adventure session not found" };

    let storedScene = this._getStoredScene(session, session.currentSceneId);
    if (!storedScene) {
      if (session.lastScene) {
        this.log.warn("Stored scene missing; using lastScene fallback", {
          sessionId: session.id,
          expectedSceneId: session.currentSceneId,
          lastSceneId: session.lastScene.id,
        });
        storedScene = session.lastScene;
        session.currentSceneId = storedScene.id;
      }
    }
    if (!storedScene) return { success: false, error: "Current scene not available" };

    const choice = storedScene.choices.find((c) => c.id === params.choiceId);
    if (!choice) return { success: false, error: `Choice ${params.choiceId} not found` };

    const consequence = applyChoiceConsequences(session, choice, this.pluginConfig);

    if ((session.metadata as Record<string, unknown>)?.plannedFlow) {
      try {
        const map = ((session.metadata as Record<string, unknown>)?.lastChoiceMap || {}) as Record<string, string>;
        const nextId = map[choice.id];
        if (nextId && nextId !== "end") {
          (session.metadata as Record<string, unknown>).planCurrentId = nextId;
          await this._persistSession(session);
        } else {
          session.status = "completed";
          await this._persistSession(session);
          const endData: AdventureData = {
            type: "adventure_end",
            sessionId: session.id,
            userId: session.userId,
            message: "Adventure complete",
            status: "completed",
            gameState: session.gameState,
            chronicle: session.chronicle,
            mode: session.experienceType,
            romanceState: session.romanceState,
          };
          return {
            success: true,
            data: {
              sessionId: session.id,
              userId: session.userId,
              summary: `Choice applied: ${choice.text} (end)`,
              adventureData: endData,
              gameState: session.gameState,
              chronicle: session.chronicle,
            },
          };
        }
      } catch (e) { /* ignore */ }
    }

    session.history.push(choice.id);
    session.chronicle.push(
      createChronicleEntry("choice", storedScene.id, `Player chose: ${choice.text}`, { choiceId: choice.id }),
    );

    const nextScene = await this._buildScene(session, { reason: "choice", previousChoice: choice });

    session.currentSceneId = nextScene.id;
    session.history.push(nextScene.id);
    session.chronicle.push(createChronicleEntry("scene", nextScene.id, `Arrived at scene: ${nextScene.title}`));
    session.updatedAt = Date.now();
    session.lastScene = nextScene;
    await this._persistSession(session);

    const adventureData: AdventureData = {
      type: "choice_result",
      sessionId: session.id,
      userId: session.userId,
      scene: nextScene,
      choices: nextScene.choices,
      gameState: session.gameState,
      chronicle: session.chronicle,
      mode: session.experienceType,
      romanceState: consequence.romanceState || session.romanceState,
      affectionDelta: consequence.affectionDelta,
      choiceContext: { id: choice.id, text: choice.text, tags: choice.tags },
    };

    const summaryAffection =
      session.experienceType === "date" &&
      typeof consequence.affectionDelta === "number"
        ? ` (affection ${consequence.affectionDelta >= 0 ? "+" : ""}${consequence.affectionDelta})`
        : "";

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Choice applied: ${choice.text}${summaryAffection}`,
        scene: nextScene,
        choice,
        adventureData,
        gameState: session.gameState,
        chronicle: session.chronicle,
        romanceState: consequence.romanceState || session.romanceState,
        backgroundImage: nextScene.backgroundUrl
          ? { url: nextScene.backgroundUrl, prompt: nextScene.backgroundPrompt }
          : undefined,
      },
    };
  }

  private async handlePerformAction(params: PerformActionParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId, params.userId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const actionText = params.target ? `${params.action} ${params.target}` : params.action;
    const scene = await this._buildScene(session, { reason: "action", action: actionText });

    session.currentSceneId = scene.id;
    session.history.push(scene.id);
    session.chronicle.push(createChronicleEntry("action", scene.id, `Action performed: ${actionText}`));

    let romanceStateForAction = session.romanceState;
    let affectionDeltaForAction: number | undefined;
    if (session.experienceType === "date") {
      const lower = actionText.toLowerCase();
      let affectionChange = 1;
      let trustChange = 0;
      const tags: string[] = [];

      if (lower.includes("kiss") || lower.includes("embrace") || lower.includes("hold")) {
        affectionChange += 3;
        tags.push("physical");
      }
      if (lower.includes("whisper") || lower.includes("confess") || lower.includes("share")) {
        trustChange += 2;
        tags.push("emotional");
      }
      if (lower.includes("tease") || lower.includes("challenge")) {
        affectionChange += 1;
        tags.push("playful");
      }
      if (lower.includes("nsfw") || lower.includes("bed")) {
        tags.push("explicit");
        affectionChange += 1;
      }

      const result = updateRomanceState(session, {
        affection: affectionChange,
        trust: trustChange,
        summary: `Action: ${actionText}`,
        tags,
      }, this.pluginConfig);
      affectionDeltaForAction = result.affectionDelta;
      romanceStateForAction = result.romanceState;
      session.gameState.player.mood =
        result.romanceState.intimacyStage === "passionate"
          ? "passionate"
          : result.romanceState.intimacyStage === "tender"
            ? "tender"
            : "flirty";
    } else {
      session.gameState.player.mood = "determined";
    }

    session.updatedAt = Date.now();
    session.lastScene = scene;
    await this._persistSession(session);

    const adventureData: AdventureData = {
      type: "adventure_scene",
      sessionId: session.id,
      userId: session.userId,
      scene,
      choices: scene.choices,
      gameState: session.gameState,
      chronicle: session.chronicle,
      mode: session.experienceType,
      romanceState: romanceStateForAction,
      affectionDelta: affectionDeltaForAction,
    };

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Action handled: ${actionText}`,
        scene,
        adventureData,
        gameState: session.gameState,
        chronicle: session.chronicle,
        romanceState: romanceStateForAction,
        backgroundImage: scene.backgroundUrl
          ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
          : undefined,
      },
    };
  }

  private async handleChangeBackground(params: ChangeBackgroundParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    let imageInfo: { url?: string; data?: string; mimeType?: string; prompt?: string } | undefined;
    let backgroundUrl = params.backgroundUrl;

    if (!backgroundUrl && params.description) {
      const generated = await this._generateBackgroundImage(params.description, session);
      if (generated) {
        backgroundUrl = generated.url;
        imageInfo = generated;
      }
    }

    if (!backgroundUrl) {
      backgroundUrl = randomFallbackBackground();
    }

    const adventureData: AdventureData = {
      type: "background_change",
      sessionId: session.id,
      userId: session.userId,
      background: { url: backgroundUrl, prompt: params.description },
      message: "Background updated",
      mode: session.experienceType,
      romanceState: session.romanceState,
    };

    await this._persistSession(session);
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Background changed",
        adventureData,
        backgroundImage: imageInfo || { url: backgroundUrl, prompt: params.description },
        romanceState: session.romanceState,
      },
    };
  }

  private async handleSetEmotion(params: EmotionParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    session.gameState.player.mood = params.emotion;
    session.updatedAt = Date.now();

    const adventureData: AdventureData = {
      type: "character_emotion",
      sessionId: session.id,
      userId: session.userId,
      emotion: params.emotion,
      animation: params.animation,
      message: `Companion expression changed to ${params.emotion}`,
      mode: session.experienceType,
      romanceState: session.romanceState,
    };

    await this._persistSession(session);
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Emotion set to ${params.emotion}`,
        adventureData,
        gameState: session.gameState,
        romanceState: session.romanceState,
      },
    };
  }

  private async handleShowDialogue(params: DialogueParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const emotion = params.emotion || session.gameState.player.mood;

    const adventureData: AdventureData = {
      type: "dialogue",
      sessionId: session.id,
      userId: session.userId,
      scene: {
        id: session.currentSceneId,
        title: "Dialogue",
        description: params.content,
        backgroundUrl: undefined,
        backgroundPrompt: undefined,
        musicUrl: undefined,
        characterEmotion: emotion,
        dialogue: {
          speaker: params.speaker,
          speakerName: params.speaker,
          content: params.content,
          emotion,
          animation: params.animation,
        },
        choices: [],
      },
      emotion,
      message: params.content,
      mode: session.experienceType,
      romanceState: session.romanceState,
    };

    await this._persistSession(session);
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Dialogue shown from ${params.speaker}`,
        adventureData,
        romanceState: session.romanceState,
      },
    };
  }

  private async handlePresentChoices(params: PresentChoicesParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const choices: SceneChoice[] = params.choices.map((choice) => ({
      id: choice.id,
      text: choice.text,
      description: choice.description,
      enabled: true,
    }));

    const adventureData: AdventureData = {
      type: "choices",
      sessionId: session.id,
      userId: session.userId,
      choices,
      message: "New choices available",
      mode: session.experienceType,
      romanceState: session.romanceState,
    };

    await this._persistSession(session);
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Choices presented to player",
        adventureData,
        romanceState: session.romanceState,
      },
    };
  }

  private async handlePlayMusic(params: Record<string, unknown>): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId as string | undefined);
    const adventureData: AdventureData = {
      type: "music",
      sessionId: session?.id || "unknown",
      userId: session?.userId || this._resolveUserId(null) || "unknown",
      message: "Background music updated",
      mode: session?.experienceType,
      romanceState: session?.romanceState,
    };

    return {
      success: true,
      data: {
        sessionId: adventureData.sessionId,
        userId: adventureData.userId,
        summary: `Playing music ${params.musicUrl || "default"}`,
        adventureData,
        romanceState: session?.romanceState,
      },
    };
  }

  private async handleSaveAdventure(params: SaveAdventureParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const existingSaves = Object.values(session.saves || {});
    if (existingSaves.length >= 6) {
      return { success: false, error: "Save limit reached (max 6 per adventure)" };
    }

    const snapshotId = params.slot
      ? `${session.id}-slot-${params.slot}`
      : `${session.id}-auto-${Date.now()}`;
    const snapshot: AdventureSnapshot = {
      id: snapshotId,
      createdAt: Date.now(),
      label: params.name || `Save ${Object.keys(session.saves).length + 1}`,
      sceneId: session.currentSceneId,
      gameState: JSON.parse(JSON.stringify(session.gameState)),
      chronicle: [...session.chronicle],
    };
    session.saves[snapshotId] = snapshot;
    await kvService.set(kvKeySave(session.id, snapshotId), snapshot);
    await this._persistSession(session);

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Adventure saved as ${snapshotId}`,
        adventureData: {
          type: "status_update",
          sessionId: session.id,
          userId: session.userId,
          message: `Adventure saved (${snapshotId})`,
          mode: session.experienceType,
          romanceState: session.romanceState,
        },
        romanceState: session.romanceState,
      },
    };
  }

  private async handleLoadAdventure(params: LoadAdventureParams): Promise<AdventureToolResult> {
    for (const session of this.sessions.values()) {
      if (session.saves[params.saveId]) {
        const snapshot = session.saves[params.saveId];
        session.currentSceneId = snapshot.sceneId;
        session.gameState = JSON.parse(JSON.stringify(snapshot.gameState));
        session.chronicle = [...snapshot.chronicle];
        session.updatedAt = Date.now();

        const scene = await this._buildScene(session, { reason: "intro" });
        session.currentSceneId = scene.id;
        session.lastScene = scene;
        await this._persistSession(session);

        return {
          success: true,
          data: {
            sessionId: session.id,
            userId: session.userId,
            summary: `Loaded adventure from ${snapshot.label}`,
            scene,
            adventureData: {
              type: "status_update",
              sessionId: session.id,
              userId: session.userId,
              scene,
              message: `Adventure loaded from ${snapshot.label}`,
              gameState: session.gameState,
              chronicle: session.chronicle,
            },
            gameState: session.gameState,
            chronicle: session.chronicle,
            backgroundImage: scene.backgroundUrl
              ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
              : undefined,
          },
        };
      }
    }

    // Fallback: attempt to load from KV
    const sessionKeys = await kvService.list("adventure:session:");
    for (const key of sessionKeys) {
      const sess = await kvService.get<AdventureSession>(key);
      if (!sess) continue;
      const snap = await kvService.get<AdventureSnapshot>(kvKeySave(sess.id, params.saveId));
      if (snap) {
        this.sessions.set(sess.id, sess);
        this.sessionByUser.set(sess.userId, sess.id);
        sess.currentSceneId = snap.sceneId;
        sess.gameState = JSON.parse(JSON.stringify(snap.gameState));
        sess.chronicle = [...snap.chronicle];
        sess.updatedAt = Date.now();
        const scene = await this._buildScene(sess, { reason: "intro" });
        sess.currentSceneId = scene.id;
        sess.lastScene = scene;
        await this._persistSession(sess);
        return {
          success: true,
          data: {
            sessionId: sess.id,
            userId: sess.userId,
            summary: `Loaded adventure from ${snap.label}`,
            scene,
            adventureData: {
              type: "status_update",
              sessionId: sess.id,
              userId: sess.userId,
              scene,
              message: `Adventure loaded from ${snap.label}`,
              gameState: sess.gameState,
              chronicle: sess.chronicle,
            },
            gameState: sess.gameState,
            chronicle: sess.chronicle,
            backgroundImage: scene.backgroundUrl
              ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
              : undefined,
          },
        };
      }
    }

    return { success: false, error: `Save ${params.saveId} not found` };
  }

  private async handleRenameSave(saveId: string, name: string): Promise<AdventureToolResult> {
    for (const session of this.sessions.values()) {
      if (session.saves[saveId]) {
        session.saves[saveId].label = name;
        await kvService.set(kvKeySave(session.id, saveId), session.saves[saveId]);
        await this._persistSession(session);
        return {
          success: true,
          data: {
            sessionId: session.id,
            userId: session.userId,
            summary: `Save renamed to ${name}`,
            adventureData: {
              type: "status_update",
              sessionId: session.id,
              userId: session.userId,
              message: `Save renamed: ${name}`,
              gameState: session.gameState,
              chronicle: session.chronicle,
            },
          },
        };
      }
    }
    // Fallback: scan KV saves
    const saveKeys = await kvService.list("adventure:save:");
    for (const key of saveKeys) {
      const snap = await kvService.get<AdventureSnapshot>(key);
      if (!snap || snap.id !== saveId) continue;
      const sessionId = key.split(":")[2];
      const sess = await kvService.get<AdventureSession>(kvKeySession(sessionId));
      if (!sess) break;
      snap.label = name;
      await kvService.set(key, snap);
      const inMem = this.sessions.get(sessionId);
      if (inMem) {
        inMem.saves[saveId] = snap;
        await this._persistSession(inMem);
        return {
          success: true,
          data: {
            sessionId: inMem.id,
            userId: inMem.userId,
            summary: `Save renamed to ${name}`,
            adventureData: {
              type: "status_update",
              sessionId: inMem.id,
              userId: inMem.userId,
              message: `Save renamed: ${name}`,
            },
          },
        };
      }
      return {
        success: true,
        data: {
          sessionId,
          userId: sess.userId,
          summary: `Save renamed to ${name}`,
          adventureData: {
            type: "status_update",
            sessionId,
            userId: sess.userId,
            message: `Save renamed: ${name}`,
          },
        },
      };
    }
    return { success: false, error: `Save ${saveId} not found` };
  }

  private async handleDeleteSave(saveId: string): Promise<AdventureToolResult> {
    for (const session of this.sessions.values()) {
      if (session.saves[saveId]) {
        delete session.saves[saveId];
        const keys = await kvService.list(`adventure:save:${session.id}:${saveId}`);
        if (
          Array.isArray(keys) &&
          keys.length === 1 &&
          keys[0] === `adventure:save:${session.id}:${saveId}`
        ) {
          await kvService.delete(`adventure:save:${session.id}:${saveId}`);
        } else {
          try { await kvService.delete(`adventure:save:${session.id}:${saveId}`); } catch (e) { /* ignore */ }
        }
        await this._persistSession(session);
        return {
          success: true,
          data: {
            sessionId: session.id,
            userId: session.userId,
            summary: "Save deleted",
            adventureData: {
              type: "status_update",
              sessionId: session.id,
              userId: session.userId,
              message: "Save deleted",
            },
          },
        };
      }
    }
    // Scan KV
    const saveKeys = await kvService.list("adventure:save:");
    for (const key of saveKeys) {
      const snap = await kvService.get<AdventureSnapshot>(key);
      if (!snap || snap.id !== saveId) continue;
      const sessionId = key.split(":")[2];
      const sess = await kvService.get<AdventureSession>(kvKeySession(sessionId));
      await kvService.delete(key);
      if (sess) {
        delete (sess.saves || {})[saveId];
        const inMem = this.sessions.get(sessionId);
        if (inMem) {
          delete inMem.saves[saveId];
          await this._persistSession(inMem);
        } else {
          await this._persistSession(sess);
        }
        return {
          success: true,
          data: {
            sessionId,
            userId: sess.userId,
            summary: "Save deleted",
            adventureData: {
              type: "status_update",
              sessionId,
              userId: sess.userId,
              message: "Save deleted",
            },
          },
        };
      }
      return {
        success: true,
        data: {
          sessionId,
          userId: "unknown",
          summary: "Save deleted",
          adventureData: {
            type: "status_update",
            sessionId,
            userId: "unknown",
            message: "Save deleted",
          },
        },
      };
    }
    return { success: false, error: `Save ${saveId} not found` };
  }

  private async handleGetStatus(adventureId: string): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const scene = session.lastScene || this._getStoredScene(session, session.currentSceneId);

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Adventure status retrieved",
        scene: scene || undefined,
        adventureData: {
          type: "status_update",
          sessionId: session.id,
          userId: session.userId,
          scene: scene || undefined,
          message: "Adventure status",
          status: session.status,
          gameState: session.gameState,
          chronicle: session.chronicle,
          mode: session.experienceType,
          romanceState: session.romanceState,
        },
        gameState: session.gameState,
        chronicle: session.chronicle,
        romanceState: session.romanceState,
      },
    };
  }

  private async handleGenerateScene(params: GenerateSceneParams): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };

    const scene = await this._buildScene(session, {
      reason: params.sceneType === "battle" ? "action" : "choice",
      customContext: params.context,
    });

    session.currentSceneId = scene.id;
    session.history.push(scene.id);
    session.chronicle.push(createChronicleEntry("scene", scene.id, `Generated scene: ${scene.title}`));
    session.updatedAt = Date.now();
    session.lastScene = scene;
    await this._persistSession(session);

    const adventureData: AdventureData = {
      type: "adventure_scene",
      sessionId: session.id,
      userId: session.userId,
      scene,
      choices: scene.choices,
      gameState: session.gameState,
      chronicle: session.chronicle,
      mode: session.experienceType,
      romanceState: session.romanceState,
    };

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: `Generated ${params.sceneType || "story"} scene`,
        scene,
        adventureData,
        gameState: session.gameState,
        chronicle: session.chronicle,
        romanceState: session.romanceState,
        backgroundImage: scene.backgroundUrl
          ? { url: scene.backgroundUrl, prompt: scene.backgroundPrompt }
          : undefined,
      },
    };
  }

  private async handleEndAdventure(params: Record<string, unknown>): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(params.adventureId as string | undefined);
    if (!session) return { success: false, error: "Adventure session not found" };

    session.status = "completed";
    session.updatedAt = Date.now();

    const adventureData: AdventureData = {
      type: "adventure_end",
      sessionId: session.id,
      userId: session.userId,
      message: params.ending as string | undefined,
      status: "completed",
      chronicle: session.chronicle,
      gameState: session.gameState,
    };

    await this._persistSession(session);
    await kvService.delete(kvKeySessionByUser(session.userId));
    await kvService.delete(kvKeySession(session.id));
    dropSession(session.id, this.sessions, this.scenesBySession);
    this.sessionByUser.delete(session.userId);

    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Adventure ended",
        adventureData,
        gameState: session.gameState,
        chronicle: session.chronicle,
      },
    };
  }

  private async handlePauseAdventure(adventureId: string): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };
    session.status = "paused";
    session.updatedAt = Date.now();
    await this._persistSession(session);
    const adventureData: AdventureData = {
      type: "status_update",
      sessionId: session.id,
      userId: session.userId,
      message: "Adventure paused",
      status: "paused",
      gameState: session.gameState,
      chronicle: session.chronicle,
      mode: session.experienceType,
      romanceState: session.romanceState,
    };
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Adventure paused",
        adventureData,
        romanceState: session.romanceState,
      },
    };
  }

  private async handleResumeAdventure(adventureId: string): Promise<AdventureToolResult> {
    const session = await this._resolveOrLoadSession(adventureId);
    if (!session) return { success: false, error: "Adventure session not found" };
    session.status = "active";
    session.updatedAt = Date.now();
    const scene =
      session.lastScene || (await this._buildScene(session, { reason: "intro" }));
    session.lastScene = scene;
    await this._persistSession(session);
    const adventureData: AdventureData = {
      type: "adventure_scene",
      sessionId: session.id,
      userId: session.userId,
      scene,
      choices: scene.choices,
      gameState: session.gameState,
      chronicle: session.chronicle,
      status: "active",
      mode: session.experienceType,
      romanceState: session.romanceState,
    };
    return {
      success: true,
      data: {
        sessionId: session.id,
        userId: session.userId,
        summary: "Adventure resumed",
        scene,
        adventureData,
        romanceState: session.romanceState,
      },
    };
  }

  private async handleListSavedAdventures(
    explicitUserId?: string,
  ): Promise<AdventureToolResult> {
    const userId = this._resolveUserId(explicitUserId);
    if (!userId)
      return { success: false, error: "Unable to determine user for listing adventures" };

    const sessions: Array<
      Pick<AdventureSession, "id" | "title" | "status" | "createdAt" | "updatedAt" | "genre" | "theme">
    > = [] as any;
    const saves: Array<{ saveId: string; label: string; createdAt: number; sessionId: string }> = [];

    for (const s of this.sessions.values()) {
      if (s.userId !== userId) continue;
      sessions.push({
        id: s.id, title: s.title, status: s.status,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        genre: s.genre, theme: s.theme,
      });
      for (const snap of Object.values(s.saves)) {
        saves.push({ saveId: snap.id, label: snap.label, createdAt: snap.createdAt, sessionId: s.id });
      }
    }

    try {
      const keys = await kvService.list("adventure:session:");
      for (const key of keys) {
        const sess = await kvService.get<AdventureSession>(key);
        if (!sess || sess.userId !== userId) continue;
        if (!sessions.find((x) => x.id === sess.id)) {
          sessions.push({
            id: sess.id, title: sess.title, status: sess.status,
            createdAt: sess.createdAt, updatedAt: sess.updatedAt,
            genre: sess.genre, theme: sess.theme,
          });
        }
        for (const snap of Object.values(sess.saves || {})) {
          if (!saves.find((x) => x.saveId === snap.id)) {
            saves.push({ saveId: snap.id, label: snap.label, createdAt: snap.createdAt, sessionId: sess.id });
          }
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const saveKeys = await kvService.list("adventure:save:");
      for (const saveKey of saveKeys) {
        const parts = saveKey.split(":");
        if (parts.length < 4) continue;
        const sessionId = parts[2];
        const snap = await kvService.get<AdventureSnapshot>(saveKey);
        if (!snap) continue;
        const sess = await kvService.get<AdventureSession>(`adventure:session:${sessionId}`);
        if (!sess || sess.userId !== userId) continue;
        if (!sessions.find((x) => x.id === sess.id)) {
          sessions.push({
            id: sess.id, title: sess.title, status: sess.status,
            createdAt: sess.createdAt, updatedAt: sess.updatedAt,
            genre: sess.genre, theme: sess.theme,
          });
        }
        if (!saves.find((x) => x.saveId === snap.id)) {
          saves.push({ saveId: snap.id, label: snap.label, createdAt: snap.createdAt, sessionId });
        }
      }
    } catch (e) { /* ignore */ }

    const sessionSorter = (
      a: (typeof sessions)[number],
      b: (typeof sessions)[number],
    ) => {
      const aTime = a.updatedAt || a.createdAt || 0;
      const bTime = b.updatedAt || b.createdAt || 0;
      return bTime - aTime;
    };
    sessions.sort(sessionSorter);
    saves.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
      success: true,
      data: {
        sessionId: "list",
        userId,
        summary: "Saved adventures listed",
        adventureData: {
          type: "status_update",
          sessionId: "list",
          userId,
          message: "Saved adventures retrieved",
          chronicle: [],
          gameState: undefined,
        },
        sessions,
        saves,
      },
    };
  }
}

export default AdventurePlugin;
