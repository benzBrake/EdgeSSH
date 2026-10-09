import { createElement, Terminal } from 'lucide';
import { SnippetStore, type Snippet } from './snippet-store';
import { SnippetEditor } from './snippet-editor';
import { SnippetList } from './snippet-list';
import { SnippetPanel } from './snippet-panel';
import './snippets.css';
import './snippet-page.css';

export class Snippets {
  readonly page = document.createElement('section');
  private readonly store = new SnippetStore();
  private readonly panel: SnippetPanel;

  constructor(container: HTMLElement, use: (snippet: Snippet) => boolean, openTerminal: () => void, openLibrary: () => void, initiallyCollapsed: boolean | undefined, reportError: (message: string) => void) {
    const editor = new SnippetEditor(this.store);
    this.page.id = 'snippets-page';
    this.page.className = 'snippet-page';
    this.page.hidden = true;
    this.page.setAttribute('aria-labelledby', 'snippets-heading');
    this.page.innerHTML = `<header class="snippet-page-heading"><span class="snippet-symbol" aria-hidden="true">{ }</span>
      <div><p>YOUR COMMAND LIBRARY</p><h1 id="snippets-heading" tabindex="-1">代码片段</h1>
      <p>把常用命令留在手边，不必每次从头输入。</p></div>
      <button type="button" class="snippet-open-terminal" aria-label="返回终端" title="返回终端"
        data-i18n-aria-label-zh="返回终端" data-i18n-aria-label-en="Back to terminal"
        data-i18n-title-zh="返回终端" data-i18n-title-en="Back to terminal"></button></header>`;
    const back = this.page.querySelector<HTMLButtonElement>('.snippet-open-terminal')!;
    back.append(createElement(Terminal, { 'aria-hidden': 'true' }));
    back.addEventListener('click', openTerminal);
    this.page.append(new SnippetList(this.store, editor).root);
    this.panel = new SnippetPanel(container, this.store, editor, use, openLibrary, initiallyCollapsed, reportError);
  }

  show(fromTerminal = false): void {
    this.page.hidden = false; void this.store.load(true);
    this.page.querySelector<HTMLButtonElement>('.snippet-open-terminal')!.hidden = !fromTerminal;
    this.page.querySelector<HTMLElement>('h1')!.focus();
  }

  hide(): void { this.page.hidden = true; }
  refreshLanguage(): void { this.panel.refreshLanguage(); }
  load(): void { void this.store.load(true); }
  clear(): void { this.store.clear(); }
}
