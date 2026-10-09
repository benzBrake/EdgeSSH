import { createElement, Copy, Pencil, Plus, RefreshCw, Trash2, type IconNode } from 'lucide';
import { SnippetStore, type Snippet } from './snippet-store';
import { SnippetEditor } from './snippet-editor';
import { snippetActionLabel, type SnippetTarget } from './snippet-action';

const localize = (zh: string, en: string) => document.documentElement.lang === 'en' ? en : zh;

type SnippetListOptions = {
  compact?: boolean;
} & ({ use(snippet: Snippet): void; target(snippet: Snippet): SnippetTarget }
  | { use?: never; target?: never });

export class SnippetList {
  readonly root = document.createElement('div');
  private readonly search: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;

  constructor(private readonly store: SnippetStore, private readonly editor: SnippetEditor, private readonly options: SnippetListOptions = {}) {
    this.root.className = `snippet-library${options.compact ? ' compact' : ''}`;
    this.root.innerHTML = `<div class="snippet-toolbar">
      <label class="snippet-search"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></span><input type="search" aria-label="搜索代码片段" placeholder="搜索名称或命令"></label>
      <button type="button" class="snippet-primary" data-new>＋ 新建片段</button>
      <button type="button" data-refresh aria-label="刷新代码片段" title="刷新代码片段">↻</button>
    </div><p class="snippet-status" role="status"></p><div class="snippet-list"></div>`;
    this.search = this.root.querySelector('input')!;
    this.list = this.root.querySelector('.snippet-list')!;
    this.status = this.root.querySelector('.snippet-status')!;
    for (const [selector, icon] of [['[data-new]', Plus], ['[data-refresh]', RefreshCw]] as const) {
      this.root.querySelector<HTMLButtonElement>(selector)!.replaceChildren(createElement(icon, { 'aria-hidden': 'true' }));
    }
    this.search.addEventListener('input', () => this.render());
    this.root.querySelector('[data-new]')!.addEventListener('click', () => editor.open(undefined, !options.compact));
    this.root.querySelector('[data-refresh]')!.addEventListener('click', () => void store.load(true));
    store.addEventListener('change', () => this.render());
    this.render();
  }

