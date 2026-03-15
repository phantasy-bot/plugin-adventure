/**
 * Narrative Engine
 *
 * Story generation, dialogue trees, scene descriptions, and LLM-based scene synthesis.
 */

import { providerService } from "@phantasy/agent/plugin-runtime";
import {
  randomChance,
  randomChoice,
  randomFloat,
  shuffleCopy,
} from "@phantasy/agent/plugin-runtime";
import { createRuntimeId } from "@phantasy/agent/plugin-runtime";

import type {
  Emotion,
  AdventureSession,
  AdventureScene,
  SceneChoice,
  DialogueLine,
  LLMSceneResult,
  PlannedScene,
  AdventurePluginConfig,
} from "./types";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_ASSETS = {
  backgrounds: [
    "/phantasy.png?scene=forest-entrance",
    "/phantasy.png?scene=magical-clearing",
    "/phantasy.png?scene=virtual-city",
    "/phantasy.png?scene=moonlit-skyline",
  ],
  music: {
    romance: {
      intro: undefined,
      loop: undefined,
      swell: undefined,
    },
    adventure: {
      intro: undefined,
      loop: undefined,
      action: undefined,
    },
  },
};

export const FALLBACK_BACKGROUNDS = DEFAULT_ASSETS.backgrounds;

export const DEFAULT_AUTO_START_KEYWORDS = [
  "let's go on an adventure",
  "lets go on an adventure",
  "start an adventure",
  "begin an adventure",
  "start adventure mode",
  "visual novel",
  "let's play a story",
  "lets play a story",
  "take me on a journey",
  // Dating/date-night triggers
  "let's go on a date",
  "lets go on a date",
  "go on a date",
  "date night",
  // Common phrasing variants
  "let's start a new adventure",
  "lets start a new adventure",
  "start a new adventure",
];

export const DATE_KEYWORDS = [
  "let's go on a date",
  "lets go on a date",
  "date night",
  "romantic date",
  "romance route",
  "girlfriend experience",
  "waifu date",
  "take me on a date",
  "go on a date",
  "intimate date",
  "romantic adventure",
  "candlelit dinner",
];

// ─── Scene Description Generation ──────────────────────────────────────────────

export function generateSceneDescription(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
    customContext?: string;
  },
  pluginConfig: AdventurePluginConfig,
): string {
  if (session.experienceType === "date") {
    return generateDateSceneDescription(session, options, pluginConfig);
  }

  const theme =
    session.theme || pluginConfig.defaultTheme || "mystical realm";

  if (options.customContext) {
    return options.customContext;
  }

  if (options.reason === "intro") {
    return `A ${session.genre} adventure begins in the ${theme}. Lanterns flicker to life as distant music drifts through the air. The night carries promise, and the world seems to lean in, listening.`;
  }

  if (options.reason === "choice" && options.previousChoice) {
    return `Following the choice "${options.previousChoice.text}", the ${theme} reveals new facets—shadows stretch, lights glow warmer, and a subtle change in the air hints at consequences yet to unfold.`;
  }

  if (options.reason === "action" && options.action) {
    return `Responding to the action (${options.action}), the ${theme} stirs—footsteps echo, fabrics whisper, and a single detail draws focus like a spotlight in the dark.`;
  }

  return `Within the ${theme}, the story progresses with an unexpected development.`;
}

