import type { FileListView } from './file-list-view';

export const MAX_SFTP_FILE_SIZE = 64 * 1024 * 1024;
export const MAX_TEXT_FILE_SIZE = 1024 * 1024;
export const SFTP_UPLOAD_CHUNK_SIZE = 64 * 1024;

export interface FileManagerElements {
  panel: HTMLElement;
  path: HTMLInputElement;
  back: HTMLButtonElement;
  up: HTMLButtonElement;
  home: HTMLButtonElement;
  refresh: HTMLButtonElement;
  upload: HTMLButtonElement;
  download: HTMLButtonElement;
  more: HTMLButtonElement;
  newFile: HTMLButtonElement;
  filter: HTMLInputElement;
  mkdir: HTMLButtonElement;
  rename: HTMLButtonElement;
  delete: HTMLButtonElement;
  uploadInput: HTMLInputElement;
  tableBody: HTMLTableSectionElement;
  loading: HTMLElement;
  empty: HTMLElement;
  error: HTMLElement;
  status: HTMLElement;
  progress: HTMLElement;
  progressLabel: HTMLElement;
  progressBar: HTMLProgressElement;
  progressCancel: HTMLButtonElement;
  editor: HTMLDialogElement;
  editorName: HTMLElement;
  editorState: HTMLElement;
  editorText: HTMLTextAreaElement;
  editorMessage: HTMLElement;
  editorEdit: HTMLButtonElement;
  editorSave: HTMLButtonElement;
  editorClose: HTMLButtonElement;
  contextMenu: HTMLElement;
  contextView: HTMLButtonElement;
  contextEdit: HTMLButtonElement;
}

export interface FileManagerOptions {
  elements: FileManagerElements;
  getLanguage?: () => string;
  confirm?: (message: string) => boolean | Promise<boolean>;
  prompt?: (message: string, defaultValue?: string) => string | null | Promise<string | null>;
  onError?: (message: string) => void;
  onStatus?: (message: string) => void;
}

export interface SFTPEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number | string;
  mtime: string | number;
  permissions: string | number;
  uid?: string | number;
  gid?: string | number;
  owner?: string;
  group?: string;
}

/** Listener invoked whenever the FileManager's current working directory changes. */
export type CwdChangeListener = (cwd: string) => void;
export type FileServiceState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'error';

interface LocalizedText {
  zh: string;
  en: string;
}

interface PendingRequest {
  generation: number;
  operation: string;
  path: string;
  historyMode?: 'push' | 'none' | 'index';
  historyIndex?: number;
}

interface UploadState {
  generation: number;
  requestId: string;
  file: File;
  path: string;
  sent: number;
  acknowledged: number;
  awaitingAck: boolean;
  endSent: boolean;
  readyForData: boolean;
  cancelling: boolean;
  cancelSent: boolean;
  textSave?: { path: string; sha256: string; expectedSha256?: string };
}

interface DownloadState {
  generation: number;
  requestId: string;
  path: string;
  name: string;
  expectedSize: number | null;
  received: number;
  chunks: ArrayBuffer[];
  started: boolean;
  cancelling: boolean;
  cancelSent: boolean;
  preview?: boolean;
}

interface TextDraft {
  path: string;
  name: string;
  baseline: string;
  sha256: string | null;
  bom: boolean;
  newline: 'lf' | 'crlf' | 'mixed';
  editable: boolean;
  editing: boolean;
  isNew: boolean;
  detached: boolean;
  hostKey: string | null;
}

type SocketData = string | ArrayBuffer | ArrayBufferView | Blob;
type JsonRecord = Record<string, unknown>;

const DISCONNECTED: LocalizedText = {
  zh: '连接 SSH 后即可管理文件',
  en: 'Connect to SSH to manage files',
};

const DISCONNECTED_CHANNEL: LocalizedText = {
  zh: '文件管理连接已断开',
  en: 'File management connection lost',
};

// Auto-reconnect for the file manager after an unexpected drop.
const RECONNECT_MAX_ATTEMPTS = 3;
const RECONNECT_DELAYS: readonly number[] = [1000, 2000, 4000];

function requiredElement<T extends Element>(root: ParentNode, id: string): T {
  const node = root.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`Missing file manager element #${id}`);
  return node;
}

export function collectFileManagerElements(root: ParentNode = document): FileManagerElements {
  return {
    panel: requiredElement(root, 'file-manager-panel'),
    path: requiredElement(root, 'file-manager-path'),
    back: requiredElement(root, 'file-back'),
    up: requiredElement(root, 'file-up'),
    home: requiredElement(root, 'file-home'),
    refresh: requiredElement(root, 'file-refresh'),
    upload: requiredElement(root, 'file-upload'),
    download: requiredElement(root, 'file-download'),
    more: requiredElement(root, 'file-more'),
    newFile: requiredElement(root, 'file-new'),
    filter: requiredElement(root, 'file-filter'),
    mkdir: requiredElement(root, 'file-mkdir'),
    rename: requiredElement(root, 'file-rename'),
    delete: requiredElement(root, 'file-delete'),
    uploadInput: requiredElement(root, 'file-upload-input'),
    tableBody: requiredElement(root, 'file-table-body'),
    loading: requiredElement(root, 'file-manager-loading'),
    empty: requiredElement(root, 'file-manager-empty'),
    error: requiredElement(root, 'file-manager-error'),
    status: requiredElement(root, 'file-manager-status'),
    progress: requiredElement(root, 'file-manager-progress'),
    progressLabel: requiredElement(root, 'file-manager-progress-label'),
    progressBar: requiredElement(root, 'file-manager-progress-bar'),
    progressCancel: requiredElement(root, 'file-manager-progress-cancel'),
    editor: requiredElement(root, 'file-editor'),
    editorName: requiredElement(root, 'file-editor-name'),
    editorState: requiredElement(root, 'file-editor-state'),
    editorText: requiredElement(root, 'file-editor-text'),
    editorMessage: requiredElement(root, 'file-editor-message'),
    editorEdit: requiredElement(root, 'file-editor-edit'),
    editorSave: requiredElement(root, 'file-editor-save'),
    editorClose: requiredElement(root, 'file-editor-close'),
    contextMenu: requiredElement(root, 'file-context-menu'),
    contextView: requiredElement(root, 'file-context-view'),
    contextEdit: requiredElement(root, 'file-context-edit'),
  };
}

function normalizePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0 || new TextEncoder().encode(input).length > 4096) throw new Error('Invalid path');
  if (!input.startsWith('/') || /[\0-\x1f\x7f]/.test(input)) throw new Error('Invalid path');
  return input;
}

function validateName(input: string): string {
  const name = input;
  if (!name || name === '.' || name === '..' || name.length > 255 || name.includes('/') || /[\0-\x1f\x7f]/.test(name)) {
    throw new Error('Invalid file name');
  }
  return name;
}

function joinPath(parent: string, name: string): string {
  return normalizePath(`${parent.endsWith('/') ? parent : `${parent}/`}${validateName(name)}`);
}

function parentPath(path: string): string {
  let normalized = normalizePath(path);
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized === '/') return '/';
  return normalized.slice(0, normalized.lastIndexOf('/')) || '/';
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function fileSizeValue(value: unknown): number | string | null {
  const numeric = numberValue(value);
  if (numeric !== null) return numeric;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return value.replace(/^0+(?=\d)/, '');
}

function sizeExceedsLimit(value: number | string): boolean {
  if (typeof value === 'number') return value > MAX_SFTP_FILE_SIZE;
  const limit = String(MAX_SFTP_FILE_SIZE);
  return value.length > limit.length || (value.length === limit.length && value > limit);
}

function transferSize(value: unknown): number | null {
  const size = fileSizeValue(value);
  if (size === null || sizeExceedsLimit(size)) return null;
  return typeof size === 'number' ? size : Number(size);
}

export class FileManager {
  private readonly elements: FileManagerElements;
  private readonly getLanguage: () => string;
  private readonly confirmAction: NonNullable<FileManagerOptions['confirm']>;
  private readonly promptAction: NonNullable<FileManagerOptions['prompt']>;
  private readonly onError?: FileManagerOptions['onError'];
  private readonly onStatus?: FileManagerOptions['onStatus'];
  private readonly bindings = new AbortController();