  private action(label: string, title: string, callback: (button: HTMLButtonElement) => void, icon?: IconNode): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = label; button.title = title; button.setAttribute('aria-label', title);
    if (icon) button.replaceChildren(createElement(icon, { 'aria-hidden': 'true' }));
    button.addEventListener('click', () => callback(button));
    return button;
  }

  private render(): void {
    const active = document.activeElement as HTMLElement | null;
    const focusedRow = active?.closest<HTMLElement>('.snippet-card');
    const focusedId = focusedRow && this.list.contains(focusedRow) ? focusedRow.dataset.snippetId : undefined;
    const focusedAction = focusedId ? [...focusedRow!.querySelectorAll('button')].indexOf(active as HTMLButtonElement) : -1;
    const scrollContainer = this.root.closest<HTMLElement>('#snippet-panel-body');
    const scrollTop = scrollContainer?.scrollTop;
    this.refreshToolbar();
    const query = this.search.value.trim().toLowerCase();
    const items = this.store.items.filter((item) => `${item.name}\n${item.command}`.toLowerCase().includes(query));
    this.status.textContent = this.store.loading ? localize('正在加载片段…', 'Loading snippets…') : this.store.error || localize(`${items.length} 条片段 · 云端加密保存`, `${items.length} snippets · Encrypted cloud storage`);
    this.root.querySelector<HTMLButtonElement>('[data-new]')!.disabled = !this.store.loaded;
    this.root.querySelector<HTMLButtonElement>('[data-refresh]')!.disabled = this.store.loading;
    this.list.replaceChildren();
    if (!items.length && this.store.loaded) {
      const empty = document.createElement('div'); empty.className = 'snippet-empty';
      empty.innerHTML = '<span class="snippet-symbol" aria-hidden="true">{ }</span><strong></strong><p></p>';
      empty.querySelector('strong')!.textContent = query ? localize('没有匹配的片段', 'No matching snippets') : localize('把常用命令留在手边', 'Keep common commands handy');
      empty.querySelector('p')!.textContent = query ? localize('试试其他名称或命令。', 'Try another name or command.') : localize('新建一个片段，下次连接时直接使用。', 'Create a snippet for your next connection.');
      this.list.append(empty);
    }
    for (const snippet of items) {
      const row = document.createElement('article'); row.className = 'snippet-card';
      row.dataset.snippetId = snippet.id;
      const name = document.createElement('h3'); name.textContent = snippet.name;
      const command = document.createElement('pre'); command.textContent = snippet.command;
      command.title = snippet.command;
      const actions = document.createElement('div'); actions.className = 'snippet-actions';
      if (this.options.use) {
        const label = snippetActionLabel(this.options.target(snippet));
        const use = this.action(label, `${label} ${snippet.name}`, () => this.options.use!(snippet));
        use.className = 'snippet-use'; actions.append(use);
      }
      actions.append(this.action('复制', `${localize('复制', 'Copy')} ${snippet.name}`, async () => {
        try { await navigator.clipboard.writeText(snippet.command); this.status.textContent = localize('命令已复制。', 'Command copied.'); }
        catch { this.status.textContent = localize('无法访问剪贴板，请选中命令手动复制。', 'Cannot access the clipboard. Select the command to copy it manually.'); }
      }, Copy));
      actions.append(this.action('编辑', `${localize('编辑', 'Edit')} ${snippet.name}`, () => this.editor.open(snippet, !this.options.compact), Pencil));
      const remove = this.action('删除', `${localize('删除', 'Delete')} ${snippet.name}`, async (button) => {
        if (!confirm(localize(`删除片段「${snippet.name}」？删除后不会自动恢复。`, `Delete snippet “${snippet.name}”? This cannot be undone.`))) return;
        button.disabled = true;
        try { await this.store.remove(snippet.id); }
        catch (error) { this.status.textContent = error instanceof Error ? error.message : '删除失败，请重试。'; button.disabled = false; }
      }, Trash2);
      remove.className = 'snippet-delete'; actions.append(remove);
      row.append(name, command, actions); this.list.append(row);
    }
    if (focusedId && focusedAction >= 0) {
      const row = [...this.list.querySelectorAll<HTMLElement>('.snippet-card')].find((item) => item.dataset.snippetId === focusedId);
      row?.querySelectorAll<HTMLButtonElement>('button')[focusedAction]?.focus({ preventScroll: true });
    }
    if (scrollContainer && scrollTop !== undefined) scrollContainer.scrollTop = scrollTop;
  }

  refreshActions(): void {
    if (!this.options.target) return;
    for (const row of this.list.querySelectorAll<HTMLElement>('.snippet-card')) {
      const snippet = this.store.items.find((item) => item.id === row.dataset.snippetId);
      const button = row.querySelector<HTMLButtonElement>('.snippet-use');
      if (!snippet || !button) continue;
      const label = snippetActionLabel(this.options.target(snippet));
      button.textContent = label; button.title = `${label} ${snippet.name}`;
      button.setAttribute('aria-label', button.title);
    }
  }

  refreshLanguage(): void { this.render(); }

  private refreshToolbar(): void {
    this.search.setAttribute('aria-label', localize('搜索代码片段', 'Search snippets'));
    this.search.placeholder = localize('搜索名称或命令', 'Search names or commands');
    for (const [selector, label] of [
      ['[data-new]', localize('新建片段', 'New snippet')], ['[data-refresh]', localize('刷新代码片段', 'Refresh snippets')],
    ] as const) {
      const button = this.root.querySelector<HTMLButtonElement>(selector)!;
      button.title = label; button.setAttribute('aria-label', label);
      if (selector === '[data-new]' && !this.options.compact) {
        const icon = button.querySelector('svg')!;
        button.replaceChildren(icon, label);
      }
    }
  }
}
