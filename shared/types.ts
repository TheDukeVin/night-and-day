// Shared types between client and server.

export type CrystalColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple';
export type Side = 'day' | 'night';

/** How many crystals of each color a generator emits per press. */
export interface GeneratorOutput {
  color: CrystalColor;
  count: number;
}

export interface GeneratorDef {
  id: string;
  side: Side;
  outputs: GeneratorOutput[];
}

export interface LevelDef {
  index: number; // 1-based
  name: string;
  concept: string; // short hint at the math concept, shown on the level intro
  /** Initial crystal counts, e.g. { red: { day: 3, night: 5 } } */
  initial: Partial<Record<CrystalColor, { day: number; night: number }>>;
  generators: GeneratorDef[];
  /** Intended solution: presses per generator id. Verified by shared/verify.ts. */
  solution: Record<string, number>;
  intro?: string; // tutorial / flavor text shown when the level starts
}

export interface GameState {
  levelIndex: number; // 1-based index into the pack
  presses: Record<string, number>; // generator id -> press count
  resets: number; // resets since last hint was taken (drives answer offer)
  hintTaken: boolean;
  solved: boolean;
}

export interface CrystalCounts {
  [color: string]: { day: number; night: number };
}

// ---------- Networking messages ----------

export type PlayerRole = 'day' | 'night' | 'dusk';

export interface PlayerPose {
  x: number;
  z: number;
  ry: number; // yaw
  moving: boolean;
}

/** Client -> server */
export type ClientMsg =
  | { t: 'create'; room: string }
  | { t: 'join'; room: string }
  // Host starts the game (at the level they chose) once both players present.
  // `intro` asks both clients to play the pack cutscene — the host sets it when
  // either player is new to the pack.
  | { t: 'begin'; level: number; intro?: boolean }
  | { t: 'press'; gen: string }
  | { t: 'balance' }
  | { t: 'reset' }
  | { t: 'hint' }
  | { t: 'answer' }
  | { t: 'next' } // advance after a win
  | { t: 'pose'; pose: PlayerPose }
  | { t: 'unlocked'; levels: number[] }; // share this client's unlocked levels with the peer

/** Server -> client */
export type ServerMsg =
  | { t: 'created'; room: string; role: PlayerRole }
  | { t: 'joined'; room: string; role: PlayerRole }
  | { t: 'peer-joined' }
  | { t: 'peer-left' }
  | { t: 'begin'; level: number; intro?: boolean }
  | { t: 'state'; state: GameState }
  | { t: 'balance-result'; win: boolean; state: GameState }
  | { t: 'hint'; gen: string; presses: number }
  | { t: 'answer'; solution: Record<string, number> }
  | { t: 'offer-answer' }
  | { t: 'pose'; pose: PlayerPose }
  | { t: 'unlocked'; levels: number[] }
  | { t: 'error'; message: string };
