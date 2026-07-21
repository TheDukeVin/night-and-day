// The settings controls, built once and shared by the title-menu Settings
// screen and the corner ⚙ button's overlay (which can open mid-game).

import { getSettings, saveSettings } from '../settings.ts';
import { el } from './ui.ts';

export function buildSettingsPanel(): HTMLElement {
  const settings = getSettings();
  const panel = el('div', { className: 'settings-panel' });

  const sens = el('input') as HTMLInputElement;
  sens.type = 'range';
  sens.min = '0.3';
  sens.max = '2';
  sens.step = '0.1';
  sens.value = String(settings.mouseSensitivity);
  sens.addEventListener('input', () => saveSettings({ mouseSensitivity: Number(sens.value) }));
  panel.append(el('div', { className: 'settings-row' }, [el('span', { text: 'Mouse sensitivity' }), sens]));

  const lookMode = el('input') as HTMLInputElement;
  lookMode.type = 'checkbox';
  lookMode.checked = settings.cameraMode === 'pointerlock';
  lookMode.addEventListener('change', () =>
    saveSettings({ cameraMode: lookMode.checked ? 'pointerlock' : 'drag' })
  );
  panel.append(
    el('div', { className: 'settings-row' }, [el('span', { text: 'Mouse-look (click to lock cursor)' }), lookMode])
  );
  panel.append(
    el('div', {
      className: 'settings-hint',
      text: 'Off: hold right mouse button and drag to look around. On: click the game to lock your cursor and look around freely — press Esc to let go.',
    })
  );

  const quality = el('input') as HTMLInputElement;
  quality.type = 'checkbox';
  quality.checked = settings.quality === 'high';
  quality.addEventListener('change', () => saveSettings({ quality: quality.checked ? 'high' : 'low' }));
  panel.append(el('div', { className: 'settings-row' }, [el('span', { text: 'High quality graphics' }), quality]));
  panel.append(
    el('div', { className: 'settings-hint', text: 'Graphics quality applies the next time a level starts.' })
  );

  const tut = el('input') as HTMLInputElement;
  tut.type = 'checkbox';
  tut.checked = settings.showTutorials;
  tut.addEventListener('change', () => saveSettings({ showTutorials: tut.checked }));
  panel.append(el('div', { className: 'settings-row' }, [el('span', { text: 'Show tutorial tips' }), tut]));

  return panel;
}