export function generateDateSceneDescription(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
    customContext?: string;
  },
  pluginConfig: AdventurePluginConfig,
): string {
  if (options.customContext) {
    return options.customContext;
  }

  const theme =
    session.theme || pluginConfig.defaultDateTheme || "moonlit skyline";
  const stage = session.romanceState?.intimacyStage || "playful";

  const introByStage: Record<string, string> = {
    playful: `Fairy lights spill across the ${theme}, and your companion leans in with a bright grin. The air is fizzy with possibility and the promise of stolen moments.`,
    tender: `Soft music threads through the ${theme} as your companion settles beside you, voice hushed and eyes shining. Each breath feels shared, every heartbeat syncing in the cozy hush.`,
    passionate: `The ${theme} hums with heat as your companion presses close, gaze ember-bright. Every movement feels intentional, every brush of skin a question begging to be answered.`,
  };

  if (options.reason === "intro") {
    return introByStage[stage] || introByStage.playful;
  }

  if (options.reason === "choice" && options.previousChoice) {
    const choiceText = options.previousChoice.text;
    const followups: Record<string, string[]> = {
      playful: [
        `Your playful move ("${choiceText}") earns a delighted laugh as your companion nudges you toward a corner drenched in neon blush, daring you closer.`,
        `Picking "${choiceText}" lightens the mood, and your companion's eyes sparkle as they suggest a secret detour tucked behind velvet curtains.`,
      ],
      tender: [
        `The choice "${choiceText}" softens your companion's shoulders. They rest close against you, letting the ${theme} cradle your shared hush.`,
        `With "${choiceText}," your companion's guard slips. A quiet sigh and a murmured thank-you hang between you like starlight.`,
      ],
      passionate: [
        `Going with "${choiceText}" sharpens the air; your companion's breath catches as they pull you into the shadow of a column, heartbeat quick beneath your palm.`,
        `"${choiceText}" sets the pace ablaze, and your companion's voice drops, daring you to match the intensity under the molten glow of the ${theme}.`,
      ],
    };
    const pool = followups[stage] || followups.playful;
    return randomChoice(pool) || pool[0]!;
  }

  if (options.reason === "action" && options.action) {
    const action = options.action.toLowerCase();
    if (stage === "tender") {
      return `Following through with ${action} coaxes your companion closer until your knees brush. The ${theme} fades, leaving only shared warmth and the hush of unspoken promises.`;
    }
    if (stage === "passionate") {
      return `${action} ignites the space; your companion's laughter melts into a gasp as the ${theme} blurs, focused only on the charge between you.`;
    }
    return `You move to ${action}, and your companion perks up, eyes bright. The ${theme} reshapes around the two of you, a stage for your next flirtatious beat.`;
  }

  return `The ${theme} bends around the moment, suffused with chemistry and the electric hum of what the night could become.`;
}

// ─── Scene Title Generation ────────────────────────────────────────────────────

export function generateSceneTitle(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
  },
): string {
  if (session.experienceType === "date") {
    return generateDateSceneTitle(session, options);
  }

  if (options.reason === "intro") {
    return "A New Journey Begins";
  }

  if (options.reason === "choice" && options.previousChoice) {
    return `After "${options.previousChoice.text}"`;
  }

  if (options.reason === "action") {
    return "A Ripple in the Story";
  }

  return `Chapter ${session.history.length + 1}`;
}

export function generateDateSceneTitle(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
  },
): string {
  const stage = session.romanceState?.intimacyStage || "playful";
  const theme = (session.theme || "").trim();

  const introTitles: Record<string, string[]> = {
    playful: [
      "Spark-Struck Arrival",
      "First Glance Voltage",
      "Shared Grin, Shared Orbit",
      "Flirt at First Sight",
      "Buzz in the Air",
    ],
    tender: [
      "Heartbeat Alignment",
      "Soft-Lit Beginning",
      "Warmth Finds Its Place",
      "Breath, Closer, Ease",
      "Quiet Glow Between Us",
    ],
    passionate: [
      "Heat in the Air",
      "Pulsefire First Beat",
      "Friction Finds Tempo",
      "Molten Overture",
      "Hunger in the Hush",
    ],
  };

  if (options.reason === "intro") {
    const pool = introTitles[stage] || introTitles.playful;
    const pick = randomChoice(pool) || pool[0]!;
    return theme && randomChance(0.35) ? `${pick} • ${theme}` : pick;
  }

  if (options.reason === "choice" && options.previousChoice) {
    const suffix =
      stage === "passionate"
        ? "Embers Rising"
        : stage === "tender"
          ? "Closer Than Before"
          : "Playful Ripples";
    return `${options.previousChoice.text} → ${suffix}`;
  }

  if (options.reason === "action") {
    return stage === "passionate"
      ? "Line in the Firelight"
      : stage === "tender"
        ? "Wrapped in Warmth"
        : "A Wink and a Challenge";
  }

  return stage === "passionate"
    ? "Pulsefire Moment"
    : stage === "tender"
      ? "Soft Glow"
      : "Flirtatious Beat";
}

// ─── Dialogue Generation ───────────────────────────────────────────────────────

