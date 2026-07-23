// Scripted solution walkthrough for Tutorial levels. Unlike the one-time coach
// marks in `guides.ts`, this replays every visit: it reads the level's stored
// `solution` (and cycle turn order) and points the player at exactly which
// generator to press, how many times, when to "Pass to …", and finally
// "Balance". It reuses the guide visuals (pulsing ring + pointing hand over a
// generator, a bouncing arrow over the primary button) and is gated only by the
// Show Tutorials setting — no seen-set, so it always appears on these levels.

import { el } from '../screens/ui.ts';
import { getSettings } from '../settings.ts';
import { isCycle } from '../../../shared/logic.ts';
import type { LevelDef, Side } from '../../../shared/types.ts';

/** One instruction in the walkthrough. */
type Step =
  | { kind: 'press'; gen: string; target: number; phaseIndex: number }
  | { kind: 'pass'; phaseIndex: number }
  | { kind: 'balance' };

export interface WalkthroughOptions {
  /** Screen position of a specific generator, or null when it is off-screen. */
  standAnchor: (genId: string) => { x: number; y: number } | null;
  /** The HUD primary button (Balance / Pass), so cues can sit above it. */
  primaryButton: HTMLElement;
}

export class Walkthrough {
  readonly root: HTMLElement;
  private level: LevelDef | null = null;
  private steps: Step[] = [];
  private card: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private currentKey = '';
  private paused = false;
  private watch: () => { presses: Record<string, number>; phase: number } = () => ({ presses: {}, phase: 0 });

  constructor(private opts: WalkthroughOptions) {
    this.root = el('div', { className: 'guides walkthrough' });
  }

  /** Supply a live read of presses + phase (wired by the controller). */
  setWatch(watch: () => { presses: Record<string, number>; phase: number }): void {
    this.watch = watch;
  }

  /** (Re)build the step list for a level. Non-tutorial levels clear it. */
  setLevel(level: LevelDef): void {
    this.clearCard();
    this.level = level;
    this.steps = level.tutorial ? buildSteps(level) : [];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.clearCard();
  }

  update(): void {
    if (this.paused || !getSettings().showTutorials || this.steps.length === 0) {
      this.clearCard();
      return;
    }
    const step = this.currentStep();
    const key = stepKey(step);
    if (key !== this.currentKey) {
      this.clearCard();
      this.currentKey = key;
      if (step) this.card = this.build(step);
    }
    if (step) this.refresh(step);
  }

  dispose(): void {
    this.clearCard();
    this.root.remove();
  }

  // ---------- Step logic ----------

  /** The first step the player has not yet completed. */
  private currentStep(): Step | null {
    const { presses, phase } = this.watch();
    for (const step of this.steps) {
      if (step.kind === 'press') {
        // A press whose phase has already passed can no longer be done — skip it
        // rather than pointing at a now-inactive generator.
        if (step.phaseIndex < phase) continue;
        if ((presses[step.gen] ?? 0) < step.target) return step;
      } else if (step.kind === 'pass') {
        if (phase <= step.phaseIndex) return step;
      } else {
        return step; // balance is terminal — show until the level is won
      }
    }
    return null;
  }

  // ---------- Rendering ----------

  private clearCard(): void {
    this.card?.remove();
    this.card = null;
    this.badge = null;
    this.currentKey = '';
    this.opts.primaryButton.classList.remove('guide-lit');
  }

  private build(step: Step): HTMLElement {
    if (step.kind === 'press') {
      const card = el('div', { className: 'guide-card guide-press' });
      card.append(el('div', { className: 'guide-ring' }), el('div', { className: 'guide-hand', text: '👆' }));
      this.badge = el('div', { className: 'wt-badge' });
      card.append(this.badge);
      this.root.append(card);
      return card;
    }
    // pass / balance: arrow over the primary button.
    const card = el('div', { className: 'guide-card guide-balance' });
    card.append(el('div', { className: 'guide-arrow', text: '▼' }));
    this.root.append(card);
    return card;
  }

  private refresh(step: Step): void {
    const card = this.card;
    if (!card) return;
    if (step.kind === 'press') {
      const at = this.opts.standAnchor(step.gen);
      card.classList.toggle('hidden', at === null);
      if (at) place(card, at.x, at.y);
      if (this.badge) {
        const left = step.target - (this.watch().presses[step.gen] ?? 0);
        this.badge.textContent = `${left}×`;
      }
    } else {
      const r = this.opts.primaryButton.getBoundingClientRect();
      this.opts.primaryButton.classList.add('guide-lit');
      place(card, r.left + r.width / 2, r.top - 6);
    }
  }
}

function place(node: HTMLElement, x: number, y: number): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

function stepKey(step: Step | null): string {
  if (!step) return '';
  if (step.kind === 'press') return `press:${step.gen}`;
  if (step.kind === 'pass') return `pass:${step.phaseIndex}`;
  return 'balance';
}

/**
 * Turn a level's solution + turn order into an ordered walkthrough. Cycle levels
 * play out phase by phase (press the active side's generators, then Pass); Sunset
 * levels are one phase with day generators then night. Every phase-boundary emits
 * a Pass, and the whole thing ends with Balance.
 */
function buildSteps(level: LevelDef): Step[] {
  const steps: Step[] = [];
  const phases: Side[][] = isCycle(level) ? level.cycle!.map((s) => [s]) : [['day', 'night']];
  phases.forEach((sides, phaseIndex) => {
    for (const side of sides) {
      for (const gen of level.generators) {
        if (gen.side !== side) continue;
        const target = level.solution[gen.id] ?? 0;
        if (target > 0) steps.push({ kind: 'press', gen: gen.id, target, phaseIndex });
      }
    }
    if (phaseIndex < phases.length - 1) steps.push({ kind: 'pass', phaseIndex });
  });
  steps.push({ kind: 'balance' });
  return steps;
}
