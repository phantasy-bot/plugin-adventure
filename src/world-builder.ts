/**
 * World Builder
 *
 * World generation, scene building, background image generation,
 * and pre-planned scene flow management.
 */

import {
  kvService,
  providerService,
  type MediaStorageService,
  type ProviderImageGenerationService,
} from "@phantasy/agent/plugin-runtime";

import type {
  Emotion,
  AdventureSession,
  AdventureScene,
  AdventurePluginConfig,
  SceneChoice,
  PlannedScene,
  LLMSceneResult,
} from "./types";

import {
  pickEmotion,
  pickMusic,
  generateSceneDescription,
  generateSceneTitle,
  generateDialogue,
  generateDateDialogue,
  generateChoices,
  generateStoryScene,
  composeRichDescription,
  buildDialogueFromLLMBeat,
  mapEmotionToAnimation,
  parseSceneJsonSafe,
  generateId,
} from "./narrative-engine";

// ─── KV Key Helpers ────────────────────────────────────────────────────────────

export function kvKeyPlan(sessionId: string): string {
  return `adventure:plan:${sessionId}`;
}

// ─── Pre-plan Adventure ────────────────────────────────────────────────────────

export async function preplanAdventure(
  session: AdventureSession,
  llmProvider: string | null,
  llmModel: string | null,
  agentConfigRef: Record<string, unknown> | null,
  imageService: ProviderImageGenerationService | null,
  pluginConfig: AdventurePluginConfig,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void },
  persistSession: (session: AdventureSession) => Promise<void>,
  generateBackgroundImageFn: (
    description: string,
    session: AdventureSession,
    forceSave?: boolean,
  ) => Promise<{ url?: string; prompt?: string } | null>,
): Promise<void> {
  try {
    const provider = llmProvider || "venice";
    const userPayload = {
      title: session.title,
      genre: session.genre,
      theme: session.theme,
      player: session.gameState.player.name,
    };
    const romanceState = session.romanceState;
    const isDate = session.experienceType === "date";
    const prompt = isDate
      ? `Plan an 8-scene romantic date visual novel experience. Return strict minified JSON with keys: scenes (array of 8 with: id (string like 'scene-1'), title, description (3-5 sentences focusing on emotion and sensory cues), backgroundPrompt (concise, background only, no people), dialogue (array of 2-3 opening lines capturing the companion's tone), musicCue (one of: lo-fi, romantic, playful, intimate), sprites (array of 0-2 items { character: 'Companion', pose: string, emotion: string, layer: 'front'|'mid'|'back', visible: boolean }), choices (array of 3 { text, description, tags (array of 1-3 mood tags), nextId (one of the scene ids or 'end') })). Ensure the story arcs from playful warm-up to a heartfelt moment then a cozy wrap-up. Respect boundaries: physical affection ${
          romanceState?.boundaries.allowPhysical
            ? "allowed"
            : "limited to hand-holding"
        }, explicit content ${
          romanceState?.boundaries.allowExplicit
            ? "allowed if consensual"
            : "not allowed"
        }. Emphasize personal connection, callbacks to shared memories, and opportunities to award affection.`
      : `Plan a 10-scene interactive visual novel adventure. Return strict minified JSON with keys: scenes (array of 10 with: id (string like 'scene-1'), title, description (3-6 sentences), backgroundPrompt (concise, background only, no people, no humans), dialogue (array of 1-3 strings for opening lines), musicCue (one of: ambient, tense, romantic, mysterious, action), sprites (array of 0-2 items { character: 'Companion', pose: string, emotion: string, layer: 'front'|'mid'|'back', visible: boolean }), choices (array of 3 { text, description, nextId (one of the scene ids or 'end') })). Ensure ids are unique and nextId forms a coherent branching path. Genre: ${session.genre}. Theme: ${session.theme}.`;
    const messages = [
      {
        role: "system",
        content: "You are a narrative planner. Produce strict JSON only.",
      },
      {
        role: "user",
        content: `${prompt} Input: ${JSON.stringify(userPayload)}`,
      },
    ];
    const req: any = {
      model: llmModel || "",
      messages,
      max_tokens: 800,
      temperature: 0.9,
    };
    const envBase = (process.env as Record<string, string | undefined>);
    const envOverrides: Record<string, string | undefined> = { ...envBase };
    const upper = provider.toUpperCase().replace(/-/g, "_");
    const providers = agentConfigRef?.providers as Record<string, Record<string, unknown>> | undefined;
    const pc = providers?.[provider] || {} as Record<string, unknown>;
    if (pc.apiKey) envOverrides[`${upper}_API_KEY`] = pc.apiKey as string;
    if (pc.apiUrl) envOverrides[`${upper}_API_URL`] = pc.apiUrl as string;

    let plan: Record<string, unknown> | null = null;
    try {
      const res = await providerService.chat(
        provider as any,
        req,
        envOverrides,
      );
      const raw = (res?.content || "").trim();
      plan = parseSceneJsonSafe(raw, log);
    } catch (e) {
      const candidates = ["openai", "alkahest"].filter(
        (p) => p !== provider,
      );
      const envBase2 = (process.env as Record<string, string | undefined>);
      for (const prov of candidates) {
        try {
          const env2: Record<string, string | undefined> = { ...envBase2 };
          const providers2 = agentConfigRef?.providers as Record<string, Record<string, unknown>> | undefined;
          const pc2 = providers2?.[prov] || {} as Record<string, unknown>;
          const upper2 = prov.toUpperCase().replace(/-/g, "_");
          if (pc2.apiKey) env2[`${upper2}_API_KEY`] = pc2.apiKey as string;
          if (pc2.apiUrl) env2[`${upper2}_API_URL`] = pc2.apiUrl as string;
          const res2 = await providerService.chat(
            prov as any,
            { ...req, model: pc2.defaultModel || req.model },
            env2,
          );
          const raw2 = (res2?.content || "").trim();
          plan = parseSceneJsonSafe(raw2, log);
          if (plan?.scenes) break;
        } catch (e) {
          /* ignore */
        }
      }
    }

    if (
      !plan?.scenes ||
      !Array.isArray(plan.scenes) ||
      plan.scenes.length === 0
    )
      return;

    // Pre-generate backgrounds for planned scenes
    for (const sc of plan.scenes) {
      try {
        const bg = await generateBackgroundImageFn(
          sc.backgroundPrompt || sc.description || session.theme,
          session,
          true,
        );
        if (bg?.url) sc.backgroundUrl = bg.url;
        if (bg?.prompt) sc.backgroundPrompt = bg.prompt;
      } catch (e) {
        /* ignore */
      }
    }

    await kvService.set(kvKeyPlan(session.id), plan);
    const firstId = plan.scenes?.[0]?.id || "scene-1";
    session.metadata = {
      ...(session.metadata || {}),
      plannedFlow: true,
      planIndex: 0,
      planCurrentId: firstId,
    };
    await persistSession(session);
  } catch (e) {
    log.warn("Preplanning adventure failed; continuing without plan", {
      error: (e instanceof Error ? e.message : String(e)),
    });
  }
}