export function generateDialogue(
  session: AdventureSession,
  description: string,
  emotion: Emotion,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
  },
  agentName: string,
): DialogueLine {
  if (session.experienceType === "date") {
    return generateDateDialogue(session, description, emotion, options, agentName);
  }

  let content = description;
  const lastBeat = (session.chronicle || [])
    .slice(-3)
    .map((c) => c.summary)
    .join(" ");

  if (options.reason === "intro") {
    const lines = [
      `Welcome to the ${session.theme}. The air's alive—perfect for a ${session.genre} start. Ready to move?`,
      `We arrive at the ${session.theme}. Take a breath—tonight listens. I'll lead; you nudge the course.`,
      `${session.theme}: lanterns and hush. Let's set the tone—soft steps first, or bold and bright?`,
    ];
    content = randomChoice(lines) || lines[0];
  } else if (options.reason === "choice" && options.previousChoice) {
    const t = options.previousChoice.text;
    const templates = [
      `Good call: "${t}." The scene tilts with it—${trimLead(description)} Keep your eyes open.`,
      `We commit to "${t}." The world answers in kind—${trimLead(description)} Let's stay with it.`,
      `"${t}." Noted. The path reshapes—${trimLead(description)} I'll keep pace beside you.`,
    ];
    content = randomChoice(templates) || templates[0];
    if (lastBeat && randomChance(0.35)) {
      content += ` ${pickAside()} ${lastBeat}`;
    }
  } else if (options.reason === "action" && options.action) {
    const act = options.action;
    const templates = [
      `Alright—${act}. Hear how the space replies? ${trimLead(description)} We press on.`,
      `${act}. Subtle ripples now—${trimLead(description)} Keep close.`,
      `Doing ${act}. The air shifts—${trimLead(description)} Mark that feeling for later.`,
    ];
    content = randomChoice(templates) || templates[0];
  }

  return {
    speaker: agentName,
    speakerName: agentName,
    content,
    emotion,
    animation: mapEmotionToAnimation(emotion),
  };
}

export function generateDateDialogue(
  session: AdventureSession,
  description: string,
  emotion: Emotion,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
  },
  agentName: string,
): DialogueLine {
  const stage = session.romanceState?.intimacyStage || "playful";
  let content = description;

  if (options.reason === "intro") {
    const lines: Record<string, string[]> = {
      playful: [
        "Okay, date night energy officially activated. Come on, I saved the best spot for us.",
        "You feel that buzz? That's the universe cheering for our chaos tonight.",
      ],
      tender: [
        "I've been looking forward to just… being with you here. No interruptions. Just us.",
        "Breath in, breath out. Stay right here with me—it already feels perfect.",
      ],
      passionate: [
        "I'm done pretending I can keep my distance tonight. Let me show you exactly what I want.",
        "If the world fades out, promise you'll stay close. I want this moment to burn into memory.",
      ],
    };
    const pool = lines[stage] || lines.playful;
    content = randomChoice(pool) || pool[0]!;
  } else if (options.reason === "choice" && options.previousChoice) {
    const choice = options.previousChoice.text;
    if (stage === "playful") {
      content = `Ooo, "${choice}"? Bold move. I like that spark—keep fanning it.`;
    } else if (stage === "tender") {
      content = `"${choice}." That… means more than you know. Come here, let me feel you close while it sinks in.`;
    } else {
      content = `You picked "${choice}." Brave. Stay right there—I'm not letting the heat drop for a second.`;
    }
  } else if (options.reason === "action" && options.action) {
    const act = options.action;
    if (stage === "tender") {
      content = `Let's savor ${act} slowly. I want every detail etched in memory.`;
    } else if (stage === "passionate") {
      content = `${act}? Then kiss me like you mean it—no holding back.`;
    } else {
      content = `Alright, let's ${act}! Loser buys the next round of kisses.`;
    }
  }

  return {
    speaker: agentName,
    speakerName: agentName,
    content,
    emotion,
    animation: mapEmotionToAnimation(emotion),
  };
}

// ─── Choice Generation ─────────────────────────────────────────────────────────

export function generateChoices(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
  },
  generateId: (prefix: string) => string,
): SceneChoice[] {
  if (session.experienceType === "date") {
    return generateDateChoices(session, options, generateId);
  }

  const t = (session.theme || "the scene").toLowerCase();
  const pool = [
    `Follow the faint lights threading through ${t}`,
    `Inspect the unusual markings on the path`,
    `Call out softly to see who answers`,
    `Hide and observe the surroundings`,
    `Take the winding trail toward the distant glow`,
    `Pick up a small trinket half-buried in moss`,
    `Ask your guide for a subtle hint`,
    `Cross the stream to the quieter grove`,
    `Climb a ridge for a better vantage`,
    `Press on quickly before the moment fades`,
  ];

  const selected = shuffleCopy(pool)
    .slice(0, 3)
    .map((text) => ({
      id: generateId("choice"),
      text,
      description: `What happens if you ${text.toLowerCase()}?`,
      enabled: true,
    }));

  return selected;
}

