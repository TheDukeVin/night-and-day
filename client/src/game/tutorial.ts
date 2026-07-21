// Mechanic guidance: short toasts introducing each mechanic. Each tip shows only
// on a player's FIRST encounter with that mechanic — the seen-set is tied to the
// account (server-backed via mechanics.ts) for signed-in players and kept in
// memory per session for guests. Ids are distinct from the `guide-*` visual cues
// (guides.ts) so the two never share a seen-flag.

import type { PlayerRole } from '../../../shared/types.ts';
import { getSettings } from '../settings.ts';
import { hasSeenMechanic, markMechanicSeen } from '../mechanics.ts';
import { showToast } from '../screens/ui.ts';

export class Tutorial {
  private queue: { id: string; text: string }[] = [];
  private showing = false;
  private paused = false;

  constructor(private role: PlayerRole) {}

  /** Hold tips back (during the intro cutscene) without consuming them. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.pump();
  }

  private offer(id: string, text: string): void {
    if (!getSettings().showTutorials || hasSeenMechanic(id)) return;
    if (this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, text });
    this.pump();
  }

  private pump(): void {
    if (this.showing || this.paused) return;
    const next = this.queue.shift();
    if (!next) return;
    this.showing = true;
    markMechanicSeen(next.id);
    showToast(next.text, 7);
    window.setTimeout(() => {
      this.showing = false;
      this.pump();
    }, 7500);
  }

  onGameStart(): void {
    // Movement and looking are taught visually by the guide overlay (guides.ts);
    // these tips carry only what a picture cannot.
    if (this.role === 'day') this.offer('role-day', 'You are Day! Only YOU can press the warm golden generators. Your partner handles the starry ones.');
    if (this.role === 'night') this.offer('role-night', 'You are Night! Only YOU can press the starry night generators. Your partner handles the golden ones.');
  }

  onLevelWithGenerators(): void {
    // Pressing a generator is taught by the visual press guide (guides.ts).
    this.offer('goal', 'Goal: every color needs the SAME number of day ☀ and night 🌙 crystals. Watch the counters at the top!');
  }

  onFirstMultiOutput(): void {
    this.offer('multi-output', 'Some generators make several crystals — or several COLORS — with one press. Check the sign carefully!');
  }

  onFirstBalanceReady(): void {
    this.offer('balance', 'Think the sides match? Press the ⚖ Balance button to find out — matching crystals will cancel each other out.');
  }
}