// ─── Get Planned Scene ─────────────────────────────────────────────────────────

export async function getPlannedScene(
  session: AdventureSession,
  persistSession: (session: AdventureSession) => Promise<void>,
): Promise<PlannedScene | null> {
  try {
    const plan = await kvService.get<{ scenes: Array<Record<string, unknown>> }>(kvKeyPlan(session.id));
    let sc: Record<string, unknown> | null = null;
    const curId = (session.metadata as Record<string, unknown>)?.planCurrentId;
    if (curId && plan?.scenes) {
      sc = plan.scenes.find((x) => x.id === curId) || null;
    }
    if (!sc && plan?.scenes?.length) {
      sc = plan.scenes[0];
      (session.metadata as Record<string, unknown>).planCurrentId = sc.id as string;
      await persistSession(session);
    }
    if (!sc) return null;
    return {
      title: sc.title as string,
      description: sc.description as string,
      backgroundUrl: sc.backgroundUrl as string | undefined,
      backgroundPrompt: sc.backgroundPrompt as string | undefined,
      dialogue: Array.isArray(sc.dialogue) ? sc.dialogue : undefined,
      musicCue: sc.musicCue as string | undefined,
      sprites: Array.isArray(sc.sprites) ? sc.sprites : undefined,
      id: sc.id as string,
      choices: Array.isArray(sc.choices) ? sc.choices : [],
    };
  } catch {
    return null;
  }
}