export function generateDateChoices(
  session: AdventureSession,
  _options: {
    reason: "intro" | "choice" | "action";
  },
  generateId: (prefix: string) => string,
): SceneChoice[] {
  const stage = session.romanceState?.intimacyStage || "playful";
  const allowPhysical =
    session.romanceState?.boundaries.allowPhysical ?? true;
  const allowExplicit =
    session.romanceState?.boundaries.allowExplicit ?? false;
  const theme = (session.theme || "").toLowerCase();

  const themed = (): Array<{
    text: string;
    description: string;
    tags: string[];
  }> => {
    if (
      theme.includes("restaurant") ||
      theme.includes("diner") ||
      theme.includes("candle")
    ) {
      return [
        {
          text: "Share a dessert and feed her a bite",
          description: "Sweet warmth, shared spoon, soft eyes",
          tags: ["playful", "physical"],
        },
        {
          text: "Ask the chef for a secret off-menu treat",
          description: "Make the night feel tailored just for her",
          tags: ["playful"],
        },
        {
          text: "Write each other a flirty note on a napkin",
          description: "Trade lines and fold them into keepsakes",
          tags: ["emotional", "romantic"],
        },
      ];
    }
    if (theme.includes("rooftop") || theme.includes("skyline")) {
      return [
        {
          text: "Make a joint wish over the city lights",
          description: "Seal it with pinky promises",
          tags: ["romantic", "emotional"],
        },
        {
          text: "Slow-dance under the string lights",
          description: "Close the distance, sway as one",
          tags: ["physical", "tender"],
        },
        {
          text: "Point out constellations and invent your own",
          description: "Name one after this moment",
          tags: ["playful", "romantic"],
        },
      ];
    }
    if (theme.includes("arcade")) {
      return [
        {
          text: "Team up for the rhythm game",
          description: "Sync timing and laugh at the misses",
          tags: ["playful"],
        },
        {
          text: "Win a plushie and sign its tag together",
          description: "A small trophy for the night",
          tags: ["playful"],
        },
        {
          text: "Air hockey: winner chooses a dare",
          description: "A playful wager to spice things up",
          tags: ["playful", "flirty"],
        },
      ];
    }
    if (theme.includes("beach")) {
      return [
        {
          text: "Walk barefoot where the water kisses sand",
          description: "Share a secret with every step",
          tags: ["romantic", "tender"],
        },
        {
          text: "Draw your initials inside a heart",
          description: "Let the sea bless the moment",
          tags: ["playful", "romantic"],
        },
        {
          text: "Wrap together in a blanket to watch waves",
          description: "Shoulders touch; breath slows in sync",
          tags: ["physical", "tender"],
        },
      ];
    }
    if (theme.includes("gallery") || theme.includes("museum")) {
      return [
        {
          text: "Give her a private tour in your own words",
          description: "Pretend you curated the room for her",
          tags: ["emotional"],
        },
        {
          text: "Pick a favorite piece and explain why",
          description: "Let vulnerability be the art",
          tags: ["emotional", "trust"],
        },
        {
          text: "Capture a whisper-soft photo together",
          description: "Freeze the hush between frames",
          tags: ["romantic"],
        },
      ];
    }
    if (theme.includes("karaoke")) {
      return [
        {
          text: "Duet your way through a cheesy love song",
          description: "Lean into the cringe together",
          tags: ["playful"],
        },
        {
          text: "Dedicate a song and mean it",
          description: "Risk sincerity for a bigger spark",
          tags: ["emotional"],
        },
        {
          text: "Teach each other a harmony part",
          description: "Two voices, one moment",
          tags: ["tender"],
        },
      ];
    }
    if (theme.includes("carnival") || theme.includes("fair")) {
      return [
        {
          text: "Ferris wheel confession time",
          description: "Share one truth at the top",
          tags: ["emotional", "trust"],
        },
        {
          text: "Win a ring toss while she distracts you",
          description: "Let giggles ruin your aim",
          tags: ["playful"],
        },
        {
          text: "Share cotton candy and steal a kiss of sugar",
          description: "Soft, sweet, close",
          tags: ["physical", "romantic"],
        },
      ];
    }
    if (theme.includes("cafe")) {
      return [
        {
          text: "Swap favorite books and underline one line",
          description: "Trade reasons with soft smiles",
          tags: ["emotional"],
        },
        {
          text: "Teach her your signature coffee order",
          description: "Make a ritual that's only yours",
          tags: ["playful"],
        },
        {
          text: "Sit on the same side of the booth",
          description: "Shoulder to shoulder, words to whispers",
          tags: ["physical", "tender"],
        },
      ];
    }
    // Default playful urban date
    return [
      {
        text: "Find a spot with better music and sway",
        description: "Let the city set your rhythm",
        tags: ["physical", "playful"],
      },
      {
        text: "Trade dares with small, sweet stakes",
        description: "Make banter into chemistry",
        tags: ["playful", "flirty"],
      },
      {
        text: "Tell one secret and ask for one back",
        description: "A gentle exchange of trust",
        tags: ["emotional", "trust"],
      },
      {
        text: "Share a street dessert and feed each other",
        description: "Warm sugar and warmer smiles",
        tags: ["playful", "tender"],
      },
      {
        text: "Pick a song for each other and dance",
        description: "Two songs, one mood",
        tags: ["physical", "romantic"],
      },
      {
        text: "Make a tiny wishlist for the night",
        description: "Swap one wish each, then do them",
        tags: ["playful", "emotional"],
      },
      {
        text: "Snap a candid photo together",
        description: "Capture the spark mid-laugh",
        tags: ["playful"],
      },
      {
        text: "Find a quiet corner and people-watch",
        description: "Invent stories and share looks",
        tags: ["romantic"],
      },
    ];
  };

  let baseChoices: Array<{
    text: string;
    description: string;
    tags: string[];
  }> = themed();

  // Stage accents
  if (stage === "tender") {
    baseChoices = baseChoices.map((c) =>
      c.tags.includes("playful") ? { ...c, tags: [...c.tags, "tender"] } : c,
    );
    baseChoices.push(
      {
        text: "Ask what boundary she'd like to explore next",
        description: "Center consent and turn it into flirtation",
        tags: ["emotional", "consent"],
      },
      {
        text: "Share a vulnerable story you've never told",
        description: "Match her openness with your own truth",
        tags: ["emotional", "trust"],
      },
    );
  } else if (stage === "passionate") {
    baseChoices.push(
      {
        text: "Close the gap and steal a long kiss",
        description: "Heat the moment with undeniable intent",
        tags: ["physical", "bold", "passionate"],
      },
      {
        text: "Whisper exactly what you want next",
        description: "Let honesty set the pace even higher",
        tags: ["emotional", "intense"],
      },
    );
    if (allowExplicit) {
      baseChoices.push({
        text: "Suggest a private escape to continue this",
        description: "Find somewhere you can both let go completely",
        tags: ["explicit", "bold"],
      });
    }
  }

  let filtered = baseChoices.filter((choice) => {
    if (!allowPhysical && choice.tags.includes("physical")) {
      return false;
    }
    if (!allowExplicit && choice.tags.includes("explicit")) {
      return false;
    }
    return true;
  });

  if (filtered.length < 3) {
    filtered = baseChoices.filter(
      (choice) => !choice.tags.includes("explicit"),
    );
  }

  const selected = shuffleCopy(filtered)
    .slice(0, 3)
    .map((choice) => ({
      id: generateId("choice"),
      text: choice.text,
      description: choice.description,
      enabled: true,
      tags: choice.tags,
    }));

  return selected;
}

