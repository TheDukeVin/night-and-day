// Visual first-time guides: one animated coach mark at a time, each waiting for
// the player to actually perform the action before the next one appears. Nearly
// wordless — keycaps, a mouse glyph, a pointing hand — so young players can read
// them at a glance. Each cue shows only on a player's FIRST encounter with that
// mechanic: the seen-set is tied to the account (server-backed via mechanics.ts)
// for signed-in players and kept in memory per session for guests. Ids are
// namespaced `guide-*` so they never collide with the text tips.

import { el } from '../screens/ui.ts';
import { getSettings } from '../settings.ts';
import { hasSeenMechanic, markMechanicSeen } from '../mechanics.ts';

export type GuideId = 'move' | 'look' | 'press' | 'balance';

/** Shown in this order; a guide waits for every earlier one to be finished. */
const ORDER: GuideId[] = ['move', 'look', 'press', 'balance'];

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
const LOOK_TURN = 1.2; // radians of camera turn that counts as "you've got it"

// The control guides ask for every key, which a player may never finish — let
// them expire so the guides behind them (press, balance) still get their turn.
const CONTROL_TIMEOUT = 30_000;

/** Live read of what the player has done, supplied by the controller. */
export interface GuideWatch {
  usedKeys: ReadonlySet<string>;
  heldKeys: ReadonlySet<string>;
  turned: number; // total camera yaw+pitch travel, radians
  presses: number;
  balances: number;
}

export interface GuideOptions {
  watch: () => GuideWatch;
  /** Screen position of the generator the press guide should point at. */
  pressAnchor: () => { x: number; y: number } | null;
  /** The Balance button, so its guide can sit right above it. */
  balanceButton: HTMLElement;
}

export class Guides {
  readonly root: HTMLElement;
  private active: GuideId | null = null;
  private card: HTMLElement | null = null;
  private keycaps = new Map<string, HTMLElement>();
  private unlocked = new Set<GuideId>(['move', 'look']);
  private paused = false;
  private shownAt = 0;

  constructor(private opts: GuideOptions) {
    this.root = el('div', { className: 'guides' });
  }

  /** Hold guides back (during the intro cutscene) without consuming them. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.clearCard();
  }

  /** Let a guide become eligible — it still waits its turn in ORDER. */
  unlock(id: GuideId): void {
    this.unlocked.add(id);
  }

  /** Called every frame: pick the current guide, animate it, retire it when done. */
  update(): void {
    if (this.paused || !getSettings().showTutorials) {
      this.clearCard();
      return;
    }
    const next = this.pick();
    if (next !== this.active) {
      this.clearCard();
      this.active = next;
      this.shownAt = performance.now();
      if (next) this.card = this.build(next);
    }
    if (!this.active || !this.card) return;

    if (this.satisfied(this.active) || this.expired(this.active)) {
      markMechanicSeen(guideKey(this.active));
      const finished = this.card;
      finished.classList.add('guide-complete');
      window.setTimeout(() => finished.remove(), 450);
      this.retire(); // drop our references; `finished` animates itself out
      return;
    }
    this.refresh(this.active);
  }

  dispose(): void {
    this.clearCard();
    this.root.remove();
  }

  // ---------- Step selection ----------

  /** The first guide that is unlocked, unseen and not yet satisfied. */
  private pick(): GuideId | null {
    for (const id of ORDER) {
      if (hasSeenMechanic(guideKey(id))) continue;
      if (!this.unlocked.has(id)) return null; // wait here rather than skipping ahead
      if (this.satisfied(id) && id !== this.active) {
        // Already done before we could show it (e.g. a returning player).
        markMechanicSeen(guideKey(id));
        continue;
      }
      return id;
    }
    return null;
  }

  private satisfied(id: GuideId): boolean {
    const w = this.opts.watch();
    switch (id) {
      case 'move':
        return MOVE_KEYS.every((k) => w.usedKeys.has(k));
      case 'look':
        return w.turned >= LOOK_TURN;
      case 'press':
        return w.presses > 0;
      case 'balance':
        return w.balances > 0;
    }
  }