// ─── Build Scene ───────────────────────────────────────────────────────────────

export async function buildScene(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
    customContext?: string;
  },
  deps: {
    pluginConfig: AdventurePluginConfig;
    agentName: string;
    llmProvider: string | null;
    llmModel: string | null;
    agentConfigRef: Record<string, unknown> | null;
    imageService: ProviderImageGenerationService | null;
    mediaStorageService: MediaStorageService | null;
    log: { warn: (msg: string, meta?: Record<string, unknown>) => void };
    persistSession: (session: AdventureSession) => Promise<void>;
    saveScene: (sessionId: string, scene: AdventureScene) => void;
    generateBackgroundImage: (
      description: string,
      session: AdventureSession,
      forceSave?: boolean,
    ) => Promise<{ url?: string; data?: string; mimeType?: string; prompt: string; savedUrl?: string } | null>;
  },
): Promise<AdventureScene> {
  const plannedFlow = !!(session.metadata as Record<string, unknown>)?.plannedFlow;
  const emotion = pickEmotion(
    options.reason,
    session,
    options.previousChoice,
  );

  let scene: AdventureScene | null = null;
  if (plannedFlow) {
    const p = await getPlannedScene(session, deps.persistSession);
    if (p) {
      const lineText =
        p.dialogue && p.dialogue.length
          ? p.dialogue.slice(0, 2).join(" ")
          : undefined;
      const dialogLine = lineText
        ? {
            speaker: deps.agentName,
            speakerName: deps.agentName,
            content: lineText,
            emotion,
          }
        : generateDialogue(session, p.description, emotion, options, deps.agentName);
      const choices: SceneChoice[] = (p.choices || []).map((c: any) => ({
        id: generateId("choice"),
        text: c.text,
        description: c.description || undefined,
        enabled: true,
        nextSceneId: undefined,
      }));
      scene = {
        id: generateId("scene"),
        title: p.title || generateSceneTitle(session, options),
        description: p.description,
        backgroundUrl: p.backgroundUrl,
        backgroundPrompt: p.backgroundPrompt,
        musicUrl: p.musicCue || pickMusic(options.reason, session, deps.pluginConfig),
        characterEmotion: emotion,
        characterAnimation: mapEmotionToAnimation(emotion),
        dialogue: dialogLine,
        choices: choices.length
          ? choices
          : generateChoices(session, options, generateId).map((c: any) => ({
              id: generateId("choice"),
              text: c.text,
              description: c.description,
              enabled: true,
            })),
      };
      // Persist sprite metadata for downstream renderers.
      try {
        (session.metadata as Record<string, unknown>) = {
          ...(session.metadata || {}),
          lastSprites: p.sprites,
        };
        await deps.persistSession(session);
      } catch (e) {
        /* ignore */
      }
      // Map generated choice ids to planned nextIds for branching
      try {
        const choiceMap: Record<string, string> = {};
        for (let i = 0; i < scene.choices.length; i++) {
          const planned = (p.choices || [])[i];
          if (planned?.nextId)
            choiceMap[scene.choices[i].id] = planned.nextId;
        }
        (session.metadata as Record<string, unknown>) = {
          ...(session.metadata || {}),
          lastChoiceMap: choiceMap,
        };
        await deps.persistSession(session);
      } catch (e) {
        /* ignore */
      }
    }
  }

  if (!scene) {
    // Fallback to dynamic generation when no plan
    const llmScene = await generateStoryScene(
      session,
      options,
      deps.llmProvider,
      deps.llmModel,
      deps.agentConfigRef,
      deps.agentName,
      deps.log,
    ).catch(() => null);
    const description = llmScene
      ? composeRichDescription(llmScene, session)
      : generateSceneDescription(session, options, deps.pluginConfig);
    const title =
      llmScene?.title || generateSceneTitle(session, options);
    const dialogue = llmScene
      ? buildDialogueFromLLMBeat(session, llmScene, emotion, options, deps.agentName)
      : generateDialogue(session, description, emotion, options, deps.agentName);
    const choices: SceneChoice[] = (
      llmScene?.choices || generateChoices(session, options, generateId)
    ).map((c: any) => ({
      id: generateId("choice"),
      text: c.text,
      description: c.description || undefined,
      enabled: true,
      nextSceneId: undefined,
    }));
    const bgPrompt = llmScene?.backgroundDescription || description;
    const backgroundImage = await deps.generateBackgroundImage(
      bgPrompt,
      session,
      true,
    );
    scene = {
      id: generateId("scene"),
      title,
      description,
      backgroundUrl: backgroundImage?.url,
      backgroundPrompt: backgroundImage?.prompt,
      musicUrl: pickMusic(options.reason, session, deps.pluginConfig),
      characterEmotion: emotion,
      characterAnimation: mapEmotionToAnimation(emotion),
      dialogue,
      choices,
    };
  }

  deps.saveScene(session.id, scene);

  return scene;
}

