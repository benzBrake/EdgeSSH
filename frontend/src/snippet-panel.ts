import { SnippetList } from './snippet-list';
import { SnippetEditor } from './snippet-editor';
import { SnippetStore, type Snippet } from './snippet-store';

const COLLAPSED_STORAGE_KEY = 'edgessh:snippet-panel:collapsed';
const isMobile = () => matchMedia('(max-width: 700px)').matches;
const localize = (zh: string, en: string) => document.documentElement.lang === 'en' ? en : zh;

export class SnippetPanel {
  readonly root = document.createElement('aside');
  private readonly body: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly launcher = document.createElement('button');
  private readonly menu = document.createElement('section');
  private readonly search: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly menuContainer: HTMLElement;
  private position?: { x: number; y: number };

  constructor(private readonly container: HTMLElement, private readonly store: SnippetStore, editor: SnippetEditor,
    private readonly use: (snippet: Snippet) => boolean, openLibrary: () => void, private readonly initiallyCollapsed: boolean | undefined,
    private readonly reportError: (message: string) => void) {
    this.root.id = 'snippet-panel';
    this.root.className = 'snippet-panel snippet-surface';
    this.root.setAttribute('aria-label', '代码片段浮窗');
    this.root.innerHTML = `<header class="snippet-panel-heading">
      <button class="snippet-drag" type="button" aria-label="移动代码片段窗口" title="拖动移动，也可用方向键移动、Home 键复位">
        <span class="snippet-symbol" aria-hidden="true">{ }</span><strong>代码片段</strong><span class="snippet-grip" aria-hidden="true">⠿</span>
      </button><button class="snippet-manage" type="button" aria-label="管理代码片段" title="管理代码片段"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 1 0-2 3.46l.15.08a2 2 0 0 1 1 1.73v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 1 0 2 3.46l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 1 0 2-3.46l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 1 0-2-3.46l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <button class="snippet-collapse" type="button" aria-controls="snippet-panel-body"></button>
    </header><div id="snippet-panel-body"><p class="snippet-panel-hint">常用命令，一次保存，随时取用。</p></div>`;
    this.body = this.root.querySelector('#snippet-panel-body')!;
    this.toggle = this.root.querySelector('.snippet-collapse')!;
    this.body.append(new SnippetList(store, editor, { compact: true, use: (snippet) => {
      if (use(snippet) && isMobile()) this.setCollapsed(true);
    } }).root);
    container.append(this.root);
    const editorToggle = document.getElementById('command-editor-toggle');
    if (!editorToggle) throw new Error('Missing terminal tools element #command-editor-toggle');
    this.launcher.id = 'snippet-menu-toggle';
    this.launcher.className = 'snippet-menu-toggle';
    this.launcher.type = 'button';
    this.launcher.setAttribute('aria-haspopup', 'dialog');
    this.launcher.setAttribute('aria-controls', 'snippet-quick-menu');
    this.launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H7a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h2m6-18h2a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-2"/></svg><span></span>';
    editorToggle.before(this.launcher);
    // SFTP 的浮窗仍依附输出区，快捷菜单则依附包含工具栏的完整工作台。
    this.menuContainer = container.closest<HTMLElement>('.terminal-card') ?? container;
    this.menu.id = 'snippet-quick-menu';
    this.menu.className = 'snippet-quick-menu snippet-surface';
    this.menu.setAttribute('role', 'dialog');
    this.menu.hidden = true;
    this.menu.innerHTML = `<label class="snippet-search"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></span><input type="search"></label>
      <p class="snippet-status" role="status"></p><button type="button" data-retry hidden></button>
      <div class="snippet-quick-list"></div><footer class="snippet-quick-actions">
      <button type="button" data-expand></button><button type="button" data-manage></button></footer>`;
    this.search = this.menu.querySelector('input')!;
    this.list = this.menu.querySelector('.snippet-quick-list')!;
    this.status = this.menu.querySelector('.snippet-status')!;
    this.menuContainer.append(this.menu);
    this.launcher.addEventListener('click', () => this.setMenuOpen(this.menu.hidden));
    this.search.addEventListener('input', () => this.renderMenu());
    this.menu.querySelector('[data-retry]')!.addEventListener('click', () => void store.load(true));
    this.menu.querySelector('[data-expand]')!.addEventListener('click', () => {
      this.setCollapsed(false, true);
      this.root.querySelector<HTMLButtonElement>('.snippet-drag')!.focus();
    });
    this.menu.querySelector('[data-manage]')!.addEventListener('click', () => { this.setMenuOpen(false); openLibrary(); });
    this.toggle.addEventListener('click', () => {
      this.setCollapsed(true, true);
      this.launcher.focus();
    });
    this.root.querySelector('.snippet-manage')!.addEventListener('click', openLibrary);
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node) && !this.launcher.contains(event.target as Node)) this.setMenuOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.menu.hidden) return;
      event.preventDefault();
      this.setMenuOpen(false);
      this.launcher.focus();
    });
    store.addEventListener('change', () => {
      if (!store.loaded && !store.loading && !store.error) { this.setMenuOpen(false); this.search.value = ''; }
      this.renderMenu();
    });
    this.setCollapsed(this.readCollapsed());
    this.refreshLanguage();
    this.bindDrag();
    // 终端侧栏、全屏和横竖屏切换都会改变可用空间，保持拖动后的标题栏仍可触达。
    const observer = new ResizeObserver(() => { this.constrain(); this.positionMenu(); });
    observer.observe(container); observer.observe(this.root); observer.observe(this.menuContainer);
    observer.observe(editorToggle.parentElement!);
    observer.observe(document.getElementById('terminal-tools')!);
    document.addEventListener('fullscreenchange', () => this.positionMenu());
    window.addEventListener('resize', () => this.positionMenu());
    window.addEventListener('scroll', () => this.positionMenu(), true);
  }

  private readCollapsed(): boolean {
    if (this.initiallyCollapsed !== undefined) return this.initiallyCollapsed;
    if (isMobile()) return true;
    try { return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'; }
    catch {
      this.reportError(localize('无法读取代码片段显示偏好，本次默认展开浮窗。', 'Could not read the snippet display preference. The panel will start expanded.'));
      return false;
    }
  }

  private setCollapsed(collapsed: boolean, persist = false): void {
    this.body.hidden = collapsed;
    this.root.hidden = collapsed;
    this.launcher.hidden = !collapsed;
    this.setMenuOpen(false);
    this.toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    this.constrain();
    if (persist && this.initiallyCollapsed === undefined && !isMobile()) {
      try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed)); }
      catch { this.reportError(localize('无法保存代码片段显示偏好，本次切换仍然有效。', 'Could not save the snippet display preference. The current change still applies.')); }
    }
  }

  refreshLanguage(): void {
    this.launcher.querySelector('span')!.textContent = localize('片段', 'Snippets');
    this.launcher.title = localize('选择代码片段', 'Choose a snippet');
    this.launcher.setAttribute('aria-label', this.launcher.title);
    this.toggle.title = localize('收起代码片段', 'Minimize snippets');
    this.toggle.setAttribute('aria-label', this.toggle.title);
    this.menu.setAttribute('aria-label', localize('选择代码片段', 'Choose a snippet'));
    this.search.setAttribute('aria-label', localize('搜索代码片段', 'Search snippets'));
    this.search.placeholder = localize('搜索名称或命令', 'Search names or commands');
    this.menu.querySelector('[data-expand]')!.textContent = localize('展开浮窗', 'Expand panel');
    this.menu.querySelector('[data-manage]')!.textContent = localize('管理代码片段', 'Manage snippets');
    this.menu.querySelector('[data-retry]')!.textContent = localize('重新加载', 'Retry loading');
    this.renderMenu();
  }

  private setMenuOpen(open: boolean): void {
    this.menu.hidden = !open;
    this.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      this.renderMenu();
      this.search.focus();
      if (!this.store.loaded && !this.store.loading && !this.store.error) void this.store.load();
    }
  }

  private renderMenu(): void {
    const query = this.search.value.trim().toLowerCase();
    const items = this.store.items.filter((item) => `${item.name}\n${item.command}`.toLowerCase().includes(query));
    this.status.textContent = this.store.loading ? localize('正在加载片段…', 'Loading snippets…')
      : this.store.error || (!this.store.loaded ? '' : items.length ? localize(`${items.length} 条片段`, `${items.length} snippets`)
        : query ? localize('没有匹配的片段', 'No matching snippets') : localize('暂无代码片段，可前往管理页新建。', 'No snippets yet. Create one in the library.'));
    this.menu.querySelector<HTMLButtonElement>('[data-retry]')!.hidden = !this.store.error || this.store.loading;
    this.list.replaceChildren();
    for (const snippet of items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'snippet-quick-item';
      button.setAttribute('aria-label', localize(`使用 ${snippet.name}`, `Use ${snippet.name}`));
      const name = document.createElement('strong'); name.textContent = snippet.name;
      const command = document.createElement('pre'); command.textContent = snippet.command; command.title = snippet.command;
      button.append(name, command);
      button.addEventListener('click', () => { if (this.use(snippet)) this.setMenuOpen(false); });
      this.list.append(button);
    }
    this.positionMenu();
  }

  private positionMenu(): void {
    if (this.menu.hidden || !this.menuContainer.clientWidth) return;
    const container = this.menuContainer.getBoundingClientRect();
    const anchor = this.launcher.getBoundingClientRect();
    const width = Math.min(320, this.menuContainer.clientWidth - 16);
    const bottom = Math.max(8, anchor.top - container.top - this.menuContainer.clientTop - 6);
    this.menu.style.width = `${Math.max(0, width)}px`;
    this.menu.style.maxHeight = `${Math.min(360, Math.max(0, bottom - 8))}px`;
    this.menu.style.left = `${Math.max(8, Math.min(anchor.right - container.left - this.menuContainer.clientLeft - width, this.menuContainer.clientWidth - width - 8))}px`;
    this.menu.style.top = `${Math.max(8, bottom - this.menu.offsetHeight)}px`;
  }

  private move(x: number, y: number): void {
    this.position = { x, y }; this.constrain();
  }

  private constrain(): void {
    if (this.root.hidden || !this.position || !this.container.clientWidth) return;
    this.position.x = Math.max(0, Math.min(this.position.x, this.container.clientWidth - this.root.offsetWidth));
    this.position.y = Math.max(0, Math.min(this.position.y, this.container.clientHeight - this.root.offsetHeight));
    this.root.style.left = `${this.position.x}px`; this.root.style.top = `${this.position.y}px`; this.root.style.right = 'auto';
  }

  private bindDrag(): void {
    const handle = this.root.querySelector<HTMLButtonElement>('.snippet-drag')!;
    let drag: { pointer: number; x: number; y: number; left: number; top: number } | undefined;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: this.root.offsetLeft, top: this.root.offsetTop };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const x = event.clientX - drag.x; const y = event.clientY - drag.y;
      if (Math.abs(x) + Math.abs(y) < 4) return;
      this.move(drag.left + x, drag.top + y);
    });
    handle.addEventListener('lostpointercapture', () => { drag = undefined; });
    handle.addEventListener('keydown', (event) => {
      const moves: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
      if (event.key === 'Home') {
        event.preventDefault(); this.position = undefined;
        this.root.style.left = ''; this.root.style.top = ''; this.root.style.right = '';
      } else if (moves[event.key]) {
        event.preventDefault();
        const [x, y] = moves[event.key];
        this.move(this.root.offsetLeft + x, this.root.offsetTop + y);
      }
    });
  }
}
