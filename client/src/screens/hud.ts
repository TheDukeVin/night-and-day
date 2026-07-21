// In-game HUD: level name, per-color day/night counts, Balance and Reset
// buttons, plus a role badge.

import type { CrystalColor, CrystalCounts, LevelDef, PlayerRole } from '../../../shared/types.ts';
import { COLOR_HEX, collectColors } from '../game/crystals.ts';
import { button, el } from './ui.ts';

const ROLE_LABEL: Record<PlayerRole, string> = {
  day: 'You are DAY ☀️ — use the golden generators',
  night: 'You are NIGHT 🌙 — use the starry generators',
  dusk: 'You are DUSK 🌗 — you can use every generator',
};

export class Hud {
  readonly root: HTMLElement;
  private countBoard: HTMLElement;
  private levelLabel: HTMLElement;
  private cells = new Map<CrystalColor, { day: HTMLElement; night: HTMLElement; cell: HTMLElement }>();
  /** Exposed so the guide overlay can point at it. */
  readonly balanceButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private resetButton: HTMLButtonElement;
  private canUndo = false;

  constructor(
    role: PlayerRole,
    private onBalance: () => void,
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

    this.root.append(el('div', { className: 'hud-role', text: ROLE_LABEL[role] }));

    this.balanceButton = button('⚖ Balance', () => this.onBalance(), 'menu-btn small balance-btn');
    this.undoButton = button('↶ Undo', () => this.onUndo(), 'menu-btn small');
    this.undoButton.disabled = true;
    this.resetButton = button('↺ Reset', () => this.onReset(), 'menu-btn small');
    const quitButton = button('✕ Quit', onQuit, 'menu-btn small');
    this.root.append(
      el('div', { className: 'hud-bottom' }, [this.balanceButton, this.undoButton, this.resetButton, quitButton])
    );
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
    this.balanceButton.disabled = busy;
    this.resetButton.disabled = busy;
    this.undoButton.disabled = busy || !this.canUndo;
  }
}
