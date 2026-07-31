export type BorderEffect = "rainbow" | "snake" | "pulse" | "wave" | "ghost" | "solid" | "off";
export type ChangeAnimation = "count" | "spring" | "flip" | "burst" | "none";

export interface OverlayConfig {
  version: 1;
  identity: {
    mode: "auto" | "friendCode" | "manual"; friendCode: string; playerName: string; tag: string;
    licenseSlot: number; followOnlineLicense: boolean;
  };
  data: { groupsUrl: string; leaderboardUrl: string; pollSeconds: number; offlineAfterSeconds: number; demoMode: boolean };
  visibility: Record<"avatar" | "name" | "tag" | "vr" | "delta" | "rank" | "rankDelta" | "connection" | "room" | "track" | "sessionDelta" | "dailyDelta", boolean>;
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
  identitySteps?: string[];
  licenses?: { slot: number; name: string; friendCode: string; active: boolean }[];
}

export interface Snapshot {
  config: OverlayConfig;
  player: PlayerState;
  status: RuntimeStatus;
}