// ─── Background Image Generation ───────────────────────────────────────────────

export async function generateBackgroundImage(
  description: string,
  session: AdventureSession,
  forceSave: boolean = false,
  imageService: ProviderImageGenerationService | null,
  mediaStorageService: MediaStorageService | null,
  pluginConfig: AdventurePluginConfig,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<{
  url?: string;
  data?: string;
  mimeType?: string;
  prompt: string;
  savedUrl?: string;
} | null> {
  if (!imageService) return null;

  const prompt = `${description}. ${session.theme}. cinematic, anime style, detailed lighting, immersive atmosphere`;

  try {
    const image = await imageService.generateSceneBackground(prompt, {
      provider: pluginConfig.imageProvider,
    });

    if (!image) {
      return null;
    }

    let savedUrl: string | undefined;
    if (
      mediaStorageService &&
      (forceSave || mediaStorageService.isAutoSaveEnabled?.())
    ) {
      try {
        let blob: Blob | null = null;
        if (image.data) {
          blob = imageDataToBlob(image, log);
        } else if (image.url) {
          try {
            const r = await fetch(image.url);
            const ab = await r.arrayBuffer();
            blob = new Blob([ab], { type: image.mimeType || "image/png" });
          } catch (e) {
            log.warn("Adventure bg fetch failed for saving", {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (blob) {
          const ts = Date.now();
          const folder = `gen-adventures/gen-backgrounds/${session.id}/generated-${ts}`;
          const file = new File([blob], "background.png", {
            type: "image/png",
          });
          const uploaded = await mediaStorageService.uploadFile(
            file,
            `${folder}/background.png`,
            {
              providerId: "local",
              metadata: {
                prompt,
                provider: pluginConfig.imageProvider,
                model: undefined,
                sessionId: session.id,
                adventureTitle: session.title,
                generatedAt: new Date().toISOString(),
                kind: "generated-background",
              },
            },
          );
          savedUrl = uploaded?.url;
        }
      } catch (e) {
        log.warn("Adventure background auto-save failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (image.url) {
      return { url: image.url, prompt, savedUrl };
    }

    if (image.data) {
      const mime = image.mimeType || "image/png";
      return {
        url: `data:${mime};base64,${image.data}`,
        data: image.data,
        mimeType: mime,
        prompt,
        savedUrl,
      };
    }

    return { prompt };
  } catch (error) {
    log.warn("Background generation failed, using fallback", { error: error as Record<string, unknown> });
    return null;
  }
}

// ─── Image Helpers ─────────────────────────────────────────────────────────────

export function imageDataToBlob(
  imageData: { data?: string; mimeType?: string } | string | null,
  log: { error: (msg: string, meta?: Record<string, unknown>) => void },
): Blob | null {
  try {
    if (!imageData || typeof imageData === "string") return null;
    if (imageData.data) {
      const base64 = imageData.data.replace(/^data:image\/\w+;base64,/, "");
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      return new Blob([byteArray], {
        type: imageData.mimeType || "image/png",
      });
    }
    return null;
  } catch (error) {
    log.error("Failed to convert image to blob:", { error: error as Record<string, unknown> });
    return null;
  }
}
