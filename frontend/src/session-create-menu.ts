export type SessionKind = 'ssh' | 'sftp';

export function bindSessionCreateMenu(button: HTMLButtonElement, menu: HTMLElement, create: (kind: SessionKind) => void): void {
  let timer: number | undefined;
  let longPressed = false;
  let start: { x: number; y: number } | undefined;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[data-session-kind]')];
  const cancelPress = () => { window.clearTimeout(timer); timer = undefined; start = undefined; };
  const close = (restoreFocus = false) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  };
  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items[0]?.focus();
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    cancelPress();
    longPressed = false;
    start = { x: event.clientX, y: event.clientY };
    timer = window.setTimeout(() => { longPressed = true; open(); }, 500);
  });
  button.addEventListener('pointermove', (event) => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelPress();
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, cancelPress);
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    cancelPress();
    longPressed = true;
    open();
  });
  button.addEventListener('click', () => {
    cancelPress();
    if (longPressed) { longPressed = false; return; }
    close();
    create('ssh');
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Tab') close();
  });
  items.forEach((item) => item.addEventListener('click', () => {
    close();
    create(item.dataset.sessionKind as SessionKind);
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  });
  window.addEventListener('blur', () => { cancelPress(); close(); });
}
