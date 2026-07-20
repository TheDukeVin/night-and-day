// App entry: screen state machine — title → pack select → mode select →
// level select → (room lobby) → game.

import './style.css';
import { GameController } from './game/level.ts';
import { LoopbackChannel, SocketChannel, type GameChannel } from './net/client.ts';
import { STARTER_LEVELS } from '../../shared/levels.ts';
import type { ServerMsg } from '../../shared/types.ts';
import { getSettings, saveSettings } from './settings.ts';
import { button, clearUI, el, showDialog, uiRoot } from './screens/ui.ts';
import { getCurrentUser, login, logout, register } from './net/auth.ts';
import type { AuthUser } from '../../shared/authTypes.ts';

let game: GameController | null = null;
let currentUser: AuthUser | null = null;

function screen(children: HTMLElement[], transparent = false): void {
  clearUI();
  uiRoot().append(el('div', { className: transparent ? 'screen transparent' : 'screen' }, children));
}

// ---------- Title ----------

function showTitle(): void {
  const status = el('div', { className: 'subtitle' }, [
    currentUser ? `Signed in as ${currentUser.username}` : 'Playing as guest',
    ' — ',
    button(
      currentUser ? 'Log out' : 'Sign in',
      async () => {
        if (currentUser) await logout();
        currentUser = null;
        showAuth();
      },
      'menu-btn small'
    ),
  ]);
  screen([
    el('h1', {
      className: 'game-title',
      html: '<span class="night-word">Night</span> and <span class="day-word">Day</span>',
    }),
    el('div', { className: 'subtitle', text: 'A math puzzle adventure at sunset' }),
    status,
    button('New Game', showPackSelect),
    button('Settings', showSettings),
    button('Credits', showCredits),
  ]);
}

// ---------- Auth ----------

function confirmGuest(): void {
  showDialog({
    title: 'Continue as Guest?',
    message: 'Are you sure you want to continue as guest? Any progress you make may be lost.',
    buttons: [
      { label: 'Cancel', onClick: () => {}, className: 'menu-btn small back-link' },
      {
        label: 'Continue as Guest',
        onClick: () => {
          currentUser = null;
          showTitle();
        },
      },
    ],
  });
}

function showAuth(mode: 'login' | 'register' = 'login'): void {
  const username = el('input', { className: 'text-input' }) as HTMLInputElement;
  username.placeholder = 'Username';
  username.maxLength = 20;
  const password = el('input', { className: 'text-input' }) as HTMLInputElement;
  password.placeholder = 'Password';
  password.type = 'password';
  const error = el('div', { className: 'error-text', text: '' });

  const go = async () => {
    error.textContent = '';
    const fn = mode === 'login' ? login : register;
    const result = await fn(username.value.trim(), password.value);
    if (result.error) {
      error.textContent = result.error;
      return;
    }
    currentUser = result.user ?? null;
    showTitle();
  };
  password.addEventListener('keydown', (e) => e.key === 'Enter' && go());

  screen([
    el('h1', {
      className: 'game-title',
      html: '<span class="night-word">Night</span> and <span class="day-word">Day</span>',
    }),
    el('h2', { text: mode === 'login' ? 'Log In' : 'Create an Account' }),
    username,
    password,
    error,
    button(mode === 'login' ? 'Log In' : 'Register', go),
    button(
      mode === 'login' ? "New here? Register" : 'Already have an account? Log in',
      () => showAuth(mode === 'login' ? 'register' : 'login'),
      'menu-btn small back-link'
    ),
    el('div', { className: 'auth-divider', text: 'or' }),
    button('Continue with Google', () => {
      window.location.href = '/auth/google/start';
    }, 'menu-btn google-btn'),
    button('Continue as Guest', confirmGuest, 'menu-btn small'),
  ]);
  username.focus();
}

// ---------- Pack selection ----------

function packCard(name: string, desc: string, enabled: boolean, onClick?: () => void): HTMLButtonElement {
  const card = el('button', { className: 'pack-card' }, [
    el('div', { className: 'pack-name', text: name }),
    el('div', { className: 'pack-desc', text: desc }),
  ]);
  card.disabled = !enabled;
  if (onClick) card.addEventListener('click', onClick);
  return card;
}

function showPackSelect(): void {
  screen([
    el('h2', { text: 'Choose a Pack' }),
    packCard('⭐ Starter', '20 levels — counting, adding, groups and sharing', true, showModeSelect),
    packCard('🔢 Fractions', 'Coming soon', false),
    packCard('📐 Geometry', 'Coming soon', false),
    button('← Back', showTitle, 'menu-btn small back-link'),
  ]);
}

// ---------- Mode selection & rooms ----------

function showModeSelect(): void {
  screen([
    el('h2', { text: 'How do you want to play?' }),
    button('🌗 Single Player', () => showLevelSelect(startSinglePlayer, showModeSelect)),
    button('☀🌙 Two Players', showRoomChoice),
    button('← Back', showPackSelect, 'menu-btn small back-link'),
  ]);
}

// ---------- Level selection ----------

function showLevelSelect(onPick: (level: number) => void, onBack: () => void): void {
  const grid = el('div', { className: 'level-grid' });
  for (const level of STARTER_LEVELS) {
    const card = el('button', { className: 'level-card' }, [
      el('div', { className: 'level-num', text: String(level.index) }),
      el('div', { className: 'level-name', text: level.name }),
    ]);
    card.addEventListener('click', () => onPick(level.index));
    grid.append(card);
  }
  screen([el('h2', { text: 'Choose a Level' }), grid, button('← Back', onBack, 'menu-btn small back-link')]);
}

