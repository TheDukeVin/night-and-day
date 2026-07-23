// In-game HUD: level name, per-color day/night counts, the primary
// Balance/Pass button, Undo and Reset, plus a role/turn badge.

import type { CrystalColor, CrystalCounts, GameState, LevelDef, PlayerRole, Side } from '../../../shared/types.ts';
import { activeSide, canPass, isCycle } from '../../../shared/logic.ts';
import { COLOR_HEX, collectColors } from '../game/crystals.ts';
import { button, el } from './ui.ts';

const ROLE_LABEL: Record<PlayerRole, string> = {
  day: 'You are DAY ☀️ — use the golden generators',
  night: 'You are NIGHT 🌙 — use the starry generators',
  dusk: 'You are DUSK 🌗 — you can use every generator',
};

const SIDE_ICON: Record<Side, string> = { day: '☀️', night: '🌙' };
const cap = (s: Side): string => s[0].toUpperCase() + s.slice(1);

export class Hud {
  readonly root: HTMLElement;
  private countBoard: HTMLElement;
  private levelLabel: HTMLElement;
  private roleLabel: HTMLElement;
  private cells = new Map<CrystalColor, { day: HTMLElement; night: HTMLElement; cell: HTMLElement }>();
  /**
   * The primary action button. Exposed so the guide overlay can point at it. On
   * Sunset levels it is always "Balance"; on Cycle levels it becomes "Pass to …"
   * until the final phase (see `setTurn`).
   */
  readonly balanceButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private resetButton: HTMLButtonElement;
  private canUndo = false;
  private busy = false;
  /** Whether the primary button currently fires Pass (vs Balance). */
  private primaryIsPass = false;
  /** Whether the primary button is disabled because it is the other side's turn. */
  private waiting = false;

  constructor(
    private role: PlayerRole,
    private onBalance: () => void,
    private onPass: () => void,
    private onUndo: () => void,
    private onReset: () => void,
    onQuit: () => void
  ) {
    this.root = el('div');
    this.root.id = 'hud';

    this.levelLabel = el('div', { className: 'level-name' });
    this.countBoard = el('div', { className: 'count-board' });
    const top = el('div', { className: 'hud-top' }, [this.levelLabel, this.countBoard]);
    this.root.append(top);

    this.roleLabel = el('div', { className: 'hud-role', text: ROLE_LABEL[role] });
    this.root.append(this.roleLabel);

    this.balanceButton = button('⚖ Balance', () => this.onPrimary(), 'menu-btn small balance-btn');
    this.undoButton = button('↶ Undo', () => this.onUndo(), 'menu-btn small');
    this.undoButton.disabled = true;
    this.resetButton = button('↺ Reset', () => this.onReset(), 'menu-btn small');
    const quitButton = button('✕ Quit', onQuit, 'menu-btn small');
    this.root.append(
      el('div', { className: 'hud-bottom' }, [this.balanceButton, this.undoButton, this.resetButton, quitButton])
    );
  }

  private onPrimary(): void {
    if (this.waiting) return;
    if (this.primaryIsPass) this.onPass();
    else this.onBalance();
  }

  /**
   * Set the primary button and role badge for the current turn. Sunset levels
   * keep "Balance" for everyone. Cycle levels: the active player gets "Pass to
   * <next>" until the final phase, then "Balance"; a waiting player (2-player,
   * other side active) gets a disabled "<side> is playing…".
   */
  setTurn(level: LevelDef, state: GameState): void {
    const btn = this.balanceButton;
    if (!isCycle(level)) {
      this.primaryIsPass = false;
      this.waiting = false;
      btn.textContent = '⚖ Balance';
      btn.classList.remove('pass-btn');
      this.roleLabel.textContent = ROLE_LABEL[this.role];
      this.setBusy(this.busy);
      return;
    }
    const active = activeSide(level, state)!;
    const iAmActive = this.role === 'dusk' || this.role === active;
    this.roleLabel.textContent =
      this.role === 'dusk'
        ? `${SIDE_ICON[active]} ${cap(active)}'s turn — only ${cap(active)} generators work now`
        : iAmActive
          ? `${SIDE_ICON[active]} It's YOUR turn (${cap(active)})!`
          : `${SIDE_ICON[active]} ${cap(active)} is playing — get ready for your turn`;

    if (!iAmActive) {
      this.waiting = true;
      this.primaryIsPass = false;
      btn.textContent = `${SIDE_ICON[active]} ${cap(active)} is playing…`;
      btn.classList.remove('pass-btn');
      btn.disabled = true;
      return;
    }
    this.waiting = false;
    if (canPass(level, state)) {
      const next = level.cycle![state.phase + 1];
      this.primaryIsPass = true;
      btn.textContent = `→ Pass to ${cap(next)}`;
      btn.classList.add('pass-btn');
    } else {
      this.primaryIsPass = false;
      btn.textContent = '⚖ Balance';
      btn.classList.remove('pass-btn');
    }
    this.setBusy(this.busy);
  }

  setLevel(level: LevelDef): void {
    this.levelLabel.textContent = `Level ${level.index}: ${level.name} — ${level.concept}`;
    this.countBoard.replaceChildren();
    this.cells.clear();
    for (const color of collectColors(level)) {
      const swatch = el('div', { className: 'swatch' });
      swatch.style.background = COLOR_HEX[color].ui;
      const dayN = el('span', { className: 'day-n', text: '0' });
      const nightN = el('span', { className: 'night-n', text: '0' });
      const nums = el('div', { className: 'nums' }, [el('span', { text: '☀' }), dayN, el('span', { text: ' · 🌙' }), nightN]);
      const cell = el('div', { className: 'count-cell' }, [swatch, nums]);
      this.countBoard.append(cell);
      this.cells.set(color, { day: dayN, night: nightN, cell });
    }
  }

  setCounts(counts: CrystalCounts): void {
    for (const [color, cell] of this.cells) {
      const c = counts[color] ?? { day: 0, night: 0 };
      cell.day.textContent = ` ${c.day}`;
      cell.night.textContent = ` ${c.night}`;
      cell.cell.classList.toggle('balanced', c.day === c.night);
    }
  }

  /** Enable Undo only when there is a press to take back. */
  setCanUndo(canUndo: boolean): void {
    this.canUndo = canUndo;
    this.undoButton.disabled = !canUndo || this.balanceButton.disabled;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    // A waiting (non-active-turn) player keeps the primary button disabled.
    this.balanceButton.disabled = busy || this.waiting;
    this.resetButton.disabled = busy;
    this.undoButton.disabled = busy || !this.canUndo;
  }
}