  private socket: WebSocket | null = null;
  private generation = 0;
  private requestSequence = 0;
  private ready = false;
  private cwd = '/';
  private homePath = '/';
  private history = ['/'];
  private historyIndex = 0;
  private entries: SFTPEntry[] = [];
  private selectedIndex = -1;
  private listView: FileListView | null = null;
  private pending = new Map<string, PendingRequest>();
  private activeListRequest: string | null = null;
  private uploadState: UploadState | null = null;
  private downloadState: DownloadState | null = null;
  private draft: TextDraft | null = null;
  private editorMessageCopy: LocalizedText | null = null;
  private contextMenuOrigin: HTMLElement | null = null;
  private previewForEdit = false;
  private hostKey: string | null = null;
  private truncated = false;
  private uploadConfirmationPending = false;
  private messageQueue: Promise<void> = Promise.resolve();
  private statusCopy: LocalizedText = DISCONNECTED;
  /** Auto-reconnect state: true while the SSH session is alive and we want a file channel. */
  private wantConnection = false;
  /** Last attach URL, saved for reconnection. */
  private url: string | null = null;
  /** Pending reconnect timer id, null when idle. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Current reconnect attempt count (0 = no attempt). */
  private reconnectAttempts = 0;
  /** Pending tree-view directory fetch promises, keyed by `tree-` prefixed requestId. */
  private treeLists = new Map<string, {
    resolve: (value: { path: string; entries: SFTPEntry[]; isTruncated: boolean }) => void;
    reject: (error: Error) => void;
    generation: number;
  }>();
  /** Registered cwd-change listeners, notified on every successful cwd mutation. */
  private cwdListeners = new Set<CwdChangeListener>();
  private connectionState: FileServiceState = 'idle';
  private connectionListeners = new Set<(state: FileServiceState) => void>();

  constructor(options: FileManagerOptions) {
    this.elements = options.elements;
    this.getLanguage = options.getLanguage ?? (() => document.documentElement.lang || 'zh-CN');
    this.confirmAction = options.confirm ?? ((message) => window.confirm(message));
    this.promptAction = options.prompt ?? ((message, value) => window.prompt(message, value));
    this.onError = options.onError;
    this.onStatus = options.onStatus;
    this.bindControls();
    this.renderDisconnected();
  }