function showRoomChoice(): void {
  screen([
    el('h2', { text: 'Two Player' }),
    el('div', { className: 'subtitle', text: 'One of you creates a room, the other joins it by name.' }),
    button('Create a Room', () => showLevelSelect((level) => showRoomForm('create', level), showRoomChoice)),
    button('Join a Room', () => showRoomForm('join', 1)),
    button('← Back', showModeSelect, 'menu-btn small back-link'),
  ]);
}

function showRoomForm(kind: 'create' | 'join', level: number): void {
  const input = el('input', { className: 'text-input' }) as HTMLInputElement;
  input.placeholder = kind === 'create' ? 'Name your room…' : 'Enter the room name…';
  input.maxLength = 24;
  const error = el('div', { className: 'error-text', text: '' });
  const go = () => {
    const room = input.value.trim();
    if (!room) {
      error.textContent = 'Please enter a room name.';
      return;
    }
    startTwoPlayer(kind, room, level, (message) => (error.textContent = message));
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  screen([
    el('h2', { text: kind === 'create' ? 'Create a Room' : 'Join a Room' }),
    input,
    error,
    button(kind === 'create' ? 'Create' : 'Join', go),
    button('← Back', showRoomChoice, 'menu-btn small back-link'),
  ]);
  input.focus();
}

function showLobby(room: string, isHost: boolean, level: number, channel: SocketChannel): void {
  const status = el('div', {
    className: 'subtitle',
    text: isHost ? 'Waiting for a friend to join…' : 'Waiting for the host to begin…',
  });
  const beginButton = button('Begin!', () => channel.send({ t: 'begin', level }));
  beginButton.style.display = 'none';
  const leave = () => {
    channel.close();
    showRoomChoice();
  };
  const levelName = STARTER_LEVELS.find((l) => l.index === level)?.name ?? '';
  screen([
    el('h2', { text: `Room: ${room}` }),
    el('div', { className: 'subtitle', text: `You are ${channel.role === 'day' ? 'Day ☀' : 'Night 🌙'}` }),
    ...(isHost ? [el('div', { className: 'subtitle', text: `Level ${level}: ${levelName}` })] : []),
    status,
    beginButton,
    button('← Leave', leave, 'menu-btn small back-link'),
  ]);

  channel.onMessage = (msg: ServerMsg) => {
    if (msg.t === 'peer-joined') {
      status.textContent = isHost ? 'Your friend is here!' : status.textContent;
      if (isHost) beginButton.style.display = '';
    } else if (msg.t === 'begin') {
      startGame(channel, msg.level);
    } else if (msg.t === 'peer-left') {
      status.textContent = 'The other player left…';
      beginButton.style.display = 'none';
    } else if (msg.t === 'error') {
      status.textContent = msg.message;
    }
  };
}

function startTwoPlayer(kind: 'create' | 'join', room: string, level: number, onError: (m: string) => void): void {
  const channel = new SocketChannel(onError);
  channel.onMessage = (msg: ServerMsg) => {
    if (msg.t === 'created') showLobby(room, true, level, channel);
    else if (msg.t === 'joined') {
      showLobby(room, false, level, channel);
      // Joiner arrives with the peer (host) already present.
    } else if (msg.t === 'error') {
      channel.close();
      onError(msg.message);
    }
  };
  channel.send({ t: kind, room });
}

function startSinglePlayer(level: number): void {
  startGame(new LoopbackChannel(level), level);
}

function enterFullscreen(): void {
  // Best-effort: browsers require a user gesture for this, which holds for
  // every caller except the room joiner (whose "begin" arrives over the
  // socket) — silently ignore rejection there. Escape exits it natively.
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function startGame(channel: GameChannel, startLevel: number): void {
  clearUI();
  game?.dispose();
  enterFullscreen();
  game = new GameController(
    channel,
    () => {
      game = null;
      showTitle();
    },
    startLevel
  );
}

// ---------- Settings & credits ----------

function showSettings(): void {
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

  const tut = el('input') as HTMLInputElement;
  tut.type = 'checkbox';
  tut.checked = settings.showTutorials;
  tut.addEventListener('change', () => saveSettings({ showTutorials: tut.checked }));
  panel.append(el('div', { className: 'settings-row' }, [el('span', { text: 'Show tutorial tips' }), tut]));

  const resetTut = button('Replay tutorial tips', () => localStorage.removeItem('night-and-day-tutorials-seen'), 'menu-btn small');
  panel.append(el('div', { className: 'settings-row' }, [resetTut]));

  screen([el('h2', { text: 'Settings' }), panel, button('← Back', showTitle, 'menu-btn small back-link')]);
}

function showCredits(): void {
  screen([
    el('h2', { text: 'Credits' }),
    el('div', {
      className: 'credits-text',
      html: `<b>Night and Day</b> — a math education puzzle game.<br/><br/>
        Design & code: the Night and Day team.<br/>
        Built with <b>three.js</b>, TypeScript and Vite.<br/><br/>
        Made for curious minds who like to balance things. ☀🌙`,
    }),
    button('← Back', showTitle, 'menu-btn small back-link'),
  ]);
}

getCurrentUser().then((user) => {
  currentUser = user;
  if (user) showTitle();
  else showAuth();
});
