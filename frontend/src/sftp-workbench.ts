import { createElement, SlidersHorizontal, ChevronDown, ChevronUp, ArrowLeft, ArrowUp, House, RefreshCw, Upload, Download, FolderPlus, Pencil, Trash2 } from 'lucide';
import type { FileManager, FileServiceState } from './file-manager';
import type { ArboristFileList } from './file-list';
import type { ConnectionControlState } from './ui-state';
import './sftp-workbench.css';

interface SftpWorkbenchActions {
  configure(): void;
  disconnect(): void;
  fitTerminal(): void;
  focusTerminal(): void;
  onState(state: ConnectionControlState): void;
  reportError(message: string): void;
  localize(zh: string, en: string): string;
}

export class SftpWorkbench {
  readonly terminalPane: HTMLElement;
  private readonly terminalToggle: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly divider: HTMLElement;
  private list: ArboristFileList | undefined;
  private sshState: ConnectionControlState = 'idle';
  private serviceState: FileServiceState = 'idle';
  private preparing = false;
  private terminalOpen = false;
  private terminalHeight: number | undefined;

  constructor(private readonly root: HTMLElement, private readonly panel: HTMLElement, private readonly manager: FileManager,
    private readonly actions: SftpWorkbenchActions) {
    root.classList.add('sftp-workbench');
    this.terminalPane = root.querySelector<HTMLElement>('.terminal-pane')!;
    const connectionActions = document.createElement('div');
    connectionActions.className = 'sftp-connection-actions';
    connectionActions.innerHTML = `
      <span id="sftp-connection-state" class="sftp-state" role="status" aria-live="polite"></span>
      <button id="sftp-settings" class="small-button" type="button"><span data-i18n-zh="连接设置" data-i18n-en="Connection settings">连接设置</span></button>
      <button id="sftp-disconnect" class="small-button" type="button"></button>`;
    root.querySelector<HTMLElement>('.session-target')!.hidden = true;
    panel.querySelector('.file-statusbar')!.append(connectionActions);
    connectionActions.querySelector('#sftp-settings')!.prepend(createElement(SlidersHorizontal, { 'aria-hidden': 'true' }));
    for (const [id, icon] of [
      ['file-back', ArrowLeft], ['file-up', ArrowUp], ['file-home', House], ['file-refresh', RefreshCw],
      ['file-upload', Upload], ['file-download', Download], ['file-mkdir', FolderPlus], ['file-rename', Pencil], ['file-delete', Trash2],
    ] as const) {
      const button = panel.querySelector<HTMLButtonElement>(`#${id}`)!;
      const zh = button.dataset.i18nZh ?? button.dataset.i18nAriaLabelZh!;
      const en = button.dataset.i18nEn ?? button.dataset.i18nAriaLabelEn!;
      delete button.dataset.i18nZh;
      delete button.dataset.i18nEn;
      button.dataset.i18nAriaLabelZh = button.dataset.i18nTitleZh = zh;
      button.dataset.i18nAriaLabelEn = button.dataset.i18nTitleEn = en;
      button.setAttribute('aria-label', actions.localize(zh, en));
      button.title = actions.localize(zh, en);
      button.replaceChildren(createElement(icon, { 'aria-hidden': 'true' }));
    }
    this.disconnectButton = connectionActions.querySelector('#sftp-disconnect')!;
    this.status = connectionActions.querySelector('#sftp-connection-state')!;
    this.notice = document.createElement('p');
    this.notice.id = 'files-notice';
    this.notice.className = 'sftp-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.divider = document.createElement('div');
    this.divider.className = 'sftp-terminal-divider';
    this.divider.setAttribute('role', 'separator');
    this.divider.setAttribute('aria-orientation', 'horizontal');
    this.divider.setAttribute('aria-controls', 'sftp-terminal-pane');
    this.divider.tabIndex = 0;
    this.terminalPane.id = 'sftp-terminal-pane';
    this.divider.hidden = true;
    root.querySelector<HTMLElement>('.workspace-dock')!.hidden = true;
    panel.hidden = false;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', actions.localize('远程文件', 'Remote files'));
    panel.removeAttribute('aria-labelledby');
    root.prepend(this.notice, panel, this.divider, this.terminalPane);
    const terminalHeader = this.terminalPane.querySelector('.terminal-toolbar')!;
    const title = document.createElement('strong');
    title.className = 'sftp-terminal-title';
    title.dataset.i18nZh = 'SSH 终端';
    title.dataset.i18nEn = 'SSH terminal';
    terminalHeader.prepend(title);
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'toolbar-button';
    collapse.id = 'sftp-terminal-collapse';
    collapse.setAttribute('aria-controls', 'terminal-stage terminal-tools');
    collapse.setAttribute('aria-expanded', 'false');
    this.terminalToggle = collapse;
    terminalHeader.querySelector('.terminal-actions')!.append(collapse);
    this.terminalToggle.addEventListener('click', () => this.setTerminalOpen(!this.terminalOpen));
    connectionActions.querySelector('#sftp-settings')!.addEventListener('click', actions.configure);
    this.disconnectButton.addEventListener('click', actions.disconnect);
    // 文件工作台首次展开终端时，优先给终端输出留出空间。
    document.getElementById('command-editor-close')!.click();
    this.bindResize();
    const observer = new ResizeObserver(() => { if (this.terminalOpen) this.resizeTerminal(); });
    for (const target of [root, this.notice, panel.querySelector('.file-toolbar')!, panel.querySelector('.file-statusbar')!]) observer.observe(target);
    manager.onConnectionChange((state) => { this.serviceState = state; this.renderConnection(); });
    this.refreshLanguage();
    void this.mountList();
  }

