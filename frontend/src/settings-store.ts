import { api } from './cloud-api';
import { isDemoMode } from './demo-hosts';
import { DEFAULT_SETTINGS, validateSettingsSnapshot, type SettingsSnapshot, type WorkspaceSettings } from '../../src/accounts/settings-data';

export class SettingsStore extends EventTarget {
  snapshot?: SettingsSnapshot;
  loading = false;
  saving = false;
  error = '';
  private pending?: Promise<void>;
  private generation = 0;

  constructor() {
    super();
    window.addEventListener('auth-required', () => this.clear());
  }

  private notify(): void { this.dispatchEvent(new Event('change')); }

  clear(): void {
    this.generation++;
    this.snapshot = undefined; this.loading = false; this.saving = false; this.error = ''; this.pending = undefined;
    this.notify();
  }

  accept(value: unknown): void {
    const snapshot = validateSettingsSnapshot(value);
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot; this.error = ''; this.notify();
  }

  load(): Promise<void> {
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.loading = true; this.error = ''; this.notify();
    this.pending = (async () => {
      try {
        const snapshot = await (isDemoMode() ? Promise.resolve(this.snapshot ?? { settings: { ...DEFAULT_SETTINGS }, revision: 0, updatedAt: 0 })
          : api<SettingsSnapshot>('/api/settings'));
        if (generation === this.generation) this.accept(snapshot);
      } catch (error) {
        if (generation === this.generation) this.error = error instanceof Error ? error.message : '设置加载失败，请重试。';
      } finally {
        if (generation === this.generation) { this.loading = false; this.pending = undefined; this.notify(); }
      }
    })();
    return this.pending;
  }

  async save(settings: WorkspaceSettings, revision: number): Promise<void> {
    if (this.saving) throw new Error('设置正在保存。');
    await this.pending;
    if (this.saving) throw new Error('设置正在保存。');
    if (!this.snapshot) throw new Error('请先加载设置。');
    const generation = this.generation;
    this.saving = true; this.error = ''; this.notify();
    try {
      const snapshot = isDemoMode() ? { settings: { ...settings }, revision: revision + 1, updatedAt: Date.now() }
        : await api<SettingsSnapshot>('/api/settings', 'PUT', { settings, revision });
      if (generation !== this.generation) throw new Error('登录状态已变化，请重新登录。');
      this.accept(snapshot);
    } finally {
      if (generation === this.generation) { this.saving = false; this.notify(); }
    }
  }
}
