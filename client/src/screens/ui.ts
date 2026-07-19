// Tiny DOM helpers for menu screens and HUD.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { className?: string; text?: string; html?: string } = {},
  children: (HTMLElement | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.className) node.className = attrs.className;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;
  for (const child of children) node.append(child);
  return node;
}

export function button(label: string, onClick: () => void, className = 'menu-btn'): HTMLButtonElement {
  const b = el('button', { className, text: label });
  b.addEventListener('click', onClick);
  return b;
}

export const uiRoot = (): HTMLElement => document.getElementById('ui-root')!;

export function clearUI(): void {
  uiRoot().replaceChildren();
}

let activeToast: HTMLElement | null = null;
let toastTimer: number | undefined;

export function showToast(message: string, seconds = 5): void {
  dismissToast();
  const toast = el('div', { className: 'toast', text: message });
  uiRoot().append(toast);
  activeToast = toast;
  toastTimer = window.setTimeout(() => dismissToast(), seconds * 1000);
}

export function dismissToast(): void {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = undefined;
  if (activeToast) {
    const t = activeToast;
    activeToast = null;
    t.classList.add('fade-out');
    window.setTimeout(() => t.remove(), 500);
  }
}

export interface DialogButton {
  label: string;
  onClick: () => void;
  className?: string;
}

/** Modal dialog; returns a close function. Buttons close the dialog first. */
export function showDialog(opts: {
  title?: string;
  message: string;
  buttons: DialogButton[];
  winStyle?: boolean;
}): () => void {
  const backdrop = el('div', { className: 'dialog-backdrop' });
  const dialog = el('div', { className: opts.winStyle ? 'dialog win' : 'dialog' });
  if (opts.title) dialog.append(el('h2', { text: opts.title }));
  const msg = el('div');
  msg.style.whiteSpace = 'pre-line';
  msg.textContent = opts.message;
  dialog.append(msg);
  const row = el('div', { className: 'dialog-buttons' });
  for (const b of opts.buttons) {
    row.append(
      button(
        b.label,
        () => {
          backdrop.remove();
          b.onClick();
        },
        b.className ?? 'menu-btn small'
      )
    );
  }
  dialog.append(row);
  backdrop.append(dialog);
  uiRoot().append(backdrop);
  return () => backdrop.remove();
}