  private async mountList(): Promise<void> {
    try {
      const { ArboristFileList } = await import('./file-list');
      const host = document.createElement('div');
      host.className = 'files-list';
      this.panel.querySelector('.file-table-wrap')!.prepend(host);
      this.list = new ArboristFileList(host, {
        select: (index) => this.manager.selectEntry(index),
        activate: (index) => this.manager.activateIndex(index),
      });
      this.panel.querySelector<HTMLTableElement>('.file-table')!.hidden = true;
      this.manager.setListView(this.list);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `${this.actions.localize('文件列表组件加载失败，请刷新后重试。', 'File list failed to load. Refresh to retry.')} ${detail}`;
      this.setMessage(message, true);
      this.actions.reportError(message);
      this.panel.querySelector<HTMLElement>('.file-table-wrap')!.inert = true;
    }
  }

  setConnection(state: ConnectionControlState, preparing = false): void {
    this.sshState = state;
    this.preparing = preparing;
    this.renderConnection();
  }

  private renderConnection(): void {
    const { localize } = this.actions;
    const effective = this.sshState === 'connected'
      ? this.serviceState === 'ready' ? 'connected' : this.serviceState === 'error' || this.serviceState === 'idle' ? 'error' : 'connecting'
      : this.preparing ? 'connecting' : this.sshState;
    const labels: Record<FileServiceState, string> = {
      idle: localize('SFTP 未连接', 'SFTP disconnected'), connecting: localize('正在连接 SFTP', 'Connecting SFTP'),
      ready: localize('SFTP 已连接', 'SFTP connected'), reconnecting: localize('SFTP 正在重连', 'Reconnecting SFTP'),
      error: localize('SFTP 连接失败', 'SFTP connection failed'),
    };
    this.status.textContent = this.preparing ? localize('读取凭据中…', 'Loading credentials…')
      : this.sshState === 'connected' ? labels[this.serviceState]
        : this.sshState === 'connecting' ? localize('正在连接 SSH', 'Connecting SSH')
          : this.sshState === 'error' ? localize('连接失败', 'Connection failed')
            : this.sshState === 'disconnecting' ? localize('正在断开…', 'Disconnecting…') : labels.idle;
    this.status.dataset.state = effective;
    this.disconnectButton.textContent = this.preparing || this.sshState === 'connecting' ? localize('取消连接', 'Cancel connection') : localize('断开', 'Disconnect');
    this.disconnectButton.disabled = !this.preparing && this.sshState !== 'connected' && this.sshState !== 'connecting';
    this.terminalToggle.disabled = this.preparing;
    this.actions.onState(effective);
  }

