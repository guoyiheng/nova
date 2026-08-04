import { contextBridge, ipcRenderer } from 'electron'
import type { AgentProgressEvent, AskInput, BatchImportSqlInput, DataSourceInput, InitialSetupInput, ModelChannelInput, ModelListInput, NovaApi, SavedSqlInput, ScheduledTaskInput, SqlQueryInput, UpdateDownloadProgress } from '../shared/types.js'

const api: NovaApi = {
  getBootstrap: () => ipcRenderer.invoke('nova:bootstrap'),
  saveDataSource: (input: DataSourceInput) => ipcRenderer.invoke('nova:data-source:save', input),
  deleteDataSource: (id: string) => ipcRenderer.invoke('nova:data-source:delete', id),
  testDataSource: (input: DataSourceInput) => ipcRenderer.invoke('nova:data-source:test', input),
  chooseDatabaseFile: () => ipcRenderer.invoke('nova:data-source:choose-file'),
  setActiveDataSource: (id: string) => ipcRenderer.invoke('nova:data-source:activate', id),
  getSchemaCacheInfo: (dataSourceId: string) => ipcRenderer.invoke('nova:schema-cache:get', dataSourceId),
  getSchemaCacheStructure: (dataSourceId: string) => ipcRenderer.invoke('nova:schema-cache:structure', dataSourceId),
  rebuildSchemaCache: (dataSourceId: string) => ipcRenderer.invoke('nova:schema-cache:rebuild', dataSourceId),
  resetDemoDatabase: (dataSourceId: string) => ipcRenderer.invoke('nova:demo:reset', dataSourceId),
  saveModelChannel: (input: ModelChannelInput) => ipcRenderer.invoke('nova:model-channel:save', input),
  deleteModelChannel: (id: string) => ipcRenderer.invoke('nova:model-channel:delete', id),
  listModels: (input: ModelListInput) => ipcRenderer.invoke('nova:model:list', input),
  completeInitialSetup: (input: InitialSetupInput) => ipcRenderer.invoke('nova:setup:complete', input),
  ask: (input: AskInput) => ipcRenderer.invoke('nova:agent:ask', input),
  executeSql: (input: SqlQueryInput) => ipcRenderer.invoke('nova:sql:execute', input),
  saveSql: (input: SavedSqlInput) => ipcRenderer.invoke('nova:sql:save', input),
  deleteSavedSql: (id: string) => ipcRenderer.invoke('nova:sql:delete', id),
  saveScheduledTask: (input: ScheduledTaskInput) => ipcRenderer.invoke('nova:task:save', input),
  deleteScheduledTask: (id: string) => ipcRenderer.invoke('nova:task:delete', id),
  runScheduledTask: (id: string) => ipcRenderer.invoke('nova:task:run', id),
  updateQueryRun: (id, patch) => ipcRenderer.invoke('nova:query:update', id, patch),
  exportConfig: () => ipcRenderer.invoke('nova:config:export'),
  importConfig: () => ipcRenderer.invoke('nova:config:import'),
  batchImportSql: (input: BatchImportSqlInput) => ipcRenderer.invoke('nova:sql:batch-import', input),
  checkUpdate: () => ipcRenderer.invoke('nova:app:check-update'),
  downloadUpdate: (downloadUrl: string) => ipcRenderer.invoke('nova:app:download-update', downloadUrl),
  applyRendererUpdate: () => ipcRenderer.invoke('nova:app:apply-renderer-update'),
  openDownloadedUpdate: () => ipcRenderer.invoke('nova:app:open-downloaded-update'),
  rendererReady: () => ipcRenderer.invoke('nova:renderer:ready'),
  onUpdateDownloadProgress: (listener: (progress: UpdateDownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress) => listener(progress)
    ipcRenderer.on('nova:app:update-progress', handler)
    return () => ipcRenderer.removeListener('nova:app:update-progress', handler)
  },
  onAgentProgress: (listener: (progress: AgentProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: AgentProgressEvent) => listener(progress)
    ipcRenderer.on('nova:agent:progress', handler)
    return () => ipcRenderer.removeListener('nova:agent:progress', handler)
  },
}

contextBridge.exposeInMainWorld('nova', api)