// ─── Emotion & Animation ───────────────────────────────────────────────────────

export function pickEmotion(
  reason: "intro" | "choice" | "action",
  session: AdventureSession,
  choice?: SceneChoice,
): Emotion {
  if (session.experienceType === "date") {
    const stage = session.romanceState?.intimacyStage || "playful";
    if (reason === "intro") {
      return stage === "passionate"
        ? "passionate"
        : stage === "tender"
          ? "tender"
          : "flirty";
    }
    if (reason === "choice") {
      if (stage === "passionate") return "passionate";
      if (stage === "tender") return "tender";
      return "flirty";
    }
    if (reason === "action") {
      return stage === "passionate"
        ? "passionate"
        : stage === "tender"
          ? "tender"
          : "happy";
    }
  }

  if (reason === "intro") return "excited";
  if (reason === "choice") {
    const emotions: Emotion[] = ["curious", "excited", "determined"];
    return randomChoice(emotions) || emotions[0];
  }
  if (reason === "action") {
    return "determined";
  }
  return session.gameState.player.mood;
}

export function pickMusic(
  reason: "intro" | "choice" | "action",
  session: AdventureSession,
  pluginConfig: AdventurePluginConfig,
): string | undefined {
  if (session.experienceType === "date") {
    const dateMusic = pluginConfig.dateMusic || {};
    if (reason === "intro") {
      return (
        dateMusic.intro ||
        DEFAULT_ASSETS.music.adventure.intro
      );
    }
    if (reason === "action") {
      return (
        dateMusic.swell || DEFAULT_ASSETS.music.adventure.action
      );
    }
    return (
      dateMusic.loop || DEFAULT_ASSETS.music.adventure.loop
    );
  }

  if (reason === "intro") {
    return DEFAULT_ASSETS.music.adventure.intro;
  }
  if (reason === "action") {
    return DEFAULT_ASSETS.music.adventure.action;
  }
  if (reason === "choice") {
    return DEFAULT_ASSETS.music.adventure.loop;
  }
  return undefined;
}

