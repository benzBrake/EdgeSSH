export class WorkspaceSplit {
  private readonly pane: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly divider: HTMLElement;
  private terminalRatio: number | undefined;

  constructor(private readonly root: HTMLElement, private readonly fitTerminal: () => void,
    private readonly localize: (zh: string, en: string) => string) {
    this.pane = root.querySelector<HTMLElement>('.terminal-pane')!;
    this.dock = root.querySelector<HTMLElement>('.workspace-dock')!;
    this.pane.id = 'ssh-terminal-pane';
    this.dock.id = 'ssh-workspace-dock';
    this.divider = document.createElement('div');
    this.divider.className = 'workspace-divider';
    this.divider.setAttribute('role', 'separator');
    this.divider.setAttribute('aria-orientation', 'horizontal');
    this.divider.setAttribute('aria-controls', `${this.pane.id} ${this.dock.id}`);
    this.divider.tabIndex = 0;
    this.divider.hidden = true;
    this.dock.before(this.divider);
    root.classList.add('ssh-workbench');
    this.refreshLanguage();
    this.bindResize();
    const observer = new ResizeObserver(() => this.resizeTerminal());
    for (const target of [root, ...this.dock.querySelectorAll('.event-bar, .file-toolbar, .file-statusbar, .process-statusbar')]) {
      observer.observe(target);
    }
  }

  setOpen(open: boolean): void {
    this.divider.hidden = !open;
    if (open) this.resizeTerminal();
  }

  refreshLanguage(): void {
    this.divider.setAttribute('aria-label', this.localize('调整终端高度', 'Resize terminal'));
  }

  private resizeTerminal(height?: number): void {
    if (this.divider.hidden) return;
    const available = this.root.clientHeight - 8;
    // Hidden session iframes must retain their ratio and never trigger a fit.
    if (available <= 0) return;
    const controls = [...this.dock.querySelectorAll<HTMLElement>('.event-bar, .file-toolbar, .file-statusbar, .process-statusbar')]
      .reduce((total, control) => total + control.offsetHeight, 0);
    const max = Math.max(64, available - controls - 84);
    const min = Math.min(180, available * .28, max);
    const ratio = this.terminalRatio ?? (matchMedia('(max-width: 760px)').matches ? .5 : 1.618 / 2.618);
    const actual = Math.round(Math.max(min, Math.min(max, height ?? available * ratio)));
    this.root.style.setProperty('--workspace-terminal-height', `${actual}px`);
    this.divider.setAttribute('aria-valuemin', String(Math.round(min)));
    this.divider.setAttribute('aria-valuemax', String(Math.round(max)));
    this.divider.setAttribute('aria-valuenow', String(actual));
    // Keep the user's preferred ratio even when a small viewport clamps it.
    if (height !== undefined) this.terminalRatio = actual / available;
    this.fitTerminal();
  }

  private bindResize(): void {
    let drag: { pointer: number; y: number; height: number } | undefined;
    this.divider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { pointer: event.pointerId, y: event.clientY, height: this.pane.offsetHeight };
      this.divider.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.divider.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      this.resizeTerminal(drag.height + event.clientY - drag.y);
    });
    this.divider.addEventListener('lostpointercapture', () => { drag = undefined; });
    this.divider.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const height = event.key === 'Home' ? Number(this.divider.getAttribute('aria-valuemin'))
        : event.key === 'End' ? Number(this.divider.getAttribute('aria-valuemax'))
          : this.pane.offsetHeight + (event.key === 'ArrowUp' ? -20 : 20);
      this.resizeTerminal(height);
    });
  }
}
