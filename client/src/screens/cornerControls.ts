// Always-available ⚙ settings and fullscreen buttons pinned to the top-right
// corner. They live outside #ui-root so screen changes (which wipe that root)
// never remove them, and they stay usable mid-level.

import { buildSettingsPanel } from './settingsPanel.ts';
import { button, el } from './ui.ts';

export function mountCornerControls(): void {
  if (document.getElementById('corner-controls')) return;

  const settingsBtn = button('⚙', openSettingsOverlay, 'corner-btn');
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');

  // One glyph for both directions — the lit state and the tooltip say which way
  // it goes, and browsers can drop fullscreen without telling us first (Esc).
  const fullscreenBtn = button('⛶', toggleFullscreen, 'corner-btn');
  const syncFullscreenBtn = (): void => {
    const on = document.fullscreenElement !== null;
    fullscreenBtn.classList.toggle('active', on);
    const label = on ? 'Exit full screen' : 'Enter full screen';
    fullscreenBtn.title = label;
    fullscreenBtn.setAttribute('aria-label', label);
  };
  syncFullscreenBtn();
  document.addEventListener('fullscreenchange', syncFullscreenBtn);

  const bar = el('div', {}, [settingsBtn, fullscreenBtn]);
  bar.id = 'corner-controls';
  document.body.append(bar);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  } else {
    // Safari (and older WebKit) only expose the webkit-prefixed form.
    const target = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
    if (request) void request.call(target).catch(() => {});
  }
}

/**
 * Settings as a modal overlay rather than a screen swap, so opening it from
 * inside a level leaves the game running underneath.
 */
function openSettingsOverlay(): void {
  if (document.querySelector('.settings-overlay')) return;

  const backdrop = el('div', { className: 'dialog-backdrop settings-overlay' });
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const dialog = el('div', { className: 'dialog' }, [
    el('h2', { text: 'Settings' }),
    buildSettingsPanel(),
    el('div', { className: 'dialog-buttons' }, [button('Close', close, 'menu-btn small')]),
  ]);
  backdrop.append(dialog);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.body.append(backdrop);
}