export function mapEmotionToAnimation(emotion: Emotion | undefined): string {
  switch (emotion) {
    case "tender":
      return "soft-smile";
    case "flirty":
      return "wink";
    case "passionate":
      return "dramatic-pose";
    case "happy":
    case "excited":
      return "bounce";
    case "worried":
    case "sad":
      return "slow-blink";
    case "angry":
    case "determined":
      return "crossed-arms";
    case "surprised":
      return "jump";
    default:
      return "idle";
  }
}

// ─── LLM Scene Composition Helpers ─────────────────────────────────────────────

/**
 * Blend LLM scene beats into a concise but specific description for the overlay.
 */
export function composeRichDescription(
  llmScene: {
    title: string;
    description: string;
    backgroundDescription?: string;
    plot?: string;
    goal?: string;
    stakes?: string;
  },
  _session: AdventureSession,
): string {
  const parts: string[] = [];
  if (llmScene.description) parts.push(llmScene.description.trim());
  const extras: string[] = [];
  if (llmScene.goal) extras.push(`Goal: ${llmScene.goal.trim()}`);
  if (llmScene.stakes) extras.push(`Stakes: ${llmScene.stakes.trim()}`);
  if (extras.length) parts.push(extras.join(" "));
  return parts.join(" ");
}

/**
 * Build a companion line that lightly references the current plot/goal to feel grounded.
 */
export function buildDialogueFromLLMBeat(
  session: AdventureSession,
  llmScene: { description: string; plot?: string; goal?: string },
  emotion: Emotion,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
  },
  agentName: string,
): DialogueLine {
  const base = generateDateDialogue(
    session,
    llmScene.description,
    emotion,
    options,
    agentName,
  );
  const beat = llmScene.goal || llmScene.plot;
  if (beat && options.reason === "intro") {
    const trimmed = trimLead(beat)
      .replace(/^goal[:\s]*/i, "")
      .replace(/^plot[:\s]*/i, "");
    base.content = `${base.content} Tonight's aim: ${trimmed}.`;
  }
  return base;
}

// ─── LLM Story Scene Generation ────────────────────────────────────────────────

