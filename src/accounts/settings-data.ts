export interface WorkspaceSettings {
  fontSize: number;
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  sshEditorDefaultOpen: boolean;
  collapsedSnippetAction: 'terminal' | 'editor';
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
});

export function validateSettings(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效。');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 5 || Object.keys(fields).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key))) {
    throw new Error('设置字段无效。');
  }
  if (!Number.isInteger(fields.fontSize) || Number(fields.fontSize) < 10 || Number(fields.fontSize) > 24) {
    throw new Error('终端字号必须是 10–24 之间的整数。');
  }
  if (!['block', 'bar', 'underline'].includes(fields.cursorStyle as string)) throw new Error('光标形状无效。');
  if (typeof fields.cursorBlink !== 'boolean' || typeof fields.sshEditorDefaultOpen !== 'boolean') throw new Error('开关设置必须是布尔值。');
  if (fields.collapsedSnippetAction !== 'terminal' && fields.collapsedSnippetAction !== 'editor') throw new Error('片段点击行为无效。');
  return { fontSize: fields.fontSize as number, cursorStyle: fields.cursorStyle as WorkspaceSettings['cursorStyle'],
    cursorBlink: fields.cursorBlink, sshEditorDefaultOpen: fields.sshEditorDefaultOpen, collapsedSnippetAction: fields.collapsedSnippetAction };
}

export function validateSettingsSnapshot(value: unknown): SettingsSnapshot {
  if (!value || typeof value !== 'object') throw new Error('设置响应格式无效。');
  const snapshot = value as SettingsSnapshot;
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || !Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < 0) throw new Error('设置版本无效。');
  return { settings: validateSettings(snapshot.settings), revision: snapshot.revision, updatedAt: snapshot.updatedAt };
}
