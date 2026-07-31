export type BorderEffect = "rainbow" | "snake" | "pulse" | "wave" | "ghost" | "solid" | "off";
export type ChangeAnimation = "count" | "spring" | "flip" | "burst" | "none";

export interface OverlayConfig {
  version: 1;
  identity: {
    mode: "auto" | "friendCode" | "manual";
    friendCode: string;
    playerName: string;
    tag: string;
    /** Pin a specific save slot (0-3); -1 follows WheelWizard's selected license. */
    licenseSlot: number;
    /** Auto-switch to whichever of the save's licenses is currently online. */
    followOnlineLicense: boolean;
  };
  data: { groupsUrl: string; leaderboardUrl: string; pollSeconds: number; offlineAfterSeconds: number; demoMode: boolean };
  visibility: {
    avatar: boolean; name: boolean; tag: boolean; vr: boolean; delta: boolean;
    rank: boolean; rankDelta: boolean; connection: boolean; room: boolean; track: boolean;
    sessionDelta: boolean; dailyDelta: boolean;
  };
  avatar: {
    background: "gradient" | "solid" | "transparent";
    color1: string;
    color2: string;
  };
  layout: { scale: number; width: number; compact: boolean; align: "horizontal" | "stacked" };
  typography: { family: string; numberFamily: string; weight: number; textColor: string; mutedColor: string };
  background: {
    imageUrl: string; fit: "cover" | "contain" | "stretch"; x: number; y: number; zoom: number;
    blur: number; brightness: number; saturation: number; contrast: number;
    overlayColor: string; overlayOpacity: number; glass: number;
  };
  border: {
    effect: BorderEffect; width: number; radius: number; speed: number; glow: boolean;
    glowStrength: number; color1: string; color2: string; color3: string;
  };
  animations: {
    vr: ChangeAnimation; rank: ChangeAnimation; durationMs: number;
    celebrateThreshold: number; reducedMotion: boolean;
  };
  desktop: { alwaysOnTop: boolean; clickThrough: boolean; showInTaskbar: boolean; opacity: number };
}

export interface PlayerState {
  name: string; tag: string; friendCode: string; vr: number; previousVr: number | null;
  vrDelta: number | null; rank: number | null; previousRank: number | null; rankDelta: number | null;
  avatarUrl: string; room: string; race: number | null; online: boolean; updatedAt: string;
  source: "demo" | "rwfc" | "manual" | "waiting";
  extras?: {
    trackName: string; roomKind: string; roomId: string; cc: string;
    averageVr: number | null; roomPlayerCount: number | null;
    vrStats: { last24Hours: number; lastWeek: number; lastMonth: number } | null;
    sessionDelta: number | null;
    recentChanges: { date: string; vrChange: number; totalVr: number }[];
    lastSeen: string | null;
  };
}

export interface RuntimeStatus {
  phase: "starting" | "connected" | "waiting" | "offline" | "error";
  message: string; lastSuccessAt: string | null; lastPollAt: string | null;
  consecutiveErrors: number; detectedFriendCode: string;
}

export const defaultConfig: OverlayConfig = {
  version: 1,
  identity: { mode: "auto", friendCode: "", playerName: "ZPL", tag: "", licenseSlot: -1, followOnlineLicense: true },
  data: {
    groupsUrl: "https://rwfc.net/api/roomstatus",
    leaderboardUrl: "https://rwfc.net/api/leaderboard/player/{friendCode}",
    pollSeconds: 5,
    offlineAfterSeconds: 45,
    demoMode: true
  },
  visibility: {
    avatar: true, name: true, tag: true, vr: true, delta: true,
    rank: true, rankDelta: true, connection: false, room: false, track: false,
    sessionDelta: false, dailyDelta: false
  },
  avatar: { background: "gradient", color1: "#31d4ff", color2: "#3556ae" },
  layout: { scale: 1, width: 560, compact: false, align: "horizontal" },
  typography: {
    family: "Inter, ui-sans-serif, system-ui, sans-serif",
    numberFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    weight: 800,
    textColor: "#ffffff",
    mutedColor: "#c9d1e7"
  },
  background: {
    imageUrl: "", fit: "cover", x: 50, y: 50, zoom: 1,
    blur: 0, brightness: 0.58, saturation: 1.15, contrast: 1.08,
    overlayColor: "#07111f", overlayOpacity: 0.38, glass: 0.26
  },
  border: {
    effect: "rainbow", width: 4, radius: 38, speed: 5.5,
    glow: true, glowStrength: 0.65,
    color1: "#22d3ee", color2: "#8b5cf6", color3: "#f97316"
  },
  animations: {
    vr: "count", rank: "flip", durationMs: 1100,
    celebrateThreshold: 250, reducedMotion: false
  },
  desktop: { alwaysOnTop: true, clickThrough: false, showInTaskbar: true, opacity: 1 }
};

export const defaultPlayer: PlayerState = {
  name: "ZPL", tag: "", friendCode: "", vr: 87747, previousVr: 87706, vrDelta: 41,
  rank: 279, previousRank: 281, rankDelta: 2, avatarUrl: "", room: "Retro Tracks",
  race: null, online: true, updatedAt: new Date().toISOString(), source: "demo",
  extras: {
    trackName: "GBA Rainbow Road", roomKind: "Retro Tracks", roomId: "PREVIEW", cc: "150cc",
    averageVr: 72540, roomPlayerCount: 12,
    vrStats: { last24Hours: 1240, lastWeek: 4893, lastMonth: 12470 },
    sessionDelta: 528, recentChanges: [], lastSeen: null
  }
};