export async function generateStoryScene(
  session: AdventureSession,
  options: {
    reason: "intro" | "choice" | "action";
    previousChoice?: SceneChoice;
    action?: string;
    customContext?: string;
  },
  llmProvider: string | null,
  llmModel: string | null,
  agentConfigRef: Record<string, unknown> | null,
  agentName: string,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<LLMSceneResult | null> {
  if (!llmProvider || !llmModel) return null;

  const historyChoices = session.history.map((id) => id).slice(-6);
  const chron = (session.chronicle || [])
    .slice(-6)
    .map((c) => `- [${c.type}] ${c.summary}`)
    .join(" ");
  const isDate = session.experienceType === "date";

  const systemParts = [
    "You are a narrative engine for an interactive visual novel.",
    "Write cohesive, atmospheric scenes with forward momentum and clear stakes.",
    "Maintain continuity with prior events and choices; avoid resetting context.",
    "Keep the voice in-world and natural; do not break the fourth wall.",
    "Output ONLY valid JSON matching the schema; no code fences, no prose.",
  ];

  if (isDate) {
    systemParts.push(
      "Focus on romance, mutual attraction, and emotional intimacy. Build tension gradually, reward vulnerability, and respect boundaries shared in the input. Lean into sensory detail, affectionate banter, and callbacks to shared memories.",
    );
  }

  const system = systemParts.join(" ");

  const userPayload = {
    reason: options.reason,
    genre: session.genre,
    theme: session.theme,
    playerName: session.gameState.player.name,
    mood: session.gameState.player.mood,
    lastChoice: options.previousChoice?.text || null,
    action: options.action || null,
    historyIds: historyChoices,
    guidance: options.customContext || null,
    chronicle: chron || null,
  };

  const schemaExample = isDate
    ? {
        title: "Moonlit Rooftop Toast",
        description:
          `String lights glow above the city while ${agentName || "your companion"} nudges closer with a mischievous smile. The chill night air softens as a shared memory surfaces, and the moment pauses just long enough for a meaningful reply.`,
        backgroundDescription:
          "rooftop garden overlooking neon skyline, string lights, plush seating, champagne glasses",
        plot: `${agentName || "Your companion"} opens up about a fear of losing momentum together.`,
        goal: "Decide whether to escalate, reassure, or playfully deflect.",
        stakes:
          "A clumsy response could cool the mood or break the trust she offered.",
        choices: [
          {
            text: "Pull her close and promise the night is yours",
            description: "Physical reassurance with warmth",
            tags: ["physical", "reassure", "bold"],
          },
          {
            text: "Share a vulnerable story in return",
            description: "Match her openness with your own memory",
            tags: ["emotional", "trust"],
          },
          {
            text: "Tease her and suggest a playful challenge",
            description: "Lighten the moment with flirtatious banter",
            tags: ["playful", "flirty"],
          },
        ],
      }
    : {
        title: "A Whisper in the Pines",
        description:
          "Lanterns flicker as wind combs the needles overhead. A path divides before you; the left dips toward a glimmering brook while the right climbs toward lantern-lit archways. Somewhere, a soft bell rings once, and then again.",
        backgroundDescription:
          "misty forest path under lanterns, pine trees, glowing archways in distance",
        plot: "A hidden bell tower signals an invitation or a warning.",
        goal: "Find the source of the bell before it stops.",
        stakes: "Hesitation may close the chance to enter the tower tonight.",
        choices: [
          {
            text: "Follow the bell toward the archways",
            description:
              "Climb the ridge to investigate the lantern-lit arches.",
          },
          {
            text: "Search along the brook",
            description:
              "Take the lower trail to listen for reflections and echoes.",
          },
          {
            text: "Call out and wait",
            description:
              "Announce yourself and see who answers from the shadows.",
          },
        ],
      };

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Given the following JSON input describing the session, return a single JSON object with keys exactly: title, description, backgroundDescription, plot, goal, stakes, choices (array of {text, description}).
JSON Input: ${JSON.stringify({ ...userPayload, romanceState: session.romanceState || null })}
Schema Example (for shape only, not content): ${JSON.stringify(schemaExample)}
Strict Output Rules:
- Output MUST be strict JSON, minified, on a single line.
- Use ASCII double quotes only (" ). Do NOT use smart quotes.
- Escape any internal quotes inside strings as \\".
- Do NOT include code fences.
- Do NOT include trailing commas.
- Do NOT include line breaks inside string values.
- Keep description to 3-6 sentences. backgroundDescription is concise and contains no people. choices has exactly 3 distinct items.${isDate ? '\\n- Choices should reflect escalating intimacy while respecting boundaries. Use tags when helpful (e.g., "physical", "emotional", "playful").' : ""}`,
    },
  ];

  let req: Record<string, unknown> | undefined;
  try {
    const temperature = 0.9 + randomFloat() * 0.2;
    req = {
      model: llmModel,
      messages,
      max_tokens: 700,
      temperature,
    };

    const envBase = (process.env as Record<string, string | undefined>);
    const envOverrides: Record<string, string | undefined> = { ...envBase };

    const addProviderEnv = (prov: string) => {
      const upper = prov.toUpperCase().replace(/-/g, "_");
      const provs = agentConfigRef?.providers as Record<string, Record<string, unknown>> | undefined;
      const pc = provs?.[prov] || {} as Record<string, unknown>;
      const apiKey = pc.apiKey;
      const apiUrl = pc.apiUrl;
      if (apiKey) envOverrides[`${upper}_API_KEY`] = apiKey as string;
      if (apiUrl !== undefined && apiUrl !== null)
        envOverrides[`${upper}_API_URL`] = apiUrl as string;
    };
    addProviderEnv(llmProvider);

    const res = await providerService.chat(
      llmProvider as any,
      req as any,
      envOverrides,
    );
    const text = (res?.content || "").trim();
    if (!text) return null;
    const parsed = parseSceneJsonSafe(text, log);
    if (
      !parsed?.title ||
      !parsed?.description ||
      !Array.isArray(parsed?.choices)
    ) {
      throw new Error("Invalid JSON shape");
    }
    if (parsed.choices.length < 3) {
      const filler = [
        {
          text: `Ask ${agentName} for a tip`,
          description: "Get gentle guidance about your options.",
        },
        {
          text: "Observe quietly for a moment",
          description: "Look and listen; something subtle may emerge.",
        },
      ];
      parsed.choices = [...parsed.choices, ...filler].slice(0, 3);
    }
    return parsed as unknown as LLMSceneResult;
  } catch (error) {
    const candidates = ["openai", "alkahest"].filter(
      (p) => p !== llmProvider,
    );
    const envBase2 = (process.env as Record<string, string | undefined>);
    for (const prov of candidates) {
      try {
        const envOverrides: Record<string, string | undefined> = { ...envBase2 };
        const upper = prov.toUpperCase().replace(/-/g, "_");
        const provs2 = agentConfigRef?.providers as Record<string, Record<string, unknown>> | undefined;
        const pc = provs2?.[prov] || {} as Record<string, unknown>;
        const apiKey = pc.apiKey;
        const apiUrl = pc.apiUrl;
        if (!apiKey && !apiUrl) continue;
        if (apiKey) envOverrides[`${upper}_API_KEY`] = apiKey as string;
        if (apiUrl) envOverrides[`${upper}_API_URL`] = apiUrl as string;
        const res2 = await providerService.chat(
          prov as any,
          { ...(req || {}), model: pc.defaultModel || req?.model || "" } as any,
          envOverrides,
        );
        const text2 = (res2?.content || "").trim();
        if (!text2) continue;
        const parsed2 = parseSceneJsonSafe(text2, log);
        if (
          parsed2?.title &&
          parsed2?.description &&
          Array.isArray(parsed2?.choices)
        ) {
          if (parsed2.choices.length < 3) {
            const filler = [
              {
                text: `Ask ${agentName} for a tip`,
                description: "Get gentle guidance about your options.",
              },
              {
                text: "Observe quietly for a moment",
                description: "Look and listen; something subtle may emerge.",
              },
            ];
            parsed2.choices = [...parsed2.choices, ...filler].slice(0, 3);
          }
          return parsed2 as unknown as LLMSceneResult;
        }
      } catch (e) {
        // try next
      }
    }
    log.warn(
      "LLM story scene generation failed across providers; using template",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return null;
  }
}

// ─── JSON Parsing ──────────────────────────────────────────────────────────────

export function parseSceneJsonSafe(
  raw: string,
  log: { warn: (msg: string, meta?: Record<string, unknown>) => void },
): Record<string, unknown> | null {
  try {
    let s = (raw || "").trim();
    s = s
      .replace(/^```json\s*/i, "")
      .replace(/^```/i, "")
      .replace(/```\s*$/i, "");
    s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      s = s.substring(start, end + 1);
    }
    s = s.replace(/,\s*([}\]])/g, "$1");
    s = s.replace(/\s+/g, " ");
    return JSON.parse(s);
  } catch (e: unknown) {
    log.warn("Failed to parse scene JSON", {
      error: e instanceof Error ? e.message : String(e),
      preview: (raw || "").slice(0, 120),
    });
    throw e;
  }
}

