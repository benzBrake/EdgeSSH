import { APIError } from './cloud-api';
import { isDemoMode } from './demo-hosts';
import { SettingsStore } from './settings-store';
import { DEFAULT_SETTINGS, type SettingsSnapshot, type WorkspaceSettings } from '../../src/accounts/settings-data';
import './settings-page.css';

const text = (zh: string, en: string) => document.documentElement.lang === 'en' ? en : zh;
const translated = (zh: string, en: string) => `<span data-i18n-zh="${zh}" data-i18n-en="${en}">${text(zh, en)}</span>`;

export class SettingsPage {
  readonly root = document.createElement('section');
  private readonly form: HTMLFormElement;
  private base?: SettingsSnapshot;
  private saveError = '';
  private conflict = false;
  private saved = false;

  constructor(readonly store: SettingsStore) {
    this.root.id = 'settings-page'; this.root.className = 'settings-page'; this.root.hidden = true;
    this.root.innerHTML = `<header class="home-section-heading"><div><p class="home-eyebrow">WORKSPACE SETTINGS</p>
      <h1 tabindex="-1">${translated('设置', 'Settings')}</h1><p>${translated('在你的设备间同步终端偏好。', 'Sync terminal preferences across your devices.')}</p></div></header>
      <p class="settings-demo" ${isDemoMode() ? '' : 'hidden'}>${translated('演示模式：设置只保存在本页内存，不会同步到数据库。', 'Demo mode: settings stay in page memory and are not synced to the database.')}</p>
      <form><fieldset disabled><legend>${translated('终端', 'Terminal')}</legend>
      <label class="settings-row"><span>${translated('终端字号', 'Terminal font size')}<small>10–24 px</small></span><input name="fontSize" type="number" min="10" max="24" step="1" required></label>
      <label class="settings-row"><span>${translated('光标形状', 'Cursor shape')}</span><select name="cursorStyle">
        <option value="block" data-i18n-zh="方块" data-i18n-en="Block">方块</option><option value="bar" data-i18n-zh="竖线" data-i18n-en="Bar">竖线</option><option value="underline" data-i18n-zh="下划线" data-i18n-en="Underline">下划线</option></select></label>
      <label class="settings-row"><span>${translated('光标闪烁', 'Blinking cursor')}</span><input name="cursorBlink" type="checkbox"></label>
      <label class="settings-row"><span>${translated('SSH 命令编辑器默认展开', 'Expand SSH command editor by default')}<small>${translated('只影响新建 SSH 工作台。', 'Applies only to new SSH workspaces.')}</small></span><input name="sshEditorDefaultOpen" type="checkbox"></label>
      <label class="settings-row"><span>${translated('编辑器收起时点击片段', 'Snippet clicks when editor is collapsed')}<small>${translated('输入终端不追加回车；多行片段仍进入编辑器。', 'Terminal input adds no Enter; multiline snippets still open in the editor.')}</small></span><select name="collapsedSnippetAction">
        <option value="editor" data-i18n-zh="展开并填入编辑器" data-i18n-en="Expand and fill editor">展开并填入编辑器</option><option value="terminal" data-i18n-zh="输入到终端" data-i18n-en="Insert into terminal">输入到终端</option></select></label>
      </fieldset><div class="settings-status" role="status" aria-live="polite"></div>
      <div class="settings-actions"><button class="home-button" type="button" data-reload>${translated('重新加载', 'Reload')}</button>
      <button class="home-button" type="button" data-defaults>${translated('恢复默认', 'Restore defaults')}</button>
      <button class="home-button" type="button" data-cancel>${translated('取消修改', 'Cancel changes')}</button>
      <button class="home-button primary" type="submit">${translated('保存', 'Save')}</button></div></form>`;
    this.form = this.root.querySelector('form')!;
    this.write(DEFAULT_SETTINGS);
    this.form.addEventListener('input', () => { this.saved = false; this.saveError = ''; this.render(); });
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.save(); });
    this.root.querySelector('[data-defaults]')!.addEventListener('click', () => { this.write(DEFAULT_SETTINGS); this.saved = false; this.saveError = ''; this.render(); });
    this.root.querySelector('[data-cancel]')!.addEventListener('click', () => {
      this.base = store.snapshot;
      if (this.base) this.write(this.base.settings);
      this.saved = false; this.saveError = ''; this.conflict = false; this.render();
    });
    this.root.querySelector('[data-reload]')!.addEventListener('click', () => void this.reload());
    store.addEventListener('change', () => {
      if (!store.snapshot) { this.base = undefined; this.conflict = false; this.saved = false; this.saveError = ''; this.write(DEFAULT_SETTINGS); }
      else if (!this.dirty && !store.saving) {
        if (this.base?.revision !== store.snapshot.revision) { this.saved = false; this.saveError = ''; }
        this.base = store.snapshot; this.write(this.base.settings);
      }
      this.render();
    });
    window.addEventListener('beforeunload', (event) => {
      if (this.dirty || store.saving) { event.preventDefault(); event.returnValue = ''; }
    });
    this.refreshLanguage(); this.render();
  }

  private field<T extends HTMLInputElement | HTMLSelectElement>(name: string): T { return this.form.elements.namedItem(name) as T; }
  private read(): WorkspaceSettings {
    return { fontSize: Number(this.field('fontSize').value), cursorStyle: this.field('cursorStyle').value as WorkspaceSettings['cursorStyle'],
      cursorBlink: this.field<HTMLInputElement>('cursorBlink').checked, sshEditorDefaultOpen: this.field<HTMLInputElement>('sshEditorDefaultOpen').checked,
      collapsedSnippetAction: this.field('collapsedSnippetAction').value as WorkspaceSettings['collapsedSnippetAction'] };
  }
  private write(settings: Readonly<WorkspaceSettings>): void {
    this.field('fontSize').value = String(settings.fontSize); this.field('cursorStyle').value = settings.cursorStyle;
    this.field<HTMLInputElement>('cursorBlink').checked = settings.cursorBlink;
    this.field<HTMLInputElement>('sshEditorDefaultOpen').checked = settings.sshEditorDefaultOpen;
    this.field('collapsedSnippetAction').value = settings.collapsedSnippetAction;
  }
  get dirty(): boolean { return !!this.base && JSON.stringify(this.read()) !== JSON.stringify(this.base.settings); }
  canLeave(): boolean {
    if (this.store.saving) return false;
    if (!this.dirty) return true;
    if (!confirm(text('放弃未保存的设置修改？', 'Discard unsaved settings changes?'))) return false;
    this.base = this.store.snapshot; if (this.base) this.write(this.base.settings);
    this.saveError = ''; this.conflict = false; this.saved = false; this.render(); return true;
  }
  show(): void { this.root.hidden = false; this.refreshLanguage(); this.root.querySelector<HTMLElement>('h1')!.focus(); void this.store.load(); }
  hide(): void { this.root.hidden = true; }
  refreshLanguage(): void {
    this.root.querySelectorAll<HTMLElement>('[data-i18n-zh]').forEach((node) => { node.textContent = text(node.dataset.i18nZh!, node.dataset.i18nEn!); });
    this.render();
  }
  private async reload(): Promise<void> {
    const dirty = this.dirty;
    await this.store.load();
    if (this.store.error || !this.store.snapshot) return;
    const keepDraft = dirty || this.dirty;
    this.base = this.store.snapshot;
    if (!keepDraft) this.write(this.base.settings);
    this.conflict = false; this.saveError = ''; this.saved = false; this.render();
  }
  private async save(): Promise<void> {
    if (!this.base || this.conflict || this.store.saving || !this.form.reportValidity()) return;
    this.saveError = ''; this.saved = false;
    try {
      await this.store.save(this.read(), this.base.revision);
      this.base = this.store.snapshot; if (this.base) this.write(this.base.settings);
      this.saved = true;
    } catch (error) {
      this.conflict = error instanceof APIError && error.status === 409;
      this.saveError = error instanceof Error ? error.message : text('保存失败，请重试。', 'Saving failed. Please retry.');
    }
    this.render();
  }
  private render(): void {
    const { store } = this;
    const remoteChanged = !!this.base && !!store.snapshot && this.base.revision !== store.snapshot.revision;
    this.form.querySelector('fieldset')!.disabled = !this.base || store.saving;
    this.form.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled = !this.base || !this.dirty || store.loading || store.saving || this.conflict || remoteChanged;
    for (const selector of ['[data-defaults]', '[data-cancel]']) this.root.querySelector<HTMLButtonElement>(selector)!.disabled = !this.base || store.saving;
    this.root.querySelector<HTMLButtonElement>('[data-reload]')!.disabled = store.loading || store.saving;
    const status = this.root.querySelector<HTMLElement>('[role="status"]')!;
    status.textContent = store.saving ? text('保存中…', 'Saving…') : store.loading ? text('正在同步设置…', 'Syncing settings…')
      : this.saveError || store.error || (remoteChanged || this.conflict ? text('其他设备已更新设置。重新加载会保留当前修改，再点击保存。', 'Settings changed on another device. Reload to keep your edits, then save again.')
      : this.saved ? text('已保存', 'Saved') : this.dirty ? text('有未保存的修改', 'Unsaved changes') : this.base ? text('设置已同步', 'Settings synced') : text('尚未加载设置，请重试。', 'Settings have not loaded. Please retry.'));
    status.classList.toggle('is-error', !!(this.saveError || store.error || remoteChanged || this.conflict));
  }
}