  setMessage(message: string, error = false): void {
    this.notice.textContent = message;
    this.notice.classList.toggle('error', error);
    this.notice.hidden = !message;
  }

  setTerminalOpen(open: boolean): void {
    this.terminalOpen = open;
    this.divider.hidden = !open;
    this.root.classList.toggle('terminal-open', open);
    this.terminalToggle.setAttribute('aria-expanded', String(open));
    this.refreshLanguage();
    if (open) { this.resizeTerminal(); requestAnimationFrame(() => this.actions.focusTerminal()); }
    else { this.terminalToggle.focus(); }
    requestAnimationFrame(this.actions.fitTerminal);
  }

  get isTerminalOpen(): boolean {
    return this.terminalOpen;
  }

  refreshLanguage(): void {
    const { localize } = this.actions;
    const toggleLabel = this.terminalOpen ? localize('收起终端', 'Hide terminal') : localize('显示终端', 'Show terminal');
    this.terminalToggle.setAttribute('aria-label', toggleLabel);
    this.terminalToggle.title = toggleLabel;
    this.terminalToggle.replaceChildren(createElement(this.terminalOpen ? ChevronDown : ChevronUp, { 'aria-hidden': 'true' }));
    this.divider.setAttribute('aria-label', localize('调整终端高度', 'Resize terminal'));
    this.root.querySelector('#sftp-settings span')!.textContent = localize('连接设置', 'Connection settings');
    this.root.querySelector('#sftp-settings')!.setAttribute('title', localize('连接设置', 'Connection settings'));
    this.root.querySelector('#sftp-settings')!.setAttribute('aria-label', localize('连接设置', 'Connection settings'));
    this.terminalPane.querySelector('.sftp-terminal-title')!.textContent = localize('SSH 终端', 'SSH terminal');
    this.panel.setAttribute('aria-label', localize('远程文件', 'Remote files'));
    this.renderConnection();
  }

  private resizeTerminal(height = this.terminalHeight): void {
    const available = this.root.clientHeight - (this.notice.hidden ? 0 : this.notice.offsetHeight) - 8;
    if (available <= 0) return;
    const fileControls = this.panel.querySelector<HTMLElement>('.file-toolbar')!.offsetHeight
      + this.panel.querySelector<HTMLElement>('.file-statusbar')!.offsetHeight;
    const max = Math.max(64, available - fileControls - 84);
    const min = Math.min(180, available * .28, max);
    const desired = height ?? available * .35;
    const actual = Math.round(Math.max(min, Math.min(max, desired)));
    this.root.style.setProperty('--sftp-terminal-height', `${actual}px`);
    this.divider.setAttribute('aria-valuemin', String(Math.round(min)));
    this.divider.setAttribute('aria-valuemax', String(Math.round(max)));
    this.divider.setAttribute('aria-valuenow', String(actual));
    this.actions.fitTerminal();
  }

  private bindResize(): void {
    let drag: { pointer: number; y: number; height: number } | undefined;
    this.divider.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { pointer: event.pointerId, y: event.clientY, height: this.terminalPane.offsetHeight };
      this.divider.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.divider.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      this.resizeTerminal(drag.height + drag.y - event.clientY);
      this.terminalHeight = Number(this.divider.getAttribute('aria-valuenow'));
    });
    this.divider.addEventListener('lostpointercapture', () => { drag = undefined; });
    this.divider.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const height = event.key === 'Home' ? Number(this.divider.getAttribute('aria-valuemin'))
        : event.key === 'End' ? Number(this.divider.getAttribute('aria-valuemax'))
          : this.terminalPane.offsetHeight + (event.key === 'ArrowUp' ? 20 : -20);
      this.resizeTerminal(height);
      this.terminalHeight = Number(this.divider.getAttribute('aria-valuenow'));
    });
  }
}