  private expired(id: GuideId): boolean {
    return (id === 'move' || id === 'look') && performance.now() - this.shownAt > CONTROL_TIMEOUT;
  }

  // ---------- Rendering ----------

  private clearCard(): void {
    this.card?.remove();
    this.retire();
  }

  /** Forget the showing guide and undo anything it changed outside `root`. */
  private retire(): void {
    this.card = null;
    this.active = null;
    this.keycaps.clear();
    this.opts.balanceButton.classList.remove('guide-lit');
  }

  private build(id: GuideId): HTMLElement {
    const card = el('div', { className: `guide-card guide-${id}` });
    if (id === 'move') card.append(this.buildKeycaps());
    else if (id === 'look') card.append(buildMouse());
    else if (id === 'press') card.append(el('div', { className: 'guide-ring' }), el('div', { className: 'guide-hand', text: '👆' }));
    else card.append(el('div', { className: 'guide-arrow', text: '▼' }));
    this.root.append(card);
    return card;
  }

  private buildKeycaps(): HTMLElement {
    const cap = (code: string, label: string, className = 'keycap') => {
      const node = el('div', { className, text: label });
      this.keycaps.set(code, node);
      return node;
    };
    return el('div', { className: 'keycaps' }, [
      el('div', { className: 'keyrow' }, [cap('KeyW', 'W')]),
      el('div', { className: 'keyrow' }, [cap('KeyA', 'A'), cap('KeyS', 'S'), cap('KeyD', 'D')]),
      el('div', { className: 'keyrow' }, [cap('Space', '␣', 'keycap wide')]),
    ]);
  }

  /** Per-frame animation state for the guide that is showing. */
  private refresh(id: GuideId): void {
    const card = this.card;
    if (!card) return;
    if (id === 'move') {
      const w = this.opts.watch();
      for (const [code, node] of this.keycaps) {
        node.classList.toggle('held', w.heldKeys.has(code));
        node.classList.toggle('done', w.usedKeys.has(code));
      }
    } else if (id === 'look') {
      card.classList.toggle('locking', getSettings().cameraMode === 'pointerlock');
    } else if (id === 'press') {
      const at = this.opts.pressAnchor();
      card.classList.toggle('hidden', at === null);
      if (at) place(card, at.x, at.y);
    } else if (id === 'balance') {
      const r = this.opts.balanceButton.getBoundingClientRect();
      this.opts.balanceButton.classList.add('guide-lit');
      place(card, r.left + r.width / 2, r.top - 6);
    }
  }
}

function place(node: HTMLElement, x: number, y: number): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

/** Seen-store key for a guide, namespaced so it never collides with a text tip. */
const guideKey = (id: GuideId): string => `guide-${id}`;

/** Mouse body with the look button called out and a swinging arc above it. */
function buildMouse(): HTMLElement {
  // Body is a 36×60 stadium; the two buttons are quarter wedges around the
  // centre point (36,50), so the divider lines land exactly on their seams.
  const svg = `
    <svg viewBox="0 0 72 104" class="mouse-svg" aria-hidden="true">
      <g class="drag-arrow">
        <line x1="16" y1="18" x2="56" y2="18" />
        <path d="M10 18 L19 13 L19 23 Z" />
        <path d="M62 18 L53 13 L53 23 Z" />
      </g>
      <rect class="shell" x="18" y="32" width="36" height="60" rx="18" />
      <path class="btn left" d="M36 50 L18 50 A18 18 0 0 1 36 32 Z" />
      <path class="btn right" d="M36 50 L36 32 A18 18 0 0 1 54 50 Z" />
      <line class="split" x1="36" y1="32" x2="36" y2="50" />
      <line class="split" x1="18" y1="50" x2="54" y2="50" />
    </svg>`;
  return el('div', { className: 'mouse-glyph', html: svg });
}
