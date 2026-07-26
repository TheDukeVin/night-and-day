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
  /**
   * Platformer levels: exact world position of the stand (`y` is the surface it
   * rests on — a platform top, a crate top, or the ground). Omit for classic
   * levels, which lay generators out automatically in a row per side.
   */
  at?: Vec3;
}

/** A world-space point. Used for hand-placed level geometry. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A stone platform: an axis-aligned block whose top face at `y` is standable.
 * It is solid all the way down to the terrain, so you cannot walk under one —
 * you go around it, or jump on top.
 */
export interface PlatformDef {
  id: string;
  x: number; // center
  z: number; // center
  w: number; // full size along x
  d: number; // full size along z
  y: number; // height of the top face
}

/**
 * A pushable stone crate. Cubes of `BOX_SIZE`, resting with their base at `y`.
 * Boxes NEVER rotate — walking into one slides it along a single world axis, so
 * their footprint stays axis-aligned and predictable for young players.
 */
export interface BoxDef {
  id: string;
  x: number; // center
  z: number; // center
  y: number; // base (bottom face) height
}

/** Hand-authored geometry for a platformer level. */
export interface LevelTerrain {
  platforms: PlatformDef[];
  boxes: BoxDef[];
  /** Where the players start; defaults to the classic spawn when omitted. */
  spawn?: { x: number; z: number };
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
  /**
   * Cycle levels: the ordered list of active sides. Presence marks the level as
   * a "Cycle" puzzle — only the active side may press, and the active player
   * passes to advance. The LAST entry is the phase where Balance appears; earlier
   * entries show "Pass to <next>". Absence = a "Sunset" level (both sides free).
   * e.g. Cycle Night = ['night','day'], Cycle Day = ['day','night'].
   */
  cycle?: Side[];
  /** Run the scripted, replaying solution walkthrough (Tutorial levels). */
  tutorial?: boolean;
  /**
   * Platformer levels: stone platforms and pushable crates to climb. Purely
   * spatial — it changes how you *reach* a generator, never what pressing one
   * does, so the balance math stays identical to a classic level.
   */
  terrain?: LevelTerrain;
}

export interface GameState {
  packId: string; // which pack `levelIndex` indexes into
  levelIndex: number; // 1-based index into the pack
  presses: Record<string, number>; // generator id -> press count
  history: string[]; // generator ids in press order, so the last press can be undone
  phase: number; // cycle levels: index into level.cycle (which side is active); 0 otherwise
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
  jump: number; // height above ground (jump arc), 0 when grounded
  /**
   * Absolute world height. On platformer levels the peer may be standing on a
   * platform or crate, which `jump` alone cannot express (it is measured from
   * the terrain). Present since the platformer pack; older senders omit it.
   */
  y?: number;
}

/** Client -> server */
export type ClientMsg =
  | { t: 'create'; room: string }
  | { t: 'join'; room: string }
  // Host starts the game (at the level they chose) once both players present.
  // `intro` asks both clients to play the pack cutscene — the host sets it when
  // either player is new to the pack.
  | { t: 'begin'; pack: string; level: number; intro?: boolean }
  | { t: 'press'; gen: string }
  | { t: 'pass' } // cycle levels: active side hands off to the next side
  | { t: 'balance' }
  | { t: 'undo' }
  | { t: 'reset' }
  | { t: 'hint' }
  | { t: 'answer' }
  | { t: 'next' } // advance after a win
  | { t: 'pose'; pose: PlayerPose }
  // Crate positions, relayed to the peer like `pose`. Crates are traversal-only
  // scenery — they never affect the balance math — so they are not part of the
  // authoritative GameState; the client doing the pushing owns them.
  | { t: 'boxes'; boxes: BoxDef[] }
  | { t: 'unlocked'; levels: number[] }; // share this client's unlocked levels with the peer

/** Server -> client */
export type ServerMsg =
  | { t: 'created'; room: string; role: PlayerRole }
  | { t: 'joined'; room: string; role: PlayerRole }
  | { t: 'peer-joined' }
  | { t: 'peer-left' }
  | { t: 'begin'; pack: string; level: number; intro?: boolean }
  | { t: 'state'; state: GameState }
  | { t: 'balance-result'; win: boolean; state: GameState }
  | { t: 'hint'; gen: string; presses: number }
  | { t: 'answer'; solution: Record<string, number> }
  | { t: 'offer-answer' }
  | { t: 'pose'; pose: PlayerPose }
  | { t: 'boxes'; boxes: BoxDef[] }
  | { t: 'unlocked'; levels: number[] }
  | { t: 'error'; message: string };