  attach(url: string, hostKey = this.hostKey): void {
    this.clearReconnectTimer();
    this.reset();
    this.hostKey = hostKey;
    this.wantConnection = true;
    this.url = url;
    this.setConnectionState('connecting');
    let target: URL;
    try {
      target = new URL(url, window.location.href);
      if (target.protocol === 'http:') target.protocol = 'ws:';
      if (target.protocol === 'https:') target.protocol = 'wss:';
      const expectedProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (target.host !== window.location.host || target.protocol !== expectedProtocol || target.username || target.password) {
        throw new Error('SFTP WebSocket must use the current origin');
      }
      target.hash = '';
    } catch (error) {
      this.showError(this.localize({ zh: '文件传输地址无效。', en: 'The file transfer address is invalid.' }));
      this.setConnectionState('error');
      throw error;
    }

    const generation = this.generation;
    const socket = new WebSocket(target);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.setStatus({ zh: '正在连接文件服务…', en: 'Connecting to file service…' });

    socket.addEventListener('open', () => {
      if (!this.isCurrent(socket, generation)) return;
      if (this.reconnectAttempts > 0) {
        console.log(
          `[WS-Reconnect] ${new Date().toISOString()} | SFTP | reconnect_success | attempt=${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}`,
        );
      }
      this.reconnectAttempts = 0;
      this.init();
    });
    socket.addEventListener('message', (event: MessageEvent<SocketData>) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handleSocketData(event.data, generation))
        .catch((error: unknown) => this.showError(error instanceof Error ? error.message : String(error)));
    });
    socket.addEventListener('error', () => {
      if (this.isCurrent(socket, generation)) {
        this.showError(this.localize({ zh: '文件服务连接失败。', en: 'The file service connection failed.' }));
        this.setConnectionState('error');
      }
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (!this.isCurrent(socket, generation)) return;
      console.log(
        `[WS-Reconnect] ${new Date().toISOString()} | SFTP | disconnect | code=${event.code} | reason="${event.reason}"`,
      );
      this.socket = null;
      this.ready = false;
      if (this.draft && this.hasUnsavedDraft()) {
        this.draft.detached = true;
        if (this.uploadState?.textSave && this.uploadState.endSent) {
          this.showEditorMessage({
            zh: '连接中断，保存结果不确定。重新连接后请先核对远端文件。',
            en: 'Connection lost; the save result is unknown. Check the remote file before retrying.',
          });
        }
      }
      this.abortTransfers(false);
      this.renderEditor();
      this.pending.clear();
      this.activeListRequest = null;
      this.rejectTreeLists(new Error('SFTP connection closed'));
      if (event.code !== 1000 && event.code !== 1005) {
        // Unexpected drop. Auto-reconnect unless the user intentionally tore the session down.
        if (this.wantConnection) {
          this.scheduleReconnect();
        } else {
          this.setConnectionState('error');
          this.renderDisconnected(true, this.describeClose(event));
        }
      } else {
        this.setConnectionState('error');
        this.renderDisconnected(true, this.describeClose(event));
      }
    });
  }

  reconnect(): void {
    if (!this.url) throw new Error(this.localize({ zh: '尚未收到文件服务连接地址。', en: 'No file service connection URL has been received.' }));
    this.attach(this.url);
  }

  init(): void {
    if (!this.isSocketOpen()) return;
    this.send({ type: 'sftp_init' });
    this.setStatus({ zh: '正在初始化 SFTP…', en: 'Initializing SFTP…' });
  }

  reset(): void {
    this.hideContextMenu();
    const uncertainSave = Boolean(this.uploadState?.textSave && this.uploadState.endSent);
    this.wantConnection = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.uploadConfirmationPending = false;
    this.pending.clear();
    this.activeListRequest = null;
    this.rejectTreeLists(new Error('SFTP session reset'));
    this.abortTransfers(false);
    if (socket) {
      if (socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'sftp_close' })); } catch { /* Socket is already unusable. */ }
      }
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000, 'SFTP client reset');
    }
    this.cwd = '/';
    this.homePath = '/';
    this.history = ['/'];
    this.historyIndex = 0;
    this.entries = [];
    this.selectedIndex = -1;
    this.truncated = false;
    this.elements.filter.value = '';
    if (this.draft) {
      if (this.hasUnsavedDraft()) this.draft.detached = true;
      else this.draft = null;
    }
    if (uncertainSave) this.showEditorMessage({
      zh: '连接中断，保存结果不确定。重新连接后请先核对远端文件。',
      en: 'Connection lost; the save result is unknown. Check the remote file before retrying.',
    });
    this.renderDisconnected();
    this.renderEditor();
    this.setConnectionState('idle');
  }

  destroy(): void {
    this.reset();
    this.draft = null;
    this.renderEditor();
    this.cwdListeners.clear();
    this.connectionListeners.clear();
    this.bindings.abort();
  }

  list(path = this.cwd): string | null {
    return this.requestList(path, 'push');
  }

  navigate(path: string): void {
    try {
      this.requestList(normalizePath(path), 'push');
    } catch {
      this.showError(this.localize({ zh: '请输入有效的绝对路径。', en: 'Enter a valid absolute path.' }));
    }
  }

  back(): void {
    if (!this.ready || this.historyIndex <= 0) return;
    this.requestList(this.history[this.historyIndex - 1], 'index', this.historyIndex - 1);
  }

  up(): void {
    if (this.ready) this.requestList(parentPath(this.cwd), 'push');
  }

  home(): void {
    if (this.ready) this.requestList(this.homePath, 'push');
  }

  refresh(): void {
    if (this.ready) this.requestList(this.cwd, 'none');
  }

  setLanguage(): void {
    this.updateStatusText(this.statusCopy);
    this.renderEntries();
    this.updateProgressLanguage();
    this.renderEditor();
    if (this.editorMessageCopy) this.elements.editorMessage.textContent = this.localize(this.editorMessageCopy);
  }

  setListView(view: FileListView | null): void {
    this.listView = view;
    this.renderEntries();
  }

  selectEntry(index: number): void {
    this.selectedIndex = this.entries[index] ? index : -1;
    this.updateControls();
  }

  activateIndex(index: number): void {
    this.selectEntry(index);
    this.activateEntry(this.selectedEntry());
  }

  openEntryMenu(index: number, x: number, y: number, origin: HTMLElement): void {
    this.selectEntry(index);
    if (this.selectedEntry()?.type !== 'file') return;
    this.showContextMenu(x, y, origin);
  }

  /**
   * Fetch directory entries for the tree view **without** disturbing the
   * right-side panel (cwd, history, activeListRequest, or rendered entries).
   * Uses a `tree-` prefixed requestId so handleListResult / handleServerError
   * route the response to the tree channel instead of the normal list flow.
   */
  fetchDirectoryEntries(path: string): Promise<{ path: string; entries: SFTPEntry[]; isTruncated: boolean }> {
    if (!this.ready || !this.isSocketOpen()) {
      return Promise.reject(new Error(this.localize({ zh: 'SFTP 尚未就绪。', en: 'SFTP is not ready.' })));
    }
    let normalized: string;
    try {
      normalized = normalizePath(path);
    } catch {
      return Promise.reject(new Error(this.localize({ zh: '路径无效。', en: 'Invalid path.' })));
    }
    const requestId = `tree-${this.generation}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      this.treeLists.set(requestId, { resolve, reject, generation: this.generation });
      this.send({ type: 'sftp_list', requestId, path: normalized });
    });
  }

  /**
   * Register a listener that fires whenever the current working directory
   * changes (after a successful list navigation or sftp_ready). Returns an
   * unsubscribe function.
   */
  onCwdChange(listener: CwdChangeListener): () => void {
    this.cwdListeners.add(listener);
    return () => { this.cwdListeners.delete(listener); };
  }

  onConnectionChange(listener: (state: FileServiceState) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.connectionState);
    return () => { this.connectionListeners.delete(listener); };
  }

  hasActiveTransfer(): boolean {
    return this.hasTransfer() || this.uploadConfirmationPending;
  }

  hasUnsavedDraft(): boolean {
    return Boolean(this.draft && (this.draft.isNew || this.elements.editorText.value !== this.draft.baseline));
  }

  private setConnectionState(state: FileServiceState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const listener of this.connectionListeners) listener(state);
  }

  async upload(file: File, destination?: string,
    textSave?: { sha256: string; expectedSha256?: string }): Promise<void> {
    if (!this.ready || this.hasTransfer() || this.uploadConfirmationPending) return;
    if (file.size > MAX_SFTP_FILE_SIZE) {
      this.showError(this.localize({ zh: '文件不能超过 64 MiB。', en: 'Files cannot exceed 64 MiB.' }));
      return;
    }
    let path: string;
    try { path = normalizePath(destination ?? joinPath(this.cwd, file.name)); } catch {
      this.showError(this.localize({ zh: '上传文件名无效。', en: 'The upload file name is invalid.' }));
      return;
    }
    const existing = this.entries.find((entry) => joinPath(this.cwd, entry.name) === path);
    const generation = this.generation;
    let overwrite = textSave?.expectedSha256 !== undefined;
    if (textSave && !overwrite && existing) {
      this.showError(this.localize({ zh: '同名文件已存在，草稿未保存。', en: 'A file with this name exists; the draft was not saved.' }));
      return;
    }
    if (existing && !textSave) {
      this.uploadConfirmationPending = true;
      this.updateControls();
      try {
        overwrite = await this.confirmAction(this.localize({
          zh: `“${existing.name}”已存在。是否覆盖？此操作无法撤销。`,
          en: `“${existing.name}” already exists. Overwrite it? This cannot be undone.`,
        }));
      } catch {
        if (generation === this.generation) {
          this.showError(this.localize({ zh: '无法确认是否覆盖文件。', en: 'Could not confirm whether to overwrite the file.' }));
        }
        return;
      } finally {
        if (generation === this.generation) {
          this.uploadConfirmationPending = false;
          this.updateControls();
        }
      }
      if (!overwrite) return;
    }
    if (generation !== this.generation || !this.ready || this.hasTransfer() || !this.isSocketOpen()) return;
    const requestId = this.createRequest('upload', path);
    this.uploadState = {
      generation: this.generation,
      requestId,
      file,
      path,
      sent: 0,
      acknowledged: 0,
      awaitingAck: false,
      endSent: false,
      readyForData: false,
      cancelling: false,
      cancelSent: false,
      textSave: textSave && { path, ...textSave },
    };
    this.showProgress('upload', file.name, 0);
    this.send({ type: 'sftp_upload_start', requestId, path, size: file.size, overwrite,
      ...(textSave?.expectedSha256 ? { expectedSha256: textSave.expectedSha256, preserveMetadata: true } : {}) });
    this.updateControls();
  }

  downloadSelected(): void {
    const entry = this.selectedEntry();
    this.startDownload(entry, false);
  }

  private startDownload(entry: SFTPEntry | null, preview: boolean): void {
    if (!this.ready || !entry || entry.type !== 'file' || this.hasTransfer()) return;
    const limit = preview ? MAX_TEXT_FILE_SIZE : MAX_SFTP_FILE_SIZE;
    if (typeof entry.size === 'string' ? entry.size.length > String(limit).length || (entry.size.length === String(limit).length && entry.size > String(limit)) : entry.size > limit) {
      this.showError(this.localize(preview
        ? { zh: '文本预览不能超过 1 MiB，请使用下载。', en: 'Text preview is limited to 1 MiB; use Download.' }
        : { zh: '文件不能超过 64 MiB。', en: 'Files cannot exceed 64 MiB.' }));
      return;
    }
    const path = joinPath(this.cwd, entry.name);
    const requestId = this.createRequest('download', path);
    this.downloadState = {
      generation: this.generation,
      requestId,
      path,
      name: entry.name,
      expectedSize: transferSize(entry.size),
      received: 0,
      chunks: [],
      started: false,
      cancelling: false,
      cancelSent: false,
      preview,
    };
    this.showProgress('download', entry.name, 0);
    this.send({ type: 'sftp_download', requestId, path, ...(preview ? { maxBytes: MAX_TEXT_FILE_SIZE } : {}) });
    this.updateControls();
  }

  cancelTransfer(): void {
    this.requestTransferCancel();
  }

  async handle(data: SocketData): Promise<void> {
    await this.handleSocketData(data, this.generation);
  }

  private bindControls(): void {
    const signal = this.bindings.signal;
    this.elements.path.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.navigate(this.elements.path.value);
    }, { signal });
    this.elements.back.addEventListener('click', () => this.back(), { signal });
    this.elements.up.addEventListener('click', () => this.up(), { signal });
    this.elements.home.addEventListener('click', () => this.home(), { signal });
    this.elements.refresh.addEventListener('click', () => this.refresh(), { signal });
    this.elements.upload.addEventListener('click', () => this.elements.uploadInput.click(), { signal });
    this.elements.uploadInput.addEventListener('change', () => {
      const file = this.elements.uploadInput.files?.[0];
      this.elements.uploadInput.value = '';
      if (file) void this.upload(file);
    }, { signal });
    this.elements.download.addEventListener('click', () => this.downloadSelected(), { signal });
    this.elements.more.addEventListener('click', () => {
      const rect = this.elements.more.getBoundingClientRect();
      this.showContextMenu(rect.left, rect.bottom + 4, this.elements.more);
    }, { signal });
    this.elements.contextView.addEventListener('click', () => {
      this.hideContextMenu(true);
      void this.previewSelected(false);
    }, { signal });
    this.elements.contextEdit.addEventListener('click', () => {
      this.hideContextMenu(true);
      void this.previewSelected(true);
    }, { signal });
    this.elements.contextMenu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideContextMenu(true);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = [this.elements.contextView, this.elements.contextEdit].filter(item => !item.disabled);
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length;
        items[next].focus();
      }
    }, { signal });
    document.addEventListener('pointerdown', (event) => {
      if (!this.elements.contextMenu.contains(event.target as Node) && event.target !== this.elements.more) this.hideContextMenu();
    }, { signal });
    document.addEventListener('scroll', () => this.hideContextMenu(), { capture: true, signal });
    window.addEventListener('resize', () => this.hideContextMenu(), { signal });
    this.elements.newFile.addEventListener('click', () => void this.newTextFile(), { signal });
    this.elements.filter.addEventListener('input', () => this.applyFilter(), { signal });
    this.elements.editorEdit.addEventListener('click', () => {
      if (!this.draft?.editable) return;
      this.draft.editing = true;
      this.renderEditor();
      this.elements.editorText.focus();
    }, { signal });
    this.elements.editorText.addEventListener('input', () => this.renderEditor(), { signal });
    this.elements.editorSave.addEventListener('click', () => void this.saveText(), { signal });
    this.elements.editorClose.addEventListener('click', () => void this.closeEditor(), { signal });
    this.elements.editor.addEventListener('cancel', (event) => {
      event.preventDefault();
      void this.closeEditor();
    }, { signal });
    this.elements.progressCancel.addEventListener('click', () => this.cancelTransfer(), { signal });
    this.elements.mkdir.addEventListener('click', () => void this.createDirectory(), { signal });
    this.elements.rename.addEventListener('click', () => void this.renameSelected(), { signal });
    this.elements.delete.addEventListener('click', () => void this.deleteSelected(), { signal });
    this.elements.tableBody.addEventListener('click', (event) => {
      const target = this.rowFromEvent(event);
      if (target) this.selectRow(target, true);
    }, { signal });
    this.elements.tableBody.addEventListener('focusin', (event) => {
      const target = this.rowFromEvent(event);
      if (target) this.selectRow(target, false);
    }, { signal });
    this.elements.tableBody.addEventListener('dblclick', (event) => {
      const target = this.rowFromEvent(event);
      if (!target) return;
      const entry = this.selectRow(target, true);
      this.activateEntry(entry);
    }, { signal });
    this.elements.tableBody.addEventListener('contextmenu', (event) => {
      const row = this.rowFromEvent(event);
      if (!row) return;
      const entry = this.selectRow(row, true);
      if (entry?.type !== 'file') return;
      event.preventDefault();
      this.showContextMenu(event.clientX, event.clientY, row);
    }, { signal });
    this.elements.tableBody.addEventListener('keydown', (event) => {
      const target = this.rowFromEvent(event);
      if (!target) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.activateEntry(this.selectRow(target, false));
        return;
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const entry = this.selectRow(target, true);
        if (entry?.type === 'file') {
          const rect = target.getBoundingClientRect();
          this.showContextMenu(rect.left, rect.bottom, target);
        }
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = Array.from(this.elements.tableBody.rows).indexOf(target);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? this.visibleEntries().length - 1
          : Math.max(0, Math.min(this.visibleEntries().length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
      const nextRow = this.elements.tableBody.rows.item(next);
      if (nextRow) this.selectRow(nextRow, true);
    }, { signal });
  }

  private async handleSocketData(data: SocketData, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    if (typeof data !== 'string') {
      await this.handleBinary(data, generation);
      return;
    }
    let message: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!isRecord(parsed)) throw new Error('Invalid SFTP response');
      message = parsed;
    } catch {
      this.showError(this.localize({ zh: '文件服务返回了无效响应。', en: 'The file service returned an invalid response.' }));
      return;
    }
    const type = typeof message.type === 'string' ? message.type : '';
    if (type === 'pong') return;
    if (type === 'sftp_ready') {
      this.handleReady(message);
      return;
    }
    if (type === 'sftp_list_result') {
      this.handleListResult(message);
      return;
    }
    if (type === 'sftp_upload_ready') {
      await this.handleUploadReady(message);
      return;
    }
    if (type === 'sftp_upload_progress') {
      await this.handleUploadProgress(message);
      return;
    }
    if (type === 'sftp_upload_complete') {
      this.handleUploadComplete(message);
      return;
    }
    if (type === 'sftp_download_start') {
      this.handleDownloadStart(message);
      return;
    }
    if (type === 'sftp_download_progress') {
      this.handleDownloadProgress(message);
      return;
    }
    if (type === 'sftp_download_done') {
      await this.handleDownloadDone(message);
      return;
    }
    if (type === 'sftp_upload_cancelled' || type === 'sftp_download_cancelled') {
      this.handleTransferCancelled(message, type === 'sftp_upload_cancelled' ? 'upload' : 'download');
      return;
    }
    if (type === 'sftp_error') {
      this.handleServerError(message);
      return;
    }
    if (type === 'sftp_closed') {
      this.socket?.close(1000, 'SFTP service closed');
      return;
    }
    if (type.endsWith('_result')) this.handleMutationResult(message);
  }

  private handleReady(message: JsonRecord): void {
    if (this.ready) return;
    let cwd: string;
    try { cwd = normalizePath(typeof message.cwd === 'string' ? message.cwd : '/'); } catch { cwd = '/'; }
    this.ready = true;
    if (this.draft?.detached && this.draft.hostKey === this.hostKey) this.draft.detached = false;
    this.renderEditor();
    this.setConnectionState('ready');
    this.cwd = cwd;
    this.emitCwdChange(cwd);
    this.homePath = cwd;
    this.history = [cwd];
    this.historyIndex = 0;
    this.elements.path.value = cwd;
    this.updateControls();
    this.requestList(cwd, 'none');
  }

  private requestList(path: string, historyMode: PendingRequest['historyMode'], historyIndex?: number): string | null {
    if (!this.ready || !this.isSocketOpen()) return null;
    let normalized: string;
    try { normalized = normalizePath(path); } catch {
      this.showError(this.localize({ zh: '请输入有效的绝对路径。', en: 'Enter a valid absolute path.' }));
      return null;
    }
    if (this.activeListRequest) this.pending.delete(this.activeListRequest);
    const requestId = this.createRequest('list', normalized, { historyMode, historyIndex });
    this.activeListRequest = requestId;
    this.elements.loading.hidden = false;
    this.elements.empty.hidden = true;
    this.elements.error.hidden = true;
    this.setStatus({ zh: `正在读取 ${normalized}`, en: `Loading ${normalized}` });
    this.send({ type: 'sftp_list', requestId, path: normalized });
    return requestId;
  }

  private handleListResult(message: JsonRecord): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    // === Tree-view fetch: route to tree channel, never enter right-side rendering ===
    if (requestId.startsWith('tree-')) {
      this.resolveTreeList(message, requestId);
      return;
    }
    const pending = this.pending.get(requestId);
    if (!pending || pending.generation !== this.generation || pending.operation !== 'list') return;
    this.pending.delete(requestId);
    if (requestId !== this.activeListRequest) return;
    this.activeListRequest = null;
    let path: string;
    try { path = normalizePath(typeof message.path === 'string' ? message.path : pending.path); } catch {
      this.showError(this.localize({ zh: '文件服务返回了无效路径。', en: 'The file service returned an invalid path.' }));
      return;
    }
    if (!Array.isArray(message.entries)) {
      this.showError(this.localize({ zh: '文件服务返回了无效目录列表。', en: 'The file service returned an invalid directory listing.' }));
      return;
    }
    const entries = message.entries.map((entry) => this.parseEntry(entry)).filter((entry): entry is SFTPEntry => entry !== null);
    entries.sort((left, right) => {
      if (left.type === 'directory' && right.type !== 'directory') return -1;
      if (left.type !== 'directory' && right.type === 'directory') return 1;
      return left.name.localeCompare(right.name, this.isChinese() ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
    });
    this.cwd = path;
    this.emitCwdChange(path);
    if (pending.historyMode === 'push' && this.history[this.historyIndex] !== path) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(path);
      this.historyIndex = this.history.length - 1;
    } else if (pending.historyMode === 'index' && pending.historyIndex !== undefined) {
      this.historyIndex = pending.historyIndex;
    }
    this.entries = entries;
    this.selectedIndex = -1;
    this.truncated = message.isTruncated === true;
    if (pending.historyMode !== 'none') this.elements.filter.value = '';
    this.elements.path.value = path;
    this.elements.loading.hidden = true;
    this.elements.error.hidden = true;
    this.elements.empty.hidden = entries.length !== 0;
    this.renderEntries();
    const truncated = this.truncated;
    const filtered = this.elements.filter.value.trim() !== '';
    const visibleCount = this.visibleEntries().length;
    this.setStatus({
      zh: `${filtered ? `${visibleCount} / ` : ''}${entries.length} 个项目${truncated ? '（列表已截断）' : ''}`,
      en: `${filtered ? `${visibleCount} / ` : ''}${entries.length} item${entries.length === 1 ? '' : 's'}${truncated ? ' (list truncated)' : ''}`,
    });
    this.updateControls();
  }

  private parseEntry(value: unknown): SFTPEntry | null {
    if (!isRecord(value) || typeof value.name !== 'string') return null;
    let name: string;
    try { name = validateName(value.name); } catch { return null; }
    const rawType = typeof value.type === 'string' ? value.type.toLowerCase() : 'other';
    const type: SFTPEntry['type'] = rawType === 'dir' || rawType === 'directory'
      ? 'directory'
      : rawType === 'file' || rawType === 'regular'
        ? 'file'
        : rawType === 'link' || rawType === 'symlink'
          ? 'symlink'
          : 'other';
    return {
      name,
      type,
      size: fileSizeValue(value.size) ?? 0,
      mtime: typeof value.mtime === 'string' || typeof value.mtime === 'number' ? value.mtime : '',
      permissions: typeof value.permissions === 'string' || typeof value.permissions === 'number' ? value.permissions : '',
      uid: typeof value.uid === 'string' || typeof value.uid === 'number' ? value.uid : undefined,
      gid: typeof value.gid === 'string' || typeof value.gid === 'number' ? value.gid : undefined,
      owner: typeof value.owner === 'string' ? value.owner : undefined,
      group: typeof value.group === 'string' ? value.group : undefined,
    };
  }

  private renderEntries(): void {
    this.elements.tableBody.replaceChildren();
    const visible = this.visibleEntries();
    this.elements.empty.hidden = visible.length !== 0;
    this.elements.empty.textContent = this.elements.filter.value.trim()
      ? this.localize({ zh: '无匹配文件', en: 'No matching files' })
      : this.localize({ zh: '此目录为空', en: 'This folder is empty' });
    if (this.listView) {
      this.listView.render({
        chinese: this.isChinese(),
        selectedId: this.selectedEntry()?.name,
        items: visible.map(({ entry, index }) => ({
          id: entry.name, name: entry.name, index, entry,
          columns: [
            entry.type === 'directory' ? '' : this.formatSize(entry.size),
            this.localize(this.typeLabel(entry.type)), this.formatDate(entry.mtime),
            String(entry.permissions), entry.owner ?? String(entry.uid ?? ''),
            entry.group ?? String(entry.gid ?? ''),
          ],
        })),
      });
      return;
    }
    const fragment = document.createDocumentFragment();
    visible.forEach(({ entry, index }) => {
      const row = document.createElement('tr');
      row.dataset.index = String(index);
      row.tabIndex = index === this.rovingIndex() ? 0 : -1;
      row.setAttribute('aria-selected', String(index === this.selectedIndex));

      const nameCell = document.createElement('td');
      const nameWrap = document.createElement('span');
      nameWrap.className = 'file-name-cell';
      const icon = document.createElement('span');
      icon.className = `file-kind-icon ${entry.type}`;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = entry.type === 'directory' ? '\u25a0' : entry.type === 'symlink' ? '\u2197' : '\u25a1';
      const name = document.createElement('span');
      name.textContent = entry.name;
      nameWrap.append(icon, name);
      nameCell.append(nameWrap);
      row.append(
        nameCell,
        this.cell(entry.type === 'directory' ? '' : this.formatSize(entry.size)),
        this.localizedCell(this.typeLabel(entry.type)),
        this.cell(this.formatDate(entry.mtime)),
        this.cell(String(entry.permissions ?? '')),
        this.cell(entry.owner ?? String(entry.uid ?? '')),
        this.cell(entry.group ?? String(entry.gid ?? '')),
      );
      fragment.append(row);
    });
    this.elements.tableBody.append(fragment);
  }

  private visibleEntries(): Array<{ entry: SFTPEntry; index: number }> {
    const query = this.elements.filter.value.trim().toLocaleLowerCase();
    return this.entries.flatMap((entry, index) => entry.name.toLocaleLowerCase().includes(query) ? [{ entry, index }] : []);
  }

  private applyFilter(): void {
    if (this.selectedIndex >= 0 && !this.visibleEntries().some(item => item.index === this.selectedIndex)) {
      this.selectedIndex = -1;
    }
    this.renderEntries();
    if (this.ready) {
      const count = this.visibleEntries().length;
      const total = this.entries.length;
      this.setStatus({
        zh: `${count} / ${total} 个项目${this.truncated ? '（列表已截断）' : ''}`,
        en: `${count} / ${total} items${this.truncated ? ' (list truncated)' : ''}`,
      });
    }
    this.updateControls();
  }

  private cell(text: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text;
    cell.title = text;
    return cell;
  }

  private localizedCell(copy: LocalizedText): HTMLTableCellElement {
    const cell = this.cell(this.localize(copy));
    cell.dataset.i18nZh = copy.zh;
    cell.dataset.i18nEn = copy.en;
    return cell;
  }

  private rowFromEvent(event: Event): HTMLTableRowElement | null {
    const target = event.target instanceof Element ? event.target.closest<HTMLTableRowElement>('tr[data-index]') : null;
    if (!target || !this.elements.tableBody.contains(target)) return null;
    return target;
  }

  private selectRow(target: HTMLTableRowElement, focus: boolean): SFTPEntry | null {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index) || !this.entries[index]) return null;
    this.selectedIndex = index;
    for (const row of this.elements.tableBody.rows) {
      const selected = row === target;
      row.setAttribute('aria-selected', String(selected));
      row.tabIndex = selected ? 0 : -1;
    }
    if (focus) target.focus();
    this.updateControls();
    return this.entries[index];
  }

  private rovingIndex(): number {
    const visible = this.visibleEntries();
    if (visible.length === 0) return -1;
    return visible.some(item => item.index === this.selectedIndex) ? this.selectedIndex : visible[0].index;
  }

  private activateEntry(entry: SFTPEntry | null): void {
    if (!entry) return;
    if (entry.type === 'directory' || entry.type === 'symlink') {
      this.navigate(joinPath(this.cwd, entry.name));
    } else if (entry.type === 'file') this.downloadSelected();
  }

  private showContextMenu(x: number, y: number, origin: HTMLElement): void {
    const entry = this.selectedEntry();
    if (!entry || entry.type !== 'file') return;
    this.contextMenuOrigin = origin;
    const available = this.ready && !this.hasTransfer() && Number(entry.size) <= MAX_TEXT_FILE_SIZE;
    this.elements.contextView.disabled = !available;
    this.elements.contextEdit.disabled = !available;
    this.elements.contextMenu.hidden = false;
    this.elements.more.setAttribute('aria-expanded', 'true');
    const rect = this.elements.contextMenu.getBoundingClientRect();
    this.elements.contextMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    this.elements.contextMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    if (available) this.elements.contextView.focus();
  }

  private hideContextMenu(restoreFocus = false): void {
    if (this.elements.contextMenu.hidden) return;
    this.elements.contextMenu.hidden = true;
    this.elements.more.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.contextMenuOrigin?.focus();
    this.contextMenuOrigin = null;
  }

  private async confirmDiscardDraft(): Promise<boolean> {
    if (!this.hasUnsavedDraft()) return true;
    return this.confirmAction(this.localize({
      zh: '未保存的文本草稿将被丢弃。仍要继续吗？',
      en: 'The unsaved text draft will be discarded. Continue?',
    }));
  }

  private async previewSelected(editing: boolean): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry || entry.type !== 'file' || !this.ready || this.hasTransfer()) return;
    if (sizeExceedsLimit(entry.size) || Number(entry.size) > MAX_TEXT_FILE_SIZE) {
      this.showPreviewError(this.localize({ zh: '文本预览不能超过 1 MiB，请使用下载。', en: 'Text preview is limited to 1 MiB; use Download.' }));
      return;
    }
    const generation = this.generation;
    if (!await this.confirmDiscardDraft() || generation !== this.generation || !this.ready) return;
    this.draft = null;
    this.previewForEdit = editing;
    this.renderEditor();
    this.startDownload(entry, true);
  }

  private async newTextFile(): Promise<void> {
    const generation = this.generation;
    if (!this.ready || this.hasTransfer() || !await this.confirmDiscardDraft() || generation !== this.generation) return;
    const name = await this.promptAction(this.localize({ zh: '新文件名称', en: 'New file name' }), '');
    if (name === null || generation !== this.generation || !this.ready) return;
    let path: string;
    try { path = joinPath(this.cwd, name); } catch {
      this.showError(this.localize({ zh: '文件名无效。', en: 'Invalid file name.' }));
      return;
    }
    if (this.entries.some(entry => entry.name === name)) {
      this.showError(this.localize({ zh: '同名文件已存在。', en: 'A file with this name already exists.' }));
      return;
    }
    this.draft = { path, name, baseline: '', sha256: null, bom: false, newline: 'lf',
      editable: true, editing: true, isNew: true, detached: false, hostKey: this.hostKey };
    this.elements.editorText.value = '';
    this.showEditorMessage('');
    this.renderEditor();
    this.elements.editorText.focus();
  }

  private async closeEditor(): Promise<void> {
    const draft = this.draft;
    if (this.uploadState?.textSave || !await this.confirmDiscardDraft() || draft !== this.draft) return;
    this.draft = null;
    this.showEditorMessage('');
    this.renderEditor();
    this.elements.filter.focus();
  }

  private async saveText(): Promise<void> {
    const draft = this.draft;
    const generation = this.generation;
    if (!draft || !draft.editable || !draft.editing || draft.detached || !this.ready || this.hasTransfer()) return;
    const text = this.elements.editorText.value;
    const normalized = draft.newline === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
    if (normalized.length > MAX_TEXT_FILE_SIZE) {
      this.showEditorMessage({ zh: '文本保存不能超过 1 MiB。', en: 'Text saves are limited to 1 MiB.' });
      return;
    }
    const body = new TextEncoder().encode(normalized);
    const bytes = draft.bom ? new Uint8Array(body.length + 3) : body;
    if (draft.bom) { bytes.set([0xef, 0xbb, 0xbf]); bytes.set(body, 3); }
    if (bytes.length > MAX_TEXT_FILE_SIZE) {
      this.showEditorMessage({ zh: '文本保存不能超过 1 MiB。', en: 'Text saves are limited to 1 MiB.' });
      return;
    }
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    if (generation !== this.generation || draft !== this.draft || draft.detached || !this.ready ||
      this.elements.editorText.value !== text) return;
    this.showEditorMessage('');
    await this.upload(new File([bytes], draft.name), draft.path,
      { sha256, ...(draft.sha256 ? { expectedSha256: draft.sha256 } : {}) });
    this.renderEditor();
  }

  private renderEditor(): void {
    const draft = this.draft;
    if (draft && !this.elements.editor.open) { this.hideContextMenu(); this.elements.editor.showModal(); }
    if (!draft && this.elements.editor.open) this.elements.editor.close();
    if (!draft) return;
    this.elements.editorName.textContent = draft.path;
    this.elements.editorState.textContent = draft.detached
      ? this.localize({ zh: '连接已断开 · 草稿保留', en: 'Disconnected · draft kept' })
      : draft.isNew ? this.localize({ zh: '新文件草稿', en: 'New file draft' })
        : this.hasUnsavedDraft() ? this.localize({ zh: '未保存', en: 'Unsaved' })
          : this.localize({ zh: '已加载', en: 'Loaded' });
    this.elements.editorText.readOnly = !draft.editing;
    this.elements.editorText.disabled = Boolean(this.uploadState?.textSave);
    this.elements.editorEdit.hidden = draft.editing || !draft.editable;
    this.elements.editorSave.hidden = !draft.editable;
    this.elements.editorSave.disabled = draft.detached || !this.ready || !draft.editing ||
      !this.hasUnsavedDraft() || this.hasTransfer();
    this.elements.editorClose.disabled = Boolean(this.uploadState?.textSave);
  }

  private showEditorMessage(message: string | LocalizedText): void {
    this.editorMessageCopy = typeof message === 'string' ? null : message;
    const copy = typeof message === 'string' ? message : this.localize(message);
    this.elements.editorMessage.textContent = copy;
    this.elements.editorMessage.hidden = !copy;
  }

  private async createDirectory(): Promise<void> {
    if (!this.ready || this.hasTransfer()) return;
    const input = await this.promptAction(this.localize({ zh: '新文件夹名称', en: 'New folder name' }), '');
    if (input === null) return;
    let path: string;
    try { path = joinPath(this.cwd, input); } catch {
      this.showError(this.localize({ zh: '文件夹名称无效。', en: 'The folder name is invalid.' }));
      return;
    }
    const requestId = this.createRequest('mkdir', path);
    this.send({ type: 'sftp_mkdir', requestId, path });
    this.setStatus({ zh: '正在新建文件夹…', en: 'Creating folder…' });
  }

  private async renameSelected(): Promise<void> {
    const entry = this.selectedEntry();
    if (!this.ready || !entry || this.hasTransfer()) return;
    const input = await this.promptAction(this.localize({ zh: '输入新名称', en: 'Enter a new name' }), entry.name);
    if (input === null || input === entry.name) return;
    let newPath: string;
    try { newPath = joinPath(this.cwd, input); } catch {
      this.showError(this.localize({ zh: '文件名无效。', en: 'The file name is invalid.' }));
      return;
    }
    const oldPath = joinPath(this.cwd, entry.name);
    const requestId = this.createRequest('rename', oldPath);
    this.send({ type: 'sftp_rename', requestId, oldPath, newPath });
    this.setStatus({ zh: '正在重命名…', en: 'Renaming…' });
  }

  private async deleteSelected(): Promise<void> {
    const entry = this.selectedEntry();
    if (!this.ready || !entry || this.hasTransfer()) return;
    const confirmed = await this.confirmAction(this.localize({
      zh: `确定要删除“${entry.name}”吗？此操作无法撤销。`,
      en: `Delete “${entry.name}”? This cannot be undone.`,
    }));
    if (!confirmed) return;
    const path = joinPath(this.cwd, entry.name);
    const operation = entry.type === 'directory' ? 'rmdir' : 'delete';
    const requestId = this.createRequest(operation, path);
    this.send({ type: operation === 'rmdir' ? 'sftp_rmdir' : 'sftp_delete', requestId, path });
    this.setStatus({ zh: '正在删除…', en: 'Deleting…' });
  }

  private handleMutationResult(message: JsonRecord): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const pending = this.pending.get(requestId);
    if (!pending || pending.generation !== this.generation || !['mkdir', 'rename', 'delete', 'rmdir'].includes(pending.operation)) return;
    this.pending.delete(requestId);
    this.setStatus({ zh: '操作完成', en: 'Operation completed' });
    this.refresh();
  }

  private async handleUploadReady(message: JsonRecord): Promise<void> {
    const state = this.matchUpload(message);
    if (!state || state.sent !== 0) return;
    state.readyForData = true;
    if (state.cancelling) {
      this.sendUploadCancel(state);
      return;
    }
    await this.sendNextUploadChunk(state);
  }

  private async handleUploadProgress(message: JsonRecord): Promise<void> {
    const state = this.matchUpload(message);
    if (!state) return;
    const acknowledged = numberValue(message.loaded) ?? numberValue(message.transferred) ?? numberValue(message.received) ?? numberValue(message.bytes) ?? state.sent;
    state.acknowledged = Math.min(state.file.size, Math.max(state.acknowledged, acknowledged));
    state.awaitingAck = false;
    this.showProgress('upload', state.file.name, state.file.size === 0 ? 100 : (state.acknowledged / state.file.size) * 100);
    if (state.cancelling) {
      this.sendUploadCancel(state);
      return;
    }
    await this.sendNextUploadChunk(state);
  }

  private async sendNextUploadChunk(state: UploadState): Promise<void> {
    if (state !== this.uploadState || state.generation !== this.generation || !state.readyForData
      || state.cancelling || state.awaitingAck || state.endSent || !this.isSocketOpen()) return;
    if (state.sent >= state.file.size) {
      state.endSent = true;
      this.updateProgressLanguage();
      this.send({ type: 'sftp_upload_end', requestId: state.requestId });
      return;
    }
    const end = Math.min(state.file.size, state.sent + SFTP_UPLOAD_CHUNK_SIZE);
    const chunk = await state.file.slice(state.sent, end).arrayBuffer();
    if (state !== this.uploadState || state.generation !== this.generation || state.cancelling || !this.isSocketOpen()) return;
    this.socket!.send(chunk);
    state.sent = end;
    state.awaitingAck = true;
  }

  private handleUploadComplete(message: JsonRecord): void {
    const state = this.matchUpload(message);
    if (!state) return;
    this.pending.delete(state.requestId);
    this.uploadState = null;
    this.hideProgress();
    if (state.textSave && this.draft?.path === state.textSave.path) {
      this.draft.sha256 = state.textSave.sha256;
      this.draft.baseline = this.elements.editorText.value;
      this.draft.isNew = false;
      this.showEditorMessage('');
      this.renderEditor();
    }
    this.setStatus(state.textSave
      ? { zh: `已保存 ${state.file.name}`, en: `Saved ${state.file.name}` }
      : { zh: `已上传 ${state.file.name}`, en: `Uploaded ${state.file.name}` });
    this.updateControls();
    this.refresh();
  }

  private handleDownloadStart(message: JsonRecord): void {
    const state = this.matchDownload(message);
    if (!state) return;
    state.started = true;
    const size = numberValue(message.size);
    state.expectedSize = size;
    if (state.cancelling) {
      this.sendDownloadCancel(state);
      return;
    }
    if (state.expectedSize !== null && state.expectedSize > (state.preview ? MAX_TEXT_FILE_SIZE : MAX_SFTP_FILE_SIZE)) {
      state.cancelling = true;
      this.setStatus({ zh: '正在取消传输…', en: 'Cancelling transfer…' });
      this.updateProgressLanguage();
      this.sendDownloadCancel(state);
    }
  }

  private handleDownloadProgress(message: JsonRecord): void {
    const state = this.matchDownload(message);
    if (!state || state.cancelling) return;
    const received = numberValue(message.loaded) ?? numberValue(message.transferred) ?? numberValue(message.sent) ?? numberValue(message.bytes) ?? state.received;
    const total = numberValue(message.total) ?? numberValue(message.size) ?? state.expectedSize;
    const percent = total && total > 0 ? Math.min(100, (received / total) * 100) : 0;
    this.showProgress('download', state.name, percent);
  }

  private async handleBinary(data: Exclude<SocketData, string>, generation: number): Promise<void> {
    const state = this.downloadState;
    if (!state || state.generation !== generation || generation !== this.generation) return;
    let buffer: ArrayBuffer;
    if (data instanceof Blob) buffer = await data.arrayBuffer();
    else if (ArrayBuffer.isView(data)) buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    else buffer = data;
    if (state !== this.downloadState || state.generation !== this.generation) return;
    if (state.cancelling) return;
    if (state.received + buffer.byteLength > (state.preview ? MAX_TEXT_FILE_SIZE : MAX_SFTP_FILE_SIZE)) {
      state.cancelling = true;
      this.setStatus({ zh: '正在取消传输…', en: 'Cancelling transfer…' });
      this.updateProgressLanguage();
      this.sendDownloadCancel(state);
      return;
    }
    state.chunks.push(buffer);
    state.received += buffer.byteLength;
    const total = state.expectedSize;
    this.showProgress('download', state.name, total && total > 0 ? (state.received / total) * 100 : 0);
  }

  private async handleDownloadDone(message: JsonRecord): Promise<void> {
    const state = this.matchDownload(message);
    if (!state) return;
    if (state.cancelling) {
      this.completeCancelledTransfer(state);
      return;
    }
    const doneSize = numberValue(message.size);
    const expectedSize = doneSize ?? state.expectedSize;
    if (expectedSize !== null && state.received !== expectedSize) {
      this.failTransfer(this.localize({ zh: '下载未完成，文件大小不匹配。', en: 'The download is incomplete: file size mismatch.' }));
      return;
    }
    this.pending.delete(state.requestId);
    this.downloadState = null;
    if (state.preview) {
      const bytes = new Uint8Array(state.received);
      let offset = 0;
      for (const chunk of state.chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
      const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
        if (text.includes('\0')) throw new Error('NUL byte');
      } catch {
        this.hideProgress();
        this.showPreviewError(this.localize({ zh: '文件不是可预览的 UTF-8 文本，请使用下载。', en: 'The file is not valid UTF-8 text; use Download.' }));
        this.updateControls();
        return;
      }
      const hasCRLF = text.includes('\r\n');
      const hasBareLF = /(^|[^\r])\n/.test(text);
      const hasBareCR = /\r(?!\n)/.test(text);
      const newline: TextDraft['newline'] = hasBareCR || (hasCRLF && hasBareLF) ? 'mixed' : hasCRLF ? 'crlf' : 'lf';
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      if (state.generation !== this.generation || this.draft) return;
      const content = text.replace(/\r\n/g, '\n');
      this.draft = { path: state.path, name: state.name, baseline: content, sha256, bom, newline,
        editable: newline !== 'mixed', editing: this.previewForEdit && newline !== 'mixed', isNew: false, detached: false, hostKey: this.hostKey };
      this.elements.editorText.value = content;
      this.showEditorMessage(newline === 'mixed'
        ? { zh: '混合换行文件仅可查看，请下载后编辑。', en: 'Mixed line endings are view only; download to edit.' } : '');
      this.renderEditor();
      this.elements.editorText.focus();
    } else this.saveBlob(new Blob(state.chunks), state.name);
    this.hideProgress();
    this.setStatus(state.preview
      ? { zh: `已打开 ${state.name}`, en: `Opened ${state.name}` }
      : { zh: `已下载 ${state.name}`, en: `Downloaded ${state.name}` });
    this.updateControls();
  }

  private handleServerError(message: JsonRecord): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    // === Tree-view fetch error: route to tree channel, never enter right-side error handling ===
    if (requestId.startsWith('tree-')) {
      this.rejectTreeList(message, requestId);
      return;
    }
    const pending = requestId ? this.pending.get(requestId) : undefined;
    if (requestId && (!pending || pending.generation !== this.generation)) return;
    if (requestId) this.pending.delete(requestId);
    if (pending?.operation === 'list' && requestId !== this.activeListRequest) return;
    if (requestId === this.activeListRequest) {
      this.activeListRequest = null;
      this.elements.loading.hidden = true;
    }
    const fallback = this.localize({ zh: '文件操作失败。', en: 'The file operation failed.' });
    if (!this.ready && !requestId) this.setConnectionState('error');
    const serverMessage = typeof message.message === 'string' && message.message ? message.message : fallback;
    const transfer = requestId === this.uploadState?.requestId
      ? this.uploadState
      : requestId === this.downloadState?.requestId
        ? this.downloadState
        : null;
    if (transfer) {
      if (transfer === this.uploadState && this.uploadState?.textSave) {
        this.showEditorMessage(message.reason === 'conflict'
          ? { zh: '远端文件已变化，草稿未保存。请复制草稿后重新读取并合并。', en: 'The remote file changed. Copy your draft, then reopen and merge.' }
          : serverMessage);
      }
      this.abortTransfers(true);
      this.renderEditor();
    }
    if (transfer && 'preview' in transfer && transfer.preview) this.showPreviewError(serverMessage);
    else this.showError(serverMessage);
  }

  private showPreviewError(message: string): void {
    this.elements.error.hidden = true;
    this.elements.loading.hidden = true;
    this.elements.status.textContent = message;
    this.onError?.(message);
  }

  /** Resolve a pending tree-view fetch promise with parsed, sorted entries. */
  private resolveTreeList(message: JsonRecord, requestId: string): void {
    const entry = this.treeLists.get(requestId);
    if (!entry || entry.generation !== this.generation) return;
    this.treeLists.delete(requestId);
    let path: string;
    try { path = normalizePath(typeof message.path === 'string' ? message.path : ''); }
    catch {
      entry.reject(new Error(
        this.localize({ zh: '目录列表数据异常。', en: 'The directory listing response was malformed.' }),
        { cause: 'invalid path in tree list result' },
      ));
      return;
    }
    if (!Array.isArray(message.entries)) {
      entry.reject(new Error(
        this.localize({ zh: '目录列表数据异常。', en: 'The directory listing response was malformed.' }),
        { cause: 'invalid entries in tree list result' },
      ));
      return;
    }
    const entries = message.entries
      .map((raw) => this.parseEntry(raw))
      .filter((item): item is SFTPEntry => item !== null);
    entries.sort((left, right) => {
      if (left.type === 'directory' && right.type !== 'directory') return -1;
      if (left.type !== 'directory' && right.type === 'directory') return 1;
      return left.name.localeCompare(right.name, this.isChinese() ? 'zh-CN' : 'en', { numeric: true, sensitivity: 'base' });
    });
    entry.resolve({ path, entries, isTruncated: message.isTruncated === true });
  }

  /** Reject a single pending tree-view fetch promise with the server error message. */
  private rejectTreeList(message: JsonRecord, requestId: string): void {
    const entry = this.treeLists.get(requestId);
    if (!entry || entry.generation !== this.generation) return;
    this.treeLists.delete(requestId);
    const fallback = this.localize({ zh: '文件操作失败。', en: 'The file operation failed.' });
    const serverMessage = typeof message.message === 'string' && message.message ? message.message : fallback;
    entry.reject(new Error(serverMessage));
  }

  /** Reject all pending tree-view fetch promises (used on reset / close / destroy). */
  private rejectTreeLists(error: Error): void {
    this.treeLists.forEach((entry) => {
      entry.reject(error);
    });
    this.treeLists.clear();
  }

  /** Notify all registered cwd-change listeners. Listener errors are swallowed. */
  private emitCwdChange(cwd: string): void {
    this.cwdListeners.forEach((listener) => {
      try { listener(cwd); } catch { /* listener errors are non-fatal */ }
    });
  }

  private handleTransferCancelled(message: JsonRecord, operation: 'upload' | 'download'): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const state = operation === 'upload' ? this.uploadState : this.downloadState;
    if (!state || state.requestId !== requestId || state.generation !== this.generation || !state.cancelling) return;
    this.completeCancelledTransfer(state);
  }

  private completeCancelledTransfer(state: UploadState | DownloadState): void {
    if (state !== this.uploadState && state !== this.downloadState) return;
    this.pending.delete(state.requestId);
    this.abortTransfers(true);
    this.setStatus({ zh: '传输已取消', en: 'Transfer cancelled' });
  }

  private requestTransferCancel(): void {
    const upload = this.uploadState;
    const transfer = upload ?? this.downloadState;
    if (!transfer || transfer.cancelling || upload?.endSent) return;
    transfer.cancelling = true;
    this.setStatus({ zh: '正在取消传输…', en: 'Cancelling transfer…' });
    this.updateProgressLanguage();
    if (upload) this.sendUploadCancel(upload);
    else this.sendDownloadCancel(transfer as DownloadState);
  }

  private sendUploadCancel(state: UploadState): void {
    if (state !== this.uploadState || state.cancelSent || !state.readyForData || !this.isSocketOpen()) return;
    state.cancelSent = true;
    this.send({ type: 'sftp_upload_cancel', requestId: state.requestId });
  }

  private sendDownloadCancel(state: DownloadState): void {
    if (state !== this.downloadState || state.cancelSent || !state.started || !this.isSocketOpen()) return;
    state.cancelSent = true;
    this.send({ type: 'sftp_download_cancel', requestId: state.requestId });
  }

  private createRequest(operation: string, path: string, extra: Partial<PendingRequest> = {}): string {
    const requestId = `${this.generation}-${++this.requestSequence}`;
    this.pending.set(requestId, { generation: this.generation, operation, path, ...extra });
    return requestId;
  }

  private matchUpload(message: JsonRecord): UploadState | null {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const state = this.uploadState;
    return state && state.requestId === requestId && state.generation === this.generation ? state : null;
  }

  private matchDownload(message: JsonRecord): DownloadState | null {
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    const state = this.downloadState;
    return state && state.requestId === requestId && state.generation === this.generation ? state : null;
  }

  private send(message: JsonRecord): void {
    if (this.isSocketOpen()) this.socket!.send(JSON.stringify(message));
  }

  private isSocketOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private isCurrent(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.generation === generation;
  }

  private hasTransfer(): boolean {
    return this.uploadState !== null || this.downloadState !== null;
  }

  private selectedEntry(): SFTPEntry | null {
    return this.selectedIndex >= 0 ? this.entries[this.selectedIndex] ?? null : null;
  }

  private abortTransfers(updateControls: boolean): void {
    this.uploadState = null;
    this.downloadState = null;
    this.hideProgress();
    if (updateControls) { this.updateControls(); this.renderEditor(); }
  }

  private failTransfer(message: string): void {
    const requestId = this.uploadState?.requestId ?? this.downloadState?.requestId;
    if (requestId) this.pending.delete(requestId);
    this.abortTransfers(true);
    this.showError(message);
  }

  private updateControls(): void {
    const selected = this.selectedEntry();
    const idle = this.ready && !this.hasTransfer() && !this.uploadConfirmationPending;
    this.elements.path.disabled = !this.ready;
    this.elements.back.disabled = !this.ready || this.historyIndex <= 0;
    this.elements.up.disabled = !this.ready || this.cwd === '/';
    // 列目录失败时 cwd 仍是上次成功路径，允许用主目录按钮恢复，而不把错误页锁在原处。
    this.elements.home.disabled = !this.ready || (this.cwd === this.homePath && this.elements.error.hidden);
    this.elements.refresh.disabled = !this.ready;
    this.elements.upload.disabled = !idle;
    this.elements.mkdir.disabled = !idle;
    this.elements.newFile.disabled = !idle;
    this.elements.download.disabled = !idle || !selected || selected.type !== 'file' || sizeExceedsLimit(selected.size);
    this.elements.more.disabled = !idle || !selected || selected.type !== 'file';
    this.elements.rename.disabled = !idle || !selected;
    this.elements.delete.disabled = !idle || !selected;
  }

  private renderDisconnected(channelLost = false, detail?: LocalizedText): void {
    this.entries = [];
    this.selectedIndex = -1;
    this.renderEntries();
    this.elements.loading.hidden = true;
    this.elements.empty.hidden = true;
    this.elements.error.hidden = true;
    this.elements.path.value = '/';
    this.hideProgress();
    if (channelLost) this.setStatus(detail ?? DISCONNECTED_CHANNEL);
    else this.updateStatusText(DISCONNECTED);
    this.updateControls();
  }

  private describeClose(event: CloseEvent): LocalizedText | undefined {
    if (event.code === 1000) return undefined;
    const codeInfo = this.isChinese()
      ? `代码 ${event.code}${event.reason ? `：${event.reason}` : ''}`
      : `code ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
    const base = DISCONNECTED_CHANNEL;
    return { zh: `${base.zh}（${codeInfo}）`, en: `${base.en} (${codeInfo})` };
  }

  private showError(message: string): void {
    this.elements.loading.hidden = true;
    this.elements.empty.hidden = true;
    this.elements.error.textContent = message;
    this.elements.error.hidden = false;
    this.updateStatusText({ zh: message, en: message });
    this.onError?.(message);
    this.updateControls();
  }

  private scheduleReconnect(): void {
    if (!this.wantConnection || !this.url || this.reconnectTimer !== null) return;
    this.reconnectAttempts++;
    if (this.reconnectAttempts > RECONNECT_MAX_ATTEMPTS) {
      console.log(
        `[WS-Reconnect] ${new Date().toISOString()} | SFTP | give_up | attempt=${this.reconnectAttempts - 1}/${RECONNECT_MAX_ATTEMPTS}`,
      );
      this.reconnectAttempts = 0;
      this.renderDisconnected(true, { zh: '文件管理重连失败。', en: 'File manager reconnect failed.' });
      this.setConnectionState('error');
      return;
    }
    const delayIndex = this.reconnectAttempts - 1;
    const delay = delayIndex < RECONNECT_DELAYS.length
      ? RECONNECT_DELAYS[delayIndex]
      : RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
    console.log(
      `[WS-Reconnect] ${new Date().toISOString()} | SFTP | reconnect_attempt | attempt=${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS}`,
    );
    this.setStatus({
      zh: '文件管理连接已断开，正在重连…',
      en: 'File manager disconnected; reconnecting…',
    });
    this.setConnectionState('reconnecting');
    const attempts = this.reconnectAttempts;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.wantConnection || !this.url) return;
      try {
        this.attach(this.url);
      } catch {
        console.log(
          `[WS-Reconnect] ${new Date().toISOString()} | SFTP | reconnect_failed | attempt=${attempts}/${RECONNECT_MAX_ATTEMPTS}`,
        );
        // attach() → reset() zeroed the counter; restore so the next
        // close handler's scheduleReconnect() continues accumulating.
        if (this.wantConnection) {
          this.reconnectAttempts = attempts;
        }
        this.scheduleReconnect();
        return;
      }
      // Successful attach(). The open handler will log reconnect_success
      // once the WebSocket actually connects; for now restore the counter
      // so that if a close fires before open confirms, back-off continues.
      if (this.wantConnection) {
        this.reconnectAttempts = attempts;
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(copy: LocalizedText): void {
    this.updateStatusText(copy);
    this.onStatus?.(this.localize(copy));
  }

  private updateStatusText(copy: LocalizedText): void {
    this.statusCopy = copy;
    this.elements.status.dataset.i18nZh = copy.zh;
    this.elements.status.dataset.i18nEn = copy.en;
    this.elements.status.textContent = this.localize(copy);
  }

  private showProgress(operation: 'upload' | 'download', name: string, percent: number): void {
    this.elements.progress.dataset.operation = operation;
    this.elements.progress.dataset.name = name;
    this.elements.progress.hidden = false;
    this.elements.progressCancel.disabled = false;
    this.elements.progressBar.value = Math.max(0, Math.min(100, percent));
    this.updateProgressLanguage();
  }

  private updateProgressLanguage(): void {
    if (this.elements.progress.hidden) return;
    const transfer = this.uploadState ?? this.downloadState;
    const operation = this.elements.progress.dataset.operation;
    const name = this.elements.progress.dataset.name ?? '';
    const verb = operation === 'upload'
      ? this.localize({ zh: '上传', en: 'Uploading' })
      : this.localize({ zh: '下载', en: 'Downloading' });
    this.elements.progressLabel.textContent = transfer?.cancelling
      ? this.localize({ zh: `正在取消 ${name}…`, en: `Cancelling ${name}…` })
      : `${verb} ${name} ${Math.round(this.elements.progressBar.value)}%`;
    this.elements.progressCancel.disabled = Boolean(transfer?.cancelling || this.uploadState?.endSent);
    this.elements.progressCancel.textContent = transfer?.cancelling
      ? this.localize({ zh: '取消中…', en: 'Cancelling…' })
      : this.localize({ zh: '取消', en: 'Cancel' });
  }

  private hideProgress(): void {
    this.elements.progress.hidden = true;
    this.elements.progressBar.value = 0;
    this.elements.progressLabel.textContent = '';
    this.elements.progressCancel.disabled = false;
    this.elements.progressCancel.textContent = this.localize({ zh: '取消', en: 'Cancel' });
    delete this.elements.progress.dataset.operation;
    delete this.elements.progress.dataset.name;
  }

  private formatSize(bytes: number | string): string {
    if (typeof bytes === 'string') return sizeExceedsLimit(bytes) ? '> 64 MiB' : this.formatSize(Number(bytes));
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let value = bytes;
    let unit = -1;
    do { value /= 1024; unit++; } while (value >= 1024 && unit < units.length - 1);
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  private formatDate(value: string | number): string {
    if (value === '') return '';
    const numeric = typeof value === 'number' ? (value < 10_000_000_000 ? value * 1000 : value) : value;
    const date = new Date(numeric);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(this.isChinese() ? 'zh-CN' : 'en', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  }

  private typeLabel(type: SFTPEntry['type']): LocalizedText {
    if (type === 'directory') return { zh: '文件夹', en: 'Folder' };
    if (type === 'file') return { zh: '文件', en: 'File' };
    if (type === 'symlink') return { zh: '链接', en: 'Link' };
    return { zh: '其他', en: 'Other' };
  }

  private saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private localize(copy: LocalizedText): string {
    return this.isChinese() ? copy.zh : copy.en;
  }

  private isChinese(): boolean {
    return this.getLanguage().toLowerCase().startsWith('zh');
  }
}
