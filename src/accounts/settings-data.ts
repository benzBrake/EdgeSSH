export interface SessionTabBarSettings {
  showSettings: boolean;
  showThemeToggle: boolean;
  showLanguageToggle: boolean;
  showSourceLink: boolean;
}

export interface WorkspaceSettings {
  fontSize: number;
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  sshEditorDefaultOpen: boolean;
  collapsedSnippetAction: 'terminal' | 'editor';
  sessionTabBar: SessionTabBarSettings;
}

export interface SettingsSnapshot {
  settings: WorkspaceSettings;
  revision: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Readonly<WorkspaceSettings> = Object.freeze({
  fontSize: 13,
  cursorStyle: 'block',
  cursorBlink: true,
  sshEditorDefaultOpen: true,
  collapsedSnippetAction: 'editor',
  sessionTabBar: Object.freeze({ showSettings: true, showThemeToggle: true, showLanguageToggle: true, showSourceLink: true }),
});

export function validateSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效。');
  const fields = value as Record<string, unknown>;
  const required = ['fontSize', 'cursorStyle', 'cursorBlink', 'sshEditorDefaultOpen', 'collapsedSnippetAction'];
  if (required.some((key) => !Object.hasOwn(fields, key)) || Object.keys(fields).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key))) {
    throw new Error('设置字段无效。');
  }
  if (!Number.isInteger(fields.fontSize) || Number(fields.fontSize) < 10 || Number(fields.fontSize) > 24) {
    throw new Error('终端字号必须是 10–24 之间的整数。');
  }
  if (!['block', 'bar', 'underline'].includes(fields.cursorStyle as string)) throw new Error('光标形状无效。');
  if (typeof fields.cursorBlink !== 'boolean' || typeof fields.sshEditorDefaultOpen !== 'boolean') throw new Error('开关设置必须是布尔值。');
  if (fields.collapsedSnippetAction !== 'terminal' && fields.collapsedSnippetAction !== 'editor') throw new Error('片段点击行为无效。');
  // 旧版保存的设置没有标签栏分区；仅为这个新增分区补齐默认值。
  const tabBar = Object.hasOwn(fields, 'sessionTabBar') ? fields.sessionTabBar : DEFAULT_SETTINGS.sessionTabBar;
  if (!tabBar || typeof tabBar !== 'object' || Array.isArray(tabBar)) throw new Error('会话标签栏设置格式无效。');
  const buttons = tabBar as Record<string, unknown>;
  if (Object.keys(buttons).length !== 4 || Object.keys(buttons).some((key) => !Object.hasOwn(DEFAULT_SETTINGS.sessionTabBar, key))) {
    throw new Error('会话标签栏设置字段无效。');
  }
  if (Object.values(buttons).some((value) => typeof value !== 'boolean')) throw new Error('会话标签栏开关必须是布尔值。');
  return { fontSize: fields.fontSize as number, cursorStyle: fields.cursorStyle as WorkspaceSettings['cursorStyle'],
    cursorBlink: fields.cursorBlink, sshEditorDefaultOpen: fields.sshEditorDefaultOpen, collapsedSnippetAction: fields.collapsedSnippetAction,
    sessionTabBar: { showSettings: buttons.showSettings as boolean, showThemeToggle: buttons.showThemeToggle as boolean,
      showLanguageToggle: buttons.showLanguageToggle as boolean, showSourceLink: buttons.showSourceLink as boolean } };
}

export function validateSettingsSnapshot(value: unknown): SettingsSnapshot {
  if (!value || typeof value !== 'object') throw new Error('设置响应格式无效。');
  const snapshot = value as SettingsSnapshot;
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || !Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < 0) throw new Error('设置版本无效。');
  return { settings: validateSettings(snapshot.settings), revision: snapshot.revision, updatedAt: snapshot.updatedAt };
}