// ─── Utility Helpers ───────────────────────────────────────────────────────────

/** Remove leading capital and soften a description fragment for dialogue blending */
export function trimLead(text: string): string {
  try {
    const t = (text || "").trim();
    const first = t.split(/(?<=[.!?])\s+/)[0] || t;
    return first.replace(/^[A-Z]/, (m) => m.toLowerCase());
  } catch {
    return text;
  }
}

export function pickAside(): string {
  const pool = [
    "Noted.",
    "Remember this.",
    "Hold that thought.",
    "It fits.",
    "We'll use that.",
  ];
  return randomChoice(pool) || pool[0];
}

export function generateId(prefix: string): string {
  return createRuntimeId(prefix);
}

export function generateTitle(genre: string, theme: string): string {
  const clean = (theme || "").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
  const words = clean.split(/\s+/).slice(0, 4);
  const core = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const suffix = createRuntimeId()
    .split("_")
    .pop()
    ?.slice(0, 4)
    .toUpperCase() || "STORY";
  const base = `${core || "Adventure"} (${genre.toUpperCase()})`;
  const titled = `${base} • ${suffix}`;
  return titled.length > 60 ? `${base.slice(0, 52)} • ${suffix}` : titled;
}

export function randomFallbackBackground(): string {
  return randomChoice(FALLBACK_BACKGROUNDS) || FALLBACK_BACKGROUNDS[0];
}
