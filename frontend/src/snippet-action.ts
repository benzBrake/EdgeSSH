export type SnippetTarget = 'terminal' | 'editor';

export function resolveSnippetTarget(command: string, editorOpen: boolean, collapsedAction: SnippetTarget): SnippetTarget {
  return !editorOpen && collapsedAction === 'terminal' && !/[\r\n]/.test(command) ? 'terminal' : 'editor';
}

export function snippetActionLabel(target: SnippetTarget): string {
  const english = document.documentElement.lang === 'en';
  return target === 'terminal' ? english ? 'Insert into terminal' : '插入终端'
    : english ? 'Insert into editor' : '插入编辑器';
}
