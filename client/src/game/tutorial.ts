// First-time guidance: short toasts introducing each mechanic the first time
// the player encounters it. Seen-flags persist in localStorage.

import type { PlayerRole } from '../../../shared/types.ts';
import { getSettings, markTutorialSeen, tutorialSeen } from '../settings.ts';
import { showToast } from '../screens/ui.ts';

export class Tutorial {
  private queue: { id: string; text: string }[] = [];
  private showing = false;
  private paused = false;

  constructor(private role: PlayerRole) {}

  /** Hold tips back (during the intro cutscene) without burning their seen-flags. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  private offer(id: string, text: string): void {
    if (!getSettings().showTutorials || tutorialSeen(id)) return;
    if (this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, text });
    this.pump();
  }

  private pump(): void {
    if (this.showing || this.paused) return;
    const next = this.queue.shift();
    if (!next) return;
    this.showing = true;
    markTutorialSeen(next.id);
    showToast(next.text, 7);
    window.setTimeout(() => {
      this.showing = false;
      this.pump();
    }, 7500);
  }

  onGameStart(): void {
    this.offer('move', 'Use the W A S D keys to walk around. Drag with the mouse to look around.');
    if (this.role === 'day') this.offer('role-day', 'You are Day! Only YOU can press the warm golden generators. Your partner handles the starry ones.');
    if (this.role === 'night') this.offer('role-night', 'You are Night! Only YOU can press the starry night generators. Your partner handles the golden ones.');
  }

  onLevelWithGenerators(): void {
    this.offer('generator', 'Walk up to a generator (the stone pedestal) and click it to create crystals. The sign shows what each press makes.');
    this.offer('goal', 'Goal: every color needs the SAME number of day ☀ and night 🌙 crystals. Watch the counters at the top!');
  }

  onFirstMultiOutput(): void {
    this.offer('multi-output', 'Some generators make several crystals — or several COLORS — with one press. Check the sign carefully!');
  }

  onFirstBalanceReady(): void {
    this.offer('balance', 'Think the sides match? Press the ⚖ Balance button to find out — matching crystals will cancel each other out.');
  }
}
