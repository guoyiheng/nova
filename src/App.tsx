import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  BarChart3,
  BookOpen,
  BookmarkCheck,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  CloudDownload,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  History,
  Import,
  Info,
  LoaderCircle,
  Maximize2,
  PackageOpen,
  Pin,
  PlugZap,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type {
  AgentProgressEvent,
  BootstrapData,
  DataSource,
  DataSourceInput,
  DatabaseType,
  ModelChannel,
  ModelChannelInput,
  QueryRun,
  QueryMode,
  SavedSql,
  SchemaCacheInfo,
  SchemaCacheStructure,
  UpdateCheckResult,
  UpdateDownloadProgress,
} from '../electron/shared/types'
import novaIconUrl from './assets/nova-icon.svg'
import { ResultProcess } from './ResultProcess'
import {
  CHART_TYPE_OPTIONS,
  DATABASE_TYPES,
  EMPTY_MODEL_CHANNEL,
  EMPTY_SOURCE,
  MODEL_PROVIDER_PRESETS,
  QUERY_SCROLL_POSITION_KEY,
  applyModelProviderPreset,
  errorMessage,
  formatBytes,
  formatReleaseDate,
  formatTime,
  inferBestChartType,
  inferChartFields,
  initialCardView,
  initialPage,
  initialQueryMode,
  initialQueryModel,
  numericValue,
  modelProviderPresetForBaseUrl,
  queryModelOptions,
  savedSqlForSource,
  savedQueryScrollPosition,
  type CardView,
  type ChartFields,
  type ModelProviderPreset,
  type Page,
  type ResultChartType,
  type SelectOption,
  type Toast,
} from './app-helpers'
import { parseDataSourceUrl } from './data-source-url'
import { MarkdownAnswer } from './MarkdownAnswer'

type SettingsSectionId = 'migration' | 'about'

function AppLoading() {
  return (
    <div className="app-loading">
      <img className="brand-mark" src={novaIconUrl} alt="Nova" />
      <LoaderCircle aria-hidden="true" className="spin" size={18} />
    </div>
  )
}

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [page, setPageState] = useState<Page>(() => initialPage())
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)

  const setPage = (newPage: Page) => {
    setPageState(newPage)
    try {
      localStorage.setItem('nova_active_page', newPage)
    } catch {
      // ignore
    }
  }

  const refresh = async () => {
    const next = await window.nova.getBootstrap()
    setData(next)
  }

  useEffect(() => {
    void refresh().catch((error) => setToast({ tone: 'error', message: errorMessage(error) }))
    void window.nova.checkUpdate().then(setUpdateResult).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => window.nova.onUpdateDownloadProgress(setDownloadProgress), [])

  if (!data) return <AppLoading />

  const activeSource = data.dataSources.find((source) => source.id === data.activeDataSourceId) ?? null

  const activateSource = async (id: string) => {
    await window.nova.setActiveDataSource(id)
    setData((current) => current ? { ...current, activeDataSourceId: id } : current)
  }

  const showToast = (message: string, tone: Toast['tone'] = 'success') => setToast({ message, tone })

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateDownloaded(false)
    setDownloadProgress(null)
    try {
      const result = await window.nova.checkUpdate()
      setUpdateResult(result)
      if (result.hasUpdate) showToast(`发现新版本 ${result.releaseName || `v${result.latestVersion}`}`)
      else showToast('当前已是最新版本', 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async (url: string) => {
    if (!url || downloadingUpdate) return
    setDownloadingUpdate(true)
    setDownloadProgress({ transferred: 0, total: updateResult?.downloadSize ?? null, percent: 0 })
    try {
      await window.nova.downloadUpdate(url)
      setUpdateDownloaded(true)
      showToast('更新安装包已下载', 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setDownloadingUpdate(false)
    }
  }

  const handleApplyRendererUpdate = async () => {
    if (downloadingUpdate) return
    setDownloadingUpdate(true)
    setDownloadProgress({ transferred: 0, total: updateResult?.downloadSize ?? null, percent: 0 })
    try {
      await window.nova.applyRendererUpdate()
      showToast('界面已更新', 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
      setDownloadingUpdate(false)
    }
  }

  const handleOpenDownloadedUpdate = async () => {
    try {
      await window.nova.openDownloadedUpdate()
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }

  const openQueryAtBottom = () => {
    try {
      localStorage.setItem(QUERY_SCROLL_POSITION_KEY, 'bottom')
    } catch {
      // ignore
    }
    setPage('query')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="brand-mark" src={novaIconUrl} alt="" />
          <div>
            <strong>Nova</strong>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <NavButton active={page === 'query'} label="查询" icon={Search} onClick={() => setPage('query')} />
          <NavButton active={page === 'history'} label="历史" icon={History} onClick={() => setPage('history')} />
          <NavButton active={page === 'sources'} label="数据源" icon={Database} onClick={() => setPage('sources')} />
          <NavButton active={page === 'models'} label="模型" icon={Sparkles} onClick={() => setPage('models')} />
        </nav>

        <div className="sidebar-foot">
          <NavButton active={page === 'settings'} label="设置" icon={Settings} onClick={() => setPage('settings')} badge={Boolean(updateResult?.hasUpdate)} />
        </div>
      </aside>

      <section className="workspace">
        <main id="main-content" className="main-content">
          {page === 'query' && (
            <QueryView
              data={data}
              activeSource={activeSource}
              onSourceChange={activateSource}
              onOpenSources={() => setPage('sources')}
              onOpenModels={() => setPage('models')}
              onDataChange={refresh}
              showToast={showToast}
            />
          )}
          {page === 'history' && (
            <HistoryView
              runs={data.queryRuns}
              savedSql={data.savedSql}
              sources={data.dataSources}
              modelChannels={data.modelChannels}
              onOpenQuery={openQueryAtBottom}
              activeRunId={activeRunId}
              onActiveRunChange={setActiveRunId}
              onDataChange={refresh}
              showToast={showToast}
            />
          )}
          {page === 'sources' && (
            <SourcesView
              sources={data.dataSources}
              activeSourceId={data.activeDataSourceId}
              onDataChange={refresh}
              showToast={showToast}
            />
          )}
          {page === 'models' && (
            <ModelsView channels={data.modelChannels} onDataChange={refresh} showToast={showToast} />
          )}
          {page === 'settings' && (
            <SettingsView
              appVersion={data.appVersion}
              dataSources={data.dataSources}
              activeDataSourceId={data.activeDataSourceId}
              updateResult={updateResult}
              checkingUpdate={checkingUpdate}
              downloadingUpdate={downloadingUpdate}
              downloadProgress={downloadProgress}
              updateDownloaded={updateDownloaded}
              onCheckUpdate={() => void handleCheckUpdate()}
              onDownloadUpdate={handleDownloadUpdate}
              onApplyRendererUpdate={() => void handleApplyRendererUpdate()}
              onOpenDownloadedUpdate={() => void handleOpenDownloadedUpdate()}
              onDataChange={refresh}
              showToast={showToast}
            />
          )}
        </main>
      </section>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}
          <span>{toast.message}</span>
          <button className="icon-button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={15} /></button>
        </div>
      )}
    </div>
  )
}

function NavButton({ active, label, icon: Icon, onClick, badge = false }: {
  active: boolean
  label: string
  icon: typeof Search
  onClick: () => void
  badge?: boolean
}) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon size={18} />
      <span>{label}</span>
      {badge && <i className="nav-notification-dot" aria-label="有可用更新" />}
    </button>
  )
}

function groupSelectOptions(options: SelectOption[]) {
  return options.reduce<Array<{ label?: string; options: SelectOption[] }>>((groups, option) => {
    const current = groups[groups.length - 1]
    if (current && current.label === option.group) current.options.push(option)
    else groups.push({ label: option.group, options: [option] })
    return groups
  }, [])
}

function SelectControl({ value, options, onChange, ariaLabel, placeholder = '请选择', icon, disabled = false, className = '', dotOnly = false }: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  icon?: ReactNode
  disabled?: boolean
  className?: string
  dotOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const optionGroups = groupSelectOptions(options)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className={`select-control ${className} ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {icon}
        <span className={`select-value ${selected ? '' : 'placeholder'}`}>{selected?.label ?? placeholder}</span>
        {selected?.status && <SelectStatus status={selected.status} dotOnly={dotOnly} />}
        <ChevronDown size={14} className="select-chevron" />
      </button>
      {open && (
        <div className="select-menu" role="listbox" aria-label={ariaLabel}>
          {optionGroups.map((group, groupIndex) => (
            <div
              className={`select-option-group ${group.label ? 'grouped' : ''}`}
              role={group.label ? 'group' : 'presentation'}
              aria-label={group.label}
              key={group.label ?? `options-${groupIndex}`}
            >
              {group.label && groupIndex > 0 && <div className="select-group-divider" role="separator" />}
              {group.label && <div className="select-group-label">{group.label}</div>}
              {group.options.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`select-option ${option.value === value ? 'selected' : ''}`}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className="select-option-copy"><strong>{option.label}</strong>{option.meta && <small>{option.meta}</small>}</span>
                  {option.status ? <SelectStatus status={option.status} dotOnly={dotOnly} /> : option.value === value ? <Check size={15} /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SelectStatus({ status, dotOnly = false }: { status: DataSource['status']; dotOnly?: boolean }) {
  const title = status === 'connected' ? '可用' : status === 'failed' ? '异常' : '未测试'
  if (dotOnly) {
    return <span className={`status-dot ${status}`} title={title} aria-label={title} />
  }
  return (
    <span className={`select-status ${status}`}>
      <i />{status === 'connected' ? '可用' : status === 'failed' ? '异常' : '未测试'}
    </span>
  )
}

function ModelProviderPicker({ baseUrl, onSelect, disabled = false }: {
  baseUrl: string
  onSelect: (preset: ModelProviderPreset | null) => void
  disabled?: boolean
}) {
  const selected = modelProviderPresetForBaseUrl(baseUrl)
  return (
    <div className="provider-picker" role="radiogroup" aria-label="选择模型提供商">
      {MODEL_PROVIDER_PRESETS.map((preset) => (
        <button
          type="button"
          role="radio"
          aria-checked={selected?.id === preset.id}
          className={selected?.id === preset.id ? 'active' : ''}
          disabled={disabled}
          key={preset.id}
          onClick={() => onSelect(preset)}
        >
          <span>{preset.shortName}</span>
          <strong>{preset.name}</strong>
        </button>
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={!selected}
        className={!selected ? 'active' : ''}
        disabled={disabled}
        onClick={() => onSelect(null)}
      >
        <span>+</span>
        <strong>自定义</strong>
      </button>
    </div>
  )
}

type PendingQuery = {
  id: string
  question: string
  dataSourceName: string
  mode: QueryMode
  model: string | null
  createdAt: string
  progressLogs: AgentProgressEvent[]
}

function QueryView({ data, activeSource, onSourceChange, onOpenSources, onOpenModels, onDataChange, showToast }: {
  data: BootstrapData
  activeSource: DataSource | null
  onSourceChange: (id: string) => Promise<void>
  onOpenSources: () => void
  onOpenModels: () => void
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [queryMode, setQueryModeState] = useState<QueryMode>(() => initialQueryMode())

  const setQueryMode = (mode: QueryMode) => {
    setQueryModeState(mode)
    try {
      localStorage.setItem('nova_query_mode', mode)
    } catch {
      // ignore
    }
  }
  const [smartQuestion, setSmartQuestion] = useState('')
  const [sqlText, setSqlText] = useState('')
  const [pendingQueries, setPendingQueries] = useState<PendingQuery[]>([])
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
  const [resultScrollRequest, setResultScrollRequest] = useState(0)
  const [selectedModelValue, setSelectedModelValue] = useState(initialQueryModel)
  const [showInitialSetup, setShowInitialSetup] = useState(false)
  const modelOptions = useMemo(() => queryModelOptions(data.modelChannels), [data.modelChannels])
  const selectedModel = modelOptions.find((option) => option.value === selectedModelValue) ?? modelOptions[0] ?? null
  const needsInitialSetup = data.dataSources.length === 0 && modelOptions.length === 0

  useEffect(() => {
    if (!selectedModel || selectedModel.value === selectedModelValue) return
    setSelectedModelValue(selectedModel.value)
  }, [selectedModel, selectedModelValue])

  const selectModel = (value: string) => {
    setSelectedModelValue(value)
    try {
      localStorage.setItem('nova_query_model', value)
    } catch {
      // ignore
    }
  }

  useEffect(() => window.nova.onAgentProgress((progress) => {
    if (!progress.queryId) return
    setPendingQueries((current) => current.map((query) => {
      if (query.id !== progress.queryId) return query
      const found = query.progressLogs.some((item) => item.id === progress.id)
      return {
        ...query,
        progressLogs: found
          ? query.progressLogs.map((item) => item.id === progress.id ? progress : item)
          : [...query.progressLogs, progress],
      }
    }))
  }), [])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const scrollRestoredRef = useRef(false)

  const queryText = queryMode === 'smart' ? smartQuestion : sqlText
  const setQueryText = (value: string) => queryMode === 'smart' ? setSmartQuestion(value) : setSqlText(value)

  useEffect(() => {
    const el = textareaRef.current
    const bd = backdropRef.current
    if (el) {
      el.style.height = 'auto'
      const targetHeight = `${Math.min(el.scrollHeight, 330)}px`
      el.style.height = targetHeight
      if (bd) {
        bd.style.height = targetHeight
      }
    }
  }, [queryText, queryMode])

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop
      backdropRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }
  const recentRuns = data.queryRuns.slice(0, 10).reverse()

  useEffect(() => {
    const container = resultsRef.current?.closest<HTMLElement>('.main-content')
    if (!container) return

    const rememberPosition = () => {
      if (!scrollRestoredRef.current) return
      const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop
      try {
        localStorage.setItem(QUERY_SCROLL_POSITION_KEY, distanceFromBottom <= 1 ? 'bottom' : String(container.scrollTop))
      } catch {
        // ignore
      }
    }
    const frame = requestAnimationFrame(() => {
      const savedPosition = savedQueryScrollPosition()
      const bottom = Math.max(0, container.scrollHeight - container.clientHeight)
      container.scrollTop = savedPosition === 'bottom' ? bottom : Math.min(savedPosition, bottom)
      scrollRestoredRef.current = true
      rememberPosition()
    })

    container.addEventListener('scroll', rememberPosition, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      rememberPosition()
      container.removeEventListener('scroll', rememberPosition)
      scrollRestoredRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!scrollTargetId || !pendingQueries.some((query) => query.id === scrollTargetId)) return
    const frame = requestAnimationFrame(() => {
      const results = resultsRef.current
      const container = results?.closest<HTMLElement>('.main-content')
      if (!container) return
      container.scrollTo({
        top: container.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
      setScrollTargetId((current) => current === scrollTargetId ? null : current)
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingQueries, scrollTargetId])

  useEffect(() => {
    if (!resultScrollRequest) return
    const frame = requestAnimationFrame(() => {
      const container = resultsRef.current?.closest<HTMLElement>('.main-content')
      if (!container) return
      container.scrollTo({
        top: container.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [resultScrollRequest])

  const slashQuery = queryMode === 'sql' && sqlText.trimStart().startsWith('/')
    ? sqlText.trimStart().slice(1).trim().toLocaleLowerCase()
    : null
  const referencedSql = slashQuery === null || !activeSource
    ? []
    : savedSqlForSource(data.savedSql, activeSource.id, slashQuery)

  const ask = () => {
    if (!activeSource || !queryText.trim() || slashQuery !== null) return
    if (queryMode === 'smart' && !selectedModel) {
      onOpenModels()
      return
    }
    const id = crypto.randomUUID()
    const mode = queryMode
    const source = activeSource
    const model = selectedModel
    const text = queryText.trim()
    const question = mode === 'smart' ? text : text.replace(/\s+/g, ' ').slice(0, 120) || 'SQL 查询'
    const pending: PendingQuery = {
      id,
      question,
      dataSourceName: source.name,
      mode,
      model: mode === 'smart' ? model!.model : null,
      createdAt: new Date().toISOString(),
      progressLogs: [],
    }

    setPendingQueries((current) => [...current, pending])
    setScrollTargetId(id)
    if (mode === 'smart') setSmartQuestion('')
    else setSqlText('')

    window.setTimeout(() => {
      void (async () => {
        try {
          const run = mode === 'smart'
            ? await window.nova.ask({ queryId: id, question: text, dataSourceId: source.id, modelChannelId: model!.channelId, model: model!.model })
            : await window.nova.executeSql({ queryId: id, sql: text, dataSourceId: source.id })
          await onDataChange()
          setResultScrollRequest((request) => request + 1)
          if (run.status === 'error') showToast(run.error ?? '查询失败。', 'error')
        } catch (error) {
          showToast(errorMessage(error), 'error')
        } finally {
          setPendingQueries((current) => current.filter((query) => query.id !== id))
        }
      })()
    }, 0)
  }

  const retry = async (run: QueryRun) => {
    const source = data.dataSources.find((item) => item.id === run.dataSourceId)
    if (!source) {
      showToast('原查询使用的数据源已不存在', 'error')
      return
    }

    const previousModel = modelOptions.find((option) =>
      `${data.modelChannels.find((channel) => channel.id === option.channelId)?.name} · ${option.model}` === run.model,
    )
    const model = previousModel ?? selectedModel ?? modelOptions[0]
    const rerunSql = run.sql.trim()
    if (!rerunSql && run.mode === 'smart' && !model) {
      showToast('请先添加可用的模型提供商', 'error')
      return
    }

    const id = crypto.randomUUID()
    const pending: PendingQuery = {
      id,
      question: run.question,
      dataSourceName: source.name,
      mode: rerunSql ? 'sql' : run.mode,
      model: rerunSql ? null : run.mode === 'smart' ? model!.model : null,
      createdAt: new Date().toISOString(),
      progressLogs: [],
    }
    setPendingQueries((current) => [...current, pending])
    setScrollTargetId(id)

    try {
      const next = rerunSql
        ? await window.nova.executeSql({ queryId: id, sql: rerunSql, dataSourceId: source.id })
        : run.mode === 'smart'
        ? await window.nova.ask({
            queryId: id,
            question: run.question,
            dataSourceId: source.id,
            modelChannelId: model!.channelId,
            model: model!.model,
          })
        : await window.nova.executeSql({ queryId: id, sql: run.sql, dataSourceId: source.id })
      await onDataChange()
      setResultScrollRequest((request) => request + 1)
      showToast(next.status === 'success' ? '重试完成' : next.error ?? '重试失败', next.status === 'success' ? 'success' : 'error')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setPendingQueries((current) => current.filter((query) => query.id !== id))
    }
  }

  const chooseSavedSql = (item: SavedSql) => setSqlText(item.sql)

  const deleteSavedSql = async (id: string) => {
    await window.nova.deleteSavedSql(id)
    await onDataChange()
    showToast('已移除 SQL 收藏')
  }

  return (
    <>
    <div className="query-page">
      <section className="results-section query-results" ref={resultsRef}>
        {needsInitialSetup ? (
          <div className="empty-query first-run-empty">
            <Database size={28} />
            <p>连接数据库，开始第一次查询</p>
            <span>完成数据库与模型配置后，即可用自然语言查询数据</span>
            <button className="primary-button first-run-button" onClick={() => setShowInitialSetup(true)}>
              <Plus size={16} />添加配置
            </button>
          </div>
        ) : recentRuns.length || pendingQueries.length ? (
          <div className="result-list">
            {recentRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                savedSql={data.savedSql}
                onDataChange={onDataChange}
                showToast={showToast}
                defaultView="table"
                tableFocused={run.mode === 'sql'}
                onRetry={retry}
              />
            ))}
            {pendingQueries.map((query) => <PendingRunCard key={query.id} query={query} />)}
          </div>
        ) : (
          <div className="empty-query">
            <Search size={26} />
            <p>还没有查询结果</p>
            <span>在下方输入框开始提问或输入 SQL</span>
          </div>
        )}
      </section>

      <section className="ask-zone bottom-composer">
        <div className="query-composer-area">
          {activeSource ? (
            <>
              <div className="composer">
                <div className="composer-head">
                  <div className="query-mode-switch segmented" aria-label="查询方式">
                    <button type="button" className={queryMode === 'smart' ? 'active' : ''} onClick={() => setQueryMode('smart')}><Sparkles size={14} />智能查询</button>
                    <button type="button" className={queryMode === 'sql' ? 'active' : ''} onClick={() => setQueryMode('sql')}><FileCode2 size={14} />SQL 查询</button>
                  </div>
                </div>
                <div className={`composer-body ${queryMode === 'sql' ? 'sql-mode-wrap' : ''}`}>
                  {queryMode === 'sql' && (
                    <div className="sql-editor-backdrop" ref={backdropRef} aria-hidden="true">
                      {queryText ? <HighlightSql sql={queryText} /> : null}
                      {queryText.endsWith('\n') ? <br /> : null}
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    className={queryMode === 'sql' ? 'sql-mode sql-editor-textarea' : ''}
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    onScroll={handleScroll}
                    onKeyDown={(event) => {
                      if (queryMode === 'sql' && slashQuery !== null && event.key === 'Enter' && !event.shiftKey && referencedSql[0]) {
                        event.preventDefault()
                        chooseSavedSql(referencedSql[0])
                        return
                      }
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void ask()
                      }
                    }}
                    placeholder={queryMode === 'smart' ? '例如：过去 30 天销售额最高的五个产品是什么？' : 'SELECT * FROM orders LIMIT 100；输入 / 引用收藏'}
                    aria-label={queryMode === 'smart' ? '输入数据问题' : '输入 SQL 查询'}
                    rows={2}
                    spellCheck={queryMode !== 'sql'}
                  />
                </div>
                {slashQuery !== null && (
                  <div className="sql-reference-panel">
                    {referencedSql.map((item) => (
                      <div className="sql-reference-item" key={item.id}>
                        <button className="sql-reference-main" onClick={() => chooseSavedSql(item)}>
                          <strong>{item.name}</strong>
                          <span><HighlightSql sql={item.sql} /></span>
                        </button>
                        <button className="icon-button" onClick={() => void deleteSavedSql(item.id)} aria-label={`删除收藏 ${item.name}`} title="删除收藏"><Trash2 size={15} /></button>
                      </div>
                    ))}
                    {!referencedSql.length && <div className="sql-reference-empty">没有匹配的 SQL 收藏</div>}
                  </div>
                )}
                <div className="composer-foot">
                  <div className="query-context-selects">
                    <SelectControl
                      className="composer-source-select"
                      ariaLabel="选择查询数据源"
                      icon={<Database size={15} />}
                      value={activeSource.id}
                      options={data.dataSources.map((source) => ({
                        value: source.id,
                        label: source.name,
                        meta: DATABASE_TYPES.find((type) => type.value === source.type)?.label ?? source.type,
                        status: source.status,
                      }))}
                      onChange={(id) => void onSourceChange(id)}
                      dotOnly={true}
                    />
                    {queryMode === 'smart' && selectedModel ? (
                      <SelectControl
                        className="composer-model-select"
                        ariaLabel="选择查询模型"
                        icon={<Sparkles size={15} />}
                        value={selectedModel.value}
                        options={modelOptions}
                        onChange={selectModel}
                      />
                    ) : queryMode === 'smart' ? (
                      <div className="agent-state">
                        <Sparkles size={15} />
                        <span>模型尚未配置</span>
                      </div>
                    ) : null}
                    <span className="composer-risk-text" title="请确认用户权限并谨慎操作">
                      <CircleAlert size={13} />
                      <span>请确认用户权限并谨慎操作</span>
                    </span>
                  </div>
                  <button className="ask-button" onClick={ask} disabled={!queryText.trim() || slashQuery !== null || (queryMode === 'smart' && !selectedModel)} aria-label={queryMode === 'smart' ? '发送问题' : '执行 SQL'}>
                    <Send size={18} />
                  </button>
                </div>
              </div>
              {queryMode === 'smart' && !selectedModel && (
                <button className="inline-notice" onClick={onOpenModels}><CircleAlert size={16} />添加可用的模型提供商后即可查询<ChevronDown size={15} className="rotate-minus-90" /></button>
              )}
            </>
          ) : needsInitialSetup ? null : (
            <button className="primary-button" onClick={onOpenSources}><Plus size={17} />添加数据源</button>
          )}
        </div>
      </section>
    </div>

      {showInitialSetup && (
        <InitialSetupModal
          onClose={() => setShowInitialSetup(false)}
          onComplete={async () => {
            await onDataChange()
            setShowInitialSetup(false)
          }}
          showToast={showToast}
        />
      )}
    </>
  )
}

function formatDuration(elapsedMs: number) {
  return elapsedMs < 1000 ? `${elapsedMs} ms` : `${(elapsedMs / 1000).toFixed(1)} 秒`
}

function ProcessLog({ logs, asking, open, onToggle }: {
  logs: AgentProgressEvent[]
  asking: boolean
  open: boolean
  onToggle: () => void
}) {
  const active = [...logs].reverse().find((item) => item.status === 'running')
  const failed = logs.some((item) => item.status === 'error')
  const elapsedMs = logs.reduce((total, item) => total + (item.status === 'running' ? 0 : item.elapsedMs), 0)
  return (
    <div className={`process-log ${open ? 'open' : ''}`}>
      <button className="process-summary" onClick={onToggle} aria-expanded={open}>
        {asking ? <LoaderCircle size={15} className="spin" /> : failed ? <CircleAlert size={15} /> : <Check size={15} />}
        <span>{asking ? active?.title ?? '准备查询' : failed ? '查询过程未完成' : '查询过程已完成'}</span>
        {!asking && elapsedMs > 0 && <time>{formatDuration(elapsedMs)}</time>}
        <ChevronDown size={15} />
      </button>
      {open && logs.length > 0 && (
        <ol className="process-steps">
          {logs.map((item) => (
            <li key={item.id} className={item.status}>
              <span className="process-status">{item.status === 'running' ? <LoaderCircle size={14} className="spin" /> : item.status === 'error' ? <CircleAlert size={14} /> : <Check size={14} />}</span>
              <div>
                <strong>{item.title}</strong>
                <pre>{item.detail}</pre>
              </div>
              <time>{item.status === 'running' ? '进行中' : formatDuration(item.elapsedMs)}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function PendingRunCard({ query }: { query: PendingQuery }) {
  const [progressOpen, setProgressOpen] = useState(true)
  return (
    <article className="run-card run-pending" data-query-id={query.id} aria-busy="true">
      <header className="run-header">
        <div className="run-title">
          <div className="run-kicker">
            <span className="datasource-tag">{query.dataSourceName}</span>
            <span>{query.mode === 'sql' ? 'SQL' : '智能'}</span>
            {query.model && <span>{query.model}</span>}
            <span>{formatTime(query.createdAt)}</span>
          </div>
          <h3>{query.question}</h3>
        </div>
      </header>
      <div className="pending-process">
        <ProcessLog
          logs={query.progressLogs}
          asking={true}
          open={progressOpen}
          onToggle={() => setProgressOpen((value) => !value)}
        />
      </div>
    </article>
  )
}

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL',
  'ON', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'IN',
  'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS', 'AS', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'UNION',
  'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE', 'DISTINCT', 'COUNT',
  'SUM', 'AVG', 'MAX', 'MIN', 'COALESCE', 'CAST', 'OVER', 'PARTITION', 'WINDOW', 'ROW_NUMBER',
  'ASC', 'DESC', 'TRUE', 'FALSE'
])

function HighlightSql({ sql }: { sql: string }) {
  if (!sql) return null

  const tokenRegex = /(\/\*[\s\S]*?\*\/|--[^\n]*|'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[^\s\w]+|\s+)/g

  const tokens: React.ReactNode[] = []
  let match: RegExpExecArray | null
  let key = 0

  while ((match = tokenRegex.exec(sql)) !== null) {
    const text = match[0]
    const upper = text.toUpperCase()
    if (text.startsWith('--') || text.startsWith('/*')) {
      tokens.push(<span key={key++} className="sql-hl-comment">{text}</span>)
    } else if (
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith('`') && text.endsWith('`'))
    ) {
      tokens.push(<span key={key++} className="sql-hl-string">{text}</span>)
    } else if (/^\d+(\.\d+)?$/.test(text)) {
      tokens.push(<span key={key++} className="sql-hl-number">{text}</span>)
    } else if (SQL_KEYWORDS.has(upper)) {
      tokens.push(<span key={key++} className="sql-hl-keyword">{text}</span>)
    } else {
      tokens.push(text)
    }
  }

  return <>{tokens}</>
}

function RunCard({ run, savedSql, onDataChange, showToast, defaultView = 'chart', tableFocused = false, allowPin = false, onRetry }: {
  run: QueryRun
  savedSql: SavedSql[]
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
  defaultView?: 'chart' | 'table'
  tableFocused?: boolean
  allowPin?: boolean
  onRetry?: (run: QueryRun) => Promise<void>
}) {
  const [view, setView] = useState<CardView>(() => initialCardView(run, defaultView))
  const [chartType, setChartType] = useState<ResultChartType>(() => inferBestChartType(run))
  const [showSql, setShowSql] = useState(false)
  const [showSqlSave, setShowSqlSave] = useState(false)
  const [sqlName, setSqlName] = useState('')
  const [savingSql, setSavingSql] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [updatingRunState, setUpdatingRunState] = useState(false)
  const sqlSaveControlRef = useRef<HTMLDivElement>(null)
  const chartFields = useMemo(() => inferChartFields(run), [run])
  const chartAvailable = Boolean(chartFields)
  const hasData = Boolean(run.table?.rows.length)
  const effectiveView: CardView = hasData ? view : run.processLogs.length ? 'process' : view
  const matchingSavedSql = Boolean(run.sql) ? savedSqlForSource(savedSql, run.dataSourceId)
    .filter((item) => item.sql.trim() === run.sql.trim()) : []
  const isSqlSaved = matchingSavedSql.length > 0

  const saveResultSql = async (name: string) => {
    if (!name.trim() || !run.sql.trim() || isSqlSaved || savingSql) return
    setSavingSql(true)
    try {
      await window.nova.saveSql({ dataSourceId: run.dataSourceId, name: name.trim().slice(0, 80), sql: run.sql.trim() })
      setSqlName('')
      setShowSqlSave(false)
      await onDataChange()
      showToast('SQL 已收藏，可在查询框输入 / 引用')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setSavingSql(false)
    }
  }

  const toggleSavedSql = async () => {
    if (savingSql) return
    if (matchingSavedSql.length) {
      setSavingSql(true)
      try {
        await Promise.all(matchingSavedSql.map((item) => window.nova.deleteSavedSql(item.id)))
        await onDataChange()
        showToast('已取消收藏 SQL', 'success')
      } catch (error) {
        showToast(errorMessage(error), 'error')
      } finally {
        setSavingSql(false)
      }
    } else if (run.mode === 'smart') {
      await saveResultSql(run.question.trim() || '智能查询')
    } else {
      setSqlName('')
      setShowSqlSave((current) => !current)
    }
  }

  useEffect(() => {
    setView(initialCardView(run, defaultView))
    setChartType(inferBestChartType(run))
    setShowSql(false)
    setShowSqlSave(false)
    setSqlName('')
  }, [defaultView, run.id])

  useEffect(() => {
    if (!showSqlSave) return
    const closeSqlSave = (event: PointerEvent) => {
      if (!sqlSaveControlRef.current?.contains(event.target as Node)) {
        setShowSqlSave(false)
      }
    }
    document.addEventListener('pointerdown', closeSqlSave)
    return () => document.removeEventListener('pointerdown', closeSqlSave)
  }, [showSqlSave])

  const changeCardView = (newView: CardView) => {
    setView(newView)
    try {
      localStorage.setItem(`nova_card_view_${run.id}`, newView)
    } catch {
      // ignore
    }
  }

  const changeChartType = async (newType: ResultChartType) => {
    setChartType(newType)
    try {
      localStorage.setItem(`nova_chart_type_${run.id}`, newType)
      await window.nova.updateQueryRun(run.id, {
        chart: {
          type: newType,
          xKey: chartFields?.categoryKey,
          yKey: chartFields?.yKey,
          title: run.chart?.title,
        },
      })
      await onDataChange()
    } catch {
      // ignore
    }
  }

  const toggle = async (patch: { isFavorite?: boolean; isPinned?: boolean }) => {
    if (updatingRunState) return
    setUpdatingRunState(true)
    try {
      await window.nova.updateQueryRun(run.id, patch)
      await onDataChange()
      if (patch.isFavorite !== undefined) {
        showToast(patch.isFavorite ? '已收藏查询记录' : '已取消收藏查询记录')
      }
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setUpdatingRunState(false)
    }
  }

  const retry = async () => {
    if (!onRetry || retrying) return
    setRetrying(true)
    try {
      await onRetry(run)
    } finally {
      setRetrying(false)
    }
  }

  const handleCopySql = async () => {
    if (!run.sql) return
    try {
      await navigator.clipboard.writeText(run.sql)
      setCopiedSql(true)
      setTimeout(() => setCopiedSql(false), 2000)
      showToast('SQL 已复制到剪贴板')
    } catch {
      // ignore
    }
  }

  const [cardModalData, setCardModalData] = useState<{ title: string; content: string } | null>(null)

  return (
    <article className={`run-card ${run.status === 'error' ? 'run-error' : ''}`}>
      <header className="run-header">
        <div className="run-title">
          <div className="run-kicker">
            <span className="datasource-tag">{run.dataSourceName}</span>
            <span>{run.mode === 'sql' ? 'SQL' : '智能'}</span>
            {run.model && <span>{run.model}</span>}
            <span>{formatTime(run.createdAt)}</span>
            <span>{(run.durationMs / 1000).toFixed(1)} 秒</span>
          </div>
          <h3>{run.question}</h3>
        </div>
        <div className="run-actions">
          {allowPin && (
            <button className={`icon-button ${run.isPinned ? 'active' : ''}`} onClick={() => void toggle({ isPinned: !run.isPinned })} disabled={updatingRunState} aria-label={run.isPinned ? '取消置顶' : '置顶'} title={run.isPinned ? '取消置顶' : '置顶'} aria-pressed={run.isPinned}>
              <Pin size={17} />
            </button>
          )}
          <button className={`icon-button ${run.isFavorite ? 'active' : ''}`} onClick={() => void toggle({ isFavorite: !run.isFavorite })} disabled={updatingRunState} aria-label={run.isFavorite ? '取消收藏' : '收藏'} title={run.isFavorite ? '取消收藏' : '收藏'} aria-pressed={run.isFavorite}>
            <Star size={17} fill={run.isFavorite ? 'currentColor' : 'none'} />
          </button>
          {onRetry && (
            <button className="icon-button" onClick={() => void retry()} disabled={retrying} aria-label="重新运行" title="重新运行">
              <RotateCcw size={17} className={retrying ? 'spin' : ''} />
            </button>
          )}
        </div>
      </header>

      {run.status === 'error' ? (
        <div className="error-result"><CircleAlert size={18} /><div><strong>查询未完成</strong><p>{run.error}</p></div></div>
      ) : (
        (!tableFocused || run.mode !== 'sql') && <MarkdownAnswer>{run.answer}</MarkdownAnswer>
      )}
      {(hasData || run.processLogs.length > 0) && (
        <div className="data-block">
          <div className="data-tabs" role="tablist">
            {hasData && <button role="tab" aria-selected={effectiveView === 'table'} className={effectiveView === 'table' ? 'active' : ''} onClick={() => changeCardView('table')}><BookOpen size={15} />数据</button>}
            {hasData && chartAvailable && <button role="tab" aria-selected={effectiveView === 'chart'} className={effectiveView === 'chart' ? 'active' : ''} onClick={() => changeCardView('chart')}><BarChart3 size={15} />图表</button>}
            {hasData && <button role="tab" aria-selected={effectiveView === 'json'} className={effectiveView === 'json' ? 'active' : ''} onClick={() => changeCardView('json')}><Braces size={15} />JSON</button>}
            {run.processLogs.length > 0 && <button role="tab" aria-selected={effectiveView === 'process'} className={effectiveView === 'process' ? 'active' : ''} onClick={() => changeCardView('process')}><Clock3 size={15} />过程</button>}
            {hasData && <span>{run.table!.rows.length}{run.table!.truncated ? '+' : ''} 行</span>}
          </div>
          {effectiveView === 'process'
            ? <ResultProcess logs={run.processLogs} />
            : effectiveView === 'chart' && chartAvailable && chartFields
              ? <ResultChart run={run} type={chartType} fields={chartFields} onTypeChange={(newType) => void changeChartType(newType)} />
              : effectiveView === 'json'
                ? <ResultJson run={run} showToast={showToast} />
                : <ResultTable run={run} showToast={showToast} />}
        </div>
      )}
      {run.status === 'success' && run.sql && (
        <div className={`sql-disclosure ${showSql ? 'open' : ''}`}>
          <button onClick={() => setShowSql((value) => !value)}><FileCode2 size={15} /><span>SQL</span><ChevronDown size={15} /></button>
          <div className="sql-content">
            <div>
              <div className="sql-content-body">
                <div className="sql-content-actions">
                  <div className="sql-save-control" ref={sqlSaveControlRef}>
                    <button
                      className={`icon-button ${isSqlSaved ? 'active' : ''}`}
                      type="button"
                      onClick={() => void toggleSavedSql()}
                      disabled={savingSql}
                      title={isSqlSaved ? '取消收藏 SQL' : '收藏为常用 SQL'}
                      aria-label={isSqlSaved ? '取消收藏 SQL' : '收藏为常用 SQL'}
                      aria-expanded={showSqlSave}
                    >
                      {savingSql ? <LoaderCircle size={16} className="spin" /> : isSqlSaved ? <BookmarkCheck size={16} className="text-green" /> : <BookmarkPlus size={16} />}
                    </button>
                    {showSqlSave && !isSqlSaved && run.mode === 'sql' && (
                      <form className="sql-save-popover" onSubmit={(event) => { event.preventDefault(); void saveResultSql(sqlName) }}>
                        <input
                          autoFocus
                          value={sqlName}
                          onChange={(event) => setSqlName(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Escape') setShowSqlSave(false) }}
                          maxLength={80}
                          placeholder="SQL 名称"
                          aria-label="SQL 收藏名称"
                        />
                        <button className="icon-button dark" type="submit" disabled={!sqlName.trim() || savingSql} aria-label="确认收藏" title="确认收藏"><Check size={15} /></button>
                      </form>
                    )}
                  </div>
                  <button className="icon-button" type="button" onClick={() => void handleCopySql()} title={copiedSql ? '已复制 SQL' : '复制 SQL'} aria-label={copiedSql ? '已复制 SQL' : '复制 SQL'}>
                    {copiedSql ? <Check size={15} className="text-green" /> : <Copy size={15} />}
                  </button>
                </div>
                <pre><HighlightSql sql={run.sql} /></pre>
              </div>
            </div>
          </div>
        </div>
      )}
      {cardModalData && (
        <DetailModal
          title={cardModalData.title}
          content={cardModalData.content}
          onClose={() => setCardModalData(null)}
          showToast={showToast}
        />
      )}
    </article>
  )
}

function ResultChart({ run, type, fields, onTypeChange }: {
  run: QueryRun
  type: ResultChartType
  fields: ChartFields
  onTypeChange: (type: ResultChartType) => void
}) {
  if (!run.table) return null
  const limit = type === 'pie' || type === 'radar' ? 12 : 24
  const data = run.table.rows.slice(0, limit).map((row, index) => {
    const normalized: Record<string, unknown> = {
      ...row,
      __category: String(row[fields.categoryKey] ?? index + 1),
      __index: index + 1,
    }
    for (const key of fields.numericKeys) normalized[key] = numericValue(row[key]) ?? 0
    normalized.__pieValue = Math.abs(Number(normalized[fields.yKey] ?? 0))
    const sizeValue = fields.sizeKey ? Math.abs(Number(normalized[fields.sizeKey] ?? 0)) : Math.abs(Number(normalized[fields.yKey] ?? 0))
    normalized.__bubbleSize = sizeValue || index + 1
    return normalized
  })
  const colors = [
    '#397a50', // Nova Forest Sage
    '#4361ee', // Soft Royal Blue
    '#e07a5f', // Muted Terracotta
    '#3a86ff', // Sky Ocean
    '#8338ec', // Soft Violet
    '#2a9d8f', // Muted Teal
    '#e63946', // Soft Coral Red
    '#f4a261', // Soft Apricot
    '#457b9d', // Slate Blue
    '#9b5de5', // Soft Lavender
    '#588157', // Moss Green
    '#d4a373', // Warm Sand
  ]
  const tooltipStyle = { border: '1px solid #e6dfd8', borderRadius: 8, boxShadow: '0 4px 18px rgba(20, 20, 19, 0.08)', background: '#faf9f5' }
  const axisTick = { fontSize: 12, fill: '#6c6a64' }
  const xDataKey = fields.xNumericKey ?? '__index'

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        {run.chart?.title && <div className="chart-title">{run.chart.title}</div>}
        <SelectControl
          className="chart-type-select"
          ariaLabel="选择图表类型"
          value={type}
          options={CHART_TYPE_OPTIONS}
          onChange={(value) => onTypeChange(value as ResultChartType)}
        />
      </div>
      {type === 'heatmap' ? (
        <ResultHeatmap run={run} fields={fields} />
      ) : (
        <div className="chart-graphic" role="img" aria-label={run.chart?.title ?? run.question}>
          <ResponsiveContainer width="100%" height={286}>
            {type === 'line' ? (
              <LineChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 2 }}>
                <CartesianGrid stroke="#e6dfd8" vertical={false} />
                <XAxis dataKey="__category" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                {fields.numericKeys.length > 1 ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                    {fields.numericKeys.map((key, i) => (
                      <Line key={key} dataKey={key} name={key} stroke={colors[i % colors.length]} strokeWidth={2.5} dot={{ r: 3.5, fill: colors[i % colors.length] }} activeDot={{ r: 5 }} />
                    ))}
                  </>
                ) : (
                  <Line dataKey={fields.yKey} name={fields.yKey} stroke={colors[0]} strokeWidth={2.5} dot={(props: any) => <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill={colors[props.index % colors.length]} />} activeDot={{ r: 6 }} />
                )}
              </LineChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} />
                <Pie data={data} dataKey="__pieValue" nameKey="__category" innerRadius={62} outerRadius={100} paddingAngle={1}>
                  {data.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
              </PieChart>
            ) : type === 'radar' ? (
              <RadarChart data={data} margin={{ top: 8, right: 42, bottom: 8, left: 42 }}>
                <PolarGrid stroke="#e6dfd8" />
                <PolarAngleAxis dataKey="__category" tick={axisTick} />
                <PolarRadiusAxis tick={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                {fields.numericKeys.length > 1 ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {fields.numericKeys.map((key, i) => (
                      <Radar key={key} dataKey={key} name={key} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.25} />
                    ))}
                  </>
                ) : (
                  <Radar dataKey={fields.yKey} name={fields.yKey} stroke={colors[0]} fill={colors[0]} fillOpacity={0.25} />
                )}
              </RadarChart>
            ) : type === 'scatter' || type === 'bubble' ? (
              <ScatterChart margin={{ top: 12, right: 24, bottom: 8, left: 2 }}>
                <CartesianGrid stroke="#e6dfd8" />
                <XAxis type="number" dataKey={xDataKey} name={fields.xNumericKey ?? '序号'} tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis type="number" dataKey={fields.yKey} name={fields.yKey} tick={axisTick} axisLine={false} tickLine={false} width={48} />
                {type === 'bubble' && <ZAxis type="number" dataKey="__bubbleSize" name={fields.sizeKey ?? fields.yKey} range={[60, 420]} />}
                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={tooltipStyle} />
                <Scatter data={data} fillOpacity={0.85}>
                  {data.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                </Scatter>
              </ScatterChart>
            ) : (
              <BarChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 2 }}>
                <CartesianGrid stroke="#e6dfd8" vertical={false} />
                <XAxis dataKey="__category" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} />
                <Tooltip cursor={{ fill: 'rgba(57, 122, 80, 0.06)' }} contentStyle={tooltipStyle} />
                {fields.numericKeys.length > 1 ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
                    {fields.numericKeys.map((key, i) => (
                      <Bar key={key} dataKey={key} name={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    ))}
                  </>
                ) : (
                  <Bar dataKey={fields.yKey} name={fields.yKey} radius={[4, 4, 0, 0]} maxBarSize={46}>
                    {data.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                  </Bar>
                )}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function ResultHeatmap({ run, fields }: { run: QueryRun; fields: ChartFields }) {
  if (!run.table) return null
  const rows = run.table.rows.slice(0, 20)
  const ranges = new Map(fields.numericKeys.map((key) => {
    const values = rows.map((row) => numericValue(row[key])).filter((value): value is number => value !== null)
    return [key, { min: Math.min(...values), max: Math.max(...values) }] as const
  }))

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-grid" style={{ gridTemplateColumns: `minmax(120px, 1.4fr) repeat(${fields.numericKeys.length}, minmax(88px, 1fr))` }}>
        <div className="heatmap-heading">{fields.categoryKey}</div>
        {fields.numericKeys.map((key) => <div className="heatmap-heading" key={key}>{key}</div>)}
        {rows.map((row, rowIndex) => (
          <div className="heatmap-row" key={rowIndex}>
            <div className="heatmap-label">{String(row[fields.categoryKey] ?? rowIndex + 1)}</div>
            {fields.numericKeys.map((key) => {
              const value = numericValue(row[key])
              const range = ranges.get(key)!
              const intensity = value === null ? 0 : range.max === range.min ? 0.55 : 0.16 + ((value - range.min) / (range.max - range.min)) * 0.68
              return <div className="heatmap-cell" key={key} style={{ '--heat': intensity } as React.CSSProperties}>{value === null ? '—' : String(row[key])}</div>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailModal({
  title,
  content,
  onClose,
  showToast,
}: {
  title: string
  content: string
  onClose: () => void
  showToast?: (message: string, tone?: Toast['tone']) => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      if (showToast) showToast('已复制到剪贴板')
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="detail-modal-backdrop" onClick={onClose}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-modal-header">
          <h4>完整数据 · {title}</h4>
          <button className="icon-button" onClick={onClose} aria-label="关闭弹窗"><X size={16} /></button>
        </header>
        <div className="detail-modal-body">
          <pre>{content}</pre>
        </div>
        <footer className="detail-modal-footer">
          <button className="secondary-button compact" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : '复制数据'}
          </button>
          <button className="primary-button compact" onClick={onClose}>关闭</button>
        </footer>
      </div>
    </div>
  )
}

function ResultTable({ run, showToast }: { run: QueryRun; showToast?: (message: string, tone?: Toast['tone']) => void }) {
  const [modalData, setModalData] = useState<{ title: string; content: string } | null>(null)

  if (!run.table) return null

  const handleCellClick = (column: string, value: unknown) => {
    let content = ''
    if (typeof value === 'object' && value !== null) {
      try {
        content = JSON.stringify(value, null, 2)
      } catch {
        content = String(value)
      }
    } else {
      content = String(value ?? '')
      if (content.startsWith('{') || content.startsWith('[')) {
        try {
          const parsed = JSON.parse(content)
          content = JSON.stringify(parsed, null, 2)
        } catch {
          // keep original
        }
      }
    }
    setModalData({ title: column, content })
  }

  return (
    <>
      <div className="table-scroll">
        <table className="result-table">
          <thead>
            <tr>
              {run.table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {run.table!.columns.map((column) => {
                  const rawValue = row[column]
                  if (rawValue === null || rawValue === undefined) {
                    return <td key={column}><span className="null-value">NULL</span></td>
                  }
                  const isObject = typeof rawValue === 'object' && rawValue !== null
                  const displayStr = isObject ? JSON.stringify(rawValue) : String(rawValue)
                  const isLong = isObject || displayStr.length > 35

                  return (
                    <td
                      key={column}
                      className={isLong ? 'cell-expandable' : ''}
                      title={isLong ? '点击查看完整数据' : undefined}
                      onClick={isLong ? () => handleCellClick(column, rawValue) : undefined}
                    >
                      <span>{displayStr}</span>
                      {isLong && <Maximize2 size={12} className="cell-expand-icon" />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modalData && (
        <DetailModal
          title={modalData.title}
          content={modalData.content}
          onClose={() => setModalData(null)}
          showToast={showToast}
        />
      )}
    </>
  )
}

function JsonTreeNode({
  name,
  value,
  level = 0,
  defaultCollapsedLevel = 1,
  expandAllSignal,
  collapseAllSignal,
}: {
  name?: string | number
  value: unknown
  level?: number
  defaultCollapsedLevel?: number
  expandAllSignal?: number
  collapseAllSignal?: number
}) {
  const [collapsed, setCollapsed] = useState(() => level >= defaultCollapsedLevel)

  useEffect(() => {
    if (expandAllSignal && level >= defaultCollapsedLevel) setCollapsed(false)
  }, [expandAllSignal, level, defaultCollapsedLevel])

  useEffect(() => {
    if (collapseAllSignal && level >= defaultCollapsedLevel) setCollapsed(true)
  }, [collapseAllSignal, level, defaultCollapsedLevel])

  const isObject = typeof value === 'object' && value !== null
  const isArray = Array.isArray(value)

  if (!isObject) {
    let renderVal = <span className="json-null">null</span>
    if (typeof value === 'string') renderVal = <span className="json-string">"{value}"</span>
    else if (typeof value === 'number') renderVal = <span className="json-number">{String(value)}</span>
    else if (typeof value === 'boolean') renderVal = <span className="json-boolean">{String(value)}</span>
    else if (value !== null && value !== undefined) renderVal = <span>{String(value)}</span>

    return (
      <div className="json-node-row">
        {name !== undefined && <span className="json-key">{name}: </span>}
        {renderVal}
      </div>
    )
  }

  const keys = isArray ? value.map((_, i) => i) : Object.keys(value as Record<string, unknown>)
  const summaryText = isArray
    ? `Array(${value.length})`
    : `Object { ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''} }`

  return (
    <div className="json-tree-group">
      <div className="json-node-row" onClick={() => setCollapsed((v) => !v)}>
        <ChevronRight
          size={14}
          style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms' }}
        />
        {name !== undefined && <span className="json-key">{name}: </span>}
        <span className="json-summary">{summaryText}</span>
      </div>
      {!collapsed && (
        <div className="json-node">
          {keys.map((k) => (
            <JsonTreeNode
              key={String(k)}
              name={k}
              value={(value as Record<string, unknown>)[k]}
              level={level + 1}
              defaultCollapsedLevel={defaultCollapsedLevel}
              expandAllSignal={expandAllSignal}
              collapseAllSignal={collapseAllSignal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ResultJson({ run, showToast }: { run: QueryRun; showToast?: (message: string, tone?: Toast['tone']) => void }) {
  const [copied, setCopied] = useState(false)
  const [expandAllSignal, setExpandAllSignal] = useState(0)
  const [collapseAllSignal, setCollapseAllSignal] = useState(0)

  if (!run.table) return null

  const jsonContent = JSON.stringify(run.table.rows, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      if (showToast) showToast('JSON 已复制到剪贴板')
    } catch {
      // ignore
    }
  }

  return (
    <div className="json-view-container">
      <div className="json-view-toolbar">
        <button
          className="icon-button"
          type="button"
          onClick={() => setExpandAllSignal((s) => s + 1)}
          title="全部展开"
          aria-label="全部展开"
        >
          <ChevronsUpDown size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => setCollapseAllSignal((s) => s + 1)}
          title="全部折叠"
          aria-label="全部折叠"
        >
          <ChevronsDownUp size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={handleCopy}
          title={copied ? '已复制' : '复制 JSON'}
          aria-label={copied ? '已复制' : '复制 JSON'}
        >
          {copied ? <Check size={15} className="text-green" /> : <Copy size={15} />}
        </button>
      </div>
      <JsonTreeNode
        value={run.table.rows}
        level={0}
        defaultCollapsedLevel={1}
        expandAllSignal={expandAllSignal}
        collapseAllSignal={collapseAllSignal}
      />
    </div>
  )
}

function HistoryView({ runs, savedSql, sources, modelChannels, onOpenQuery, activeRunId, onActiveRunChange, onDataChange, showToast }: {
  runs: QueryRun[]
  savedSql: SavedSql[]
  sources: DataSource[]
  modelChannels: ModelChannel[]
  onOpenQuery: () => void
  activeRunId: string | null
  onActiveRunChange: (id: string) => void
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorite'>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState<'all' | QueryMode>('all')
  const filtered = useMemo(() => runs.filter((run) => {
    const matchesSearch = `${run.question} ${run.answer} ${run.sql} ${run.dataSourceName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    const matchesFavorite = filter === 'all' || run.isFavorite
    const matchesSource = sourceFilter === 'all' || run.dataSourceId === sourceFilter
    const matchesMode = modeFilter === 'all' || run.mode === modeFilter
    return matchesSearch && matchesFavorite && matchesSource && matchesMode
  }), [filter, modeFilter, runs, search, sourceFilter])
  const active = filtered.find((run) => run.id === activeRunId) ?? filtered[0] ?? null

  const retry = async (run: QueryRun) => {
    try {
      const modelOptions = queryModelOptions(modelChannels)
      const previousModel = modelOptions.find((option) => `${modelChannels.find((channel) => channel.id === option.channelId)?.name} · ${option.model}` === run.model)
      const selectedModel = previousModel ?? modelOptions[0]
      if (!run.sql.trim() && run.mode === 'smart' && !selectedModel) {
        showToast('请先添加可用的模型提供商', 'error')
        return
      }
      const next = run.sql.trim()
        ? await window.nova.executeSql({ queryId: crypto.randomUUID(), sql: run.sql, dataSourceId: run.dataSourceId })
        : run.mode === 'smart'
        ? await window.nova.ask({
            queryId: crypto.randomUUID(),
            question: run.question,
            dataSourceId: run.dataSourceId,
            modelChannelId: selectedModel!.channelId,
            model: selectedModel!.model,
          })
        : await window.nova.executeSql({ queryId: crypto.randomUUID(), sql: run.sql, dataSourceId: run.dataSourceId })
      await onDataChange()
      onOpenQuery()
      onActiveRunChange(next.id)
      showToast(next.status === 'success' ? '重试完成' : next.error ?? '重试失败', next.status === 'success' ? 'success' : 'error')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }

  return (
    <div className="history-layout">
      <section className="history-index">
        <div className="history-tools">
          <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题或结果" aria-label="搜索历史" /></label>
          <div className="history-filter-row">
            <SelectControl
              className="history-filter-select"
              ariaLabel="按数据源筛选历史"
              icon={<Database size={14} />}
              value={sourceFilter}
              options={[
                { value: 'all', label: '全部数据源' },
                ...sources.map((source) => ({ value: source.id, label: source.name })),
              ]}
              onChange={setSourceFilter}
            />
            <SelectControl
              className="history-filter-select history-mode-select"
              ariaLabel="按查询方式筛选历史"
              icon={<Braces size={14} />}
              value={modeFilter}
              options={[
                { value: 'all', label: '全部方式' },
                { value: 'smart', label: '智能查询' },
                { value: 'sql', label: 'SQL 查询' },
              ]}
              onChange={(value) => setModeFilter(value as 'all' | QueryMode)}
            />
          </div>
          <div className="segmented">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
            <button className={filter === 'favorite' ? 'active' : ''} onClick={() => setFilter('favorite')}><Star size={14} />收藏</button>
          </div>
        </div>
        <div className="history-list">
          {filtered.map((run) => (
            <button key={run.id} className={`history-item ${active?.id === run.id ? 'active' : ''}`} onClick={() => onActiveRunChange(run.id)}>
              <div className="history-item-top">
                <span className={run.status === 'success' ? 'success-dot' : 'error-dot'} />
                <span>{run.dataSourceName}</span>
                <time>{formatTime(run.createdAt)}</time>
                {run.isPinned && <Pin size={13} fill="currentColor" />}
              </div>
              <strong>{run.question}</strong>
              <p>{run.status === 'error' ? run.error : run.answer}</p>
            </button>
          ))}
          {!filtered.length && <div className="list-empty"><History size={22} /><span>没有匹配的查询记录</span></div>}
        </div>
      </section>
      <section className="history-detail">
        {active ? <RunCard run={active} savedSql={savedSql} onDataChange={onDataChange} showToast={showToast} defaultView="table" allowPin onRetry={retry} /> : <div className="detail-empty"><Clock3 size={25} /><span>选择一条查询记录</span></div>}
      </section>
    </div>
  )
}

function isDataSourceFormComplete(form: DataSourceInput) {
  if (form.type === 'sqlite') return Boolean(form.filePath?.trim())
  return Boolean(form.host?.trim() && form.port && form.database?.trim() && form.username?.trim())
}

function DataSourceFields({ form, setForm, onChooseFile, passwordPlaceholder = '', disabled = false }: {
  form: DataSourceInput
  setForm: Dispatch<SetStateAction<DataSourceInput>>
  onChooseFile: () => void
  passwordPlaceholder?: string
  disabled?: boolean
}) {
  const update = <K extends keyof DataSourceInput>(key: K, value: DataSourceInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <div className="field-grid two">
        <label className="field"><span>连接名称</span><input autoFocus disabled={disabled} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="默认数据源" /></label>
        <div className="field">
          <span>数据库类型<i className="required-mark" aria-hidden="true">*</i></span>
          <SelectControl
            ariaLabel="数据库类型"
            value={form.type}
            options={DATABASE_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            onChange={(value) => {
              const type = value as DatabaseType
              const port = DATABASE_TYPES.find((item) => item.value === type)?.port ?? null
              setForm((current) => ({ ...current, type, port }))
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {form.type === 'sqlite' ? (
        <label className="field"><span>数据库文件<i className="required-mark" aria-hidden="true">*</i></span><div className="input-action"><input required disabled={disabled} value={form.filePath} onChange={(event) => update('filePath', event.target.value)} placeholder="/path/to/database.sqlite" /><button type="button" disabled={disabled} onClick={onChooseFile} aria-label="选择数据库文件" title="选择数据库文件"><FolderOpen size={17} /></button></div></label>
      ) : (
        <>
          <div className="field-grid host-port">
            <label className="field"><span>主机<i className="required-mark" aria-hidden="true">*</i></span><input required disabled={disabled} value={form.host} onChange={(event) => update('host', event.target.value)} placeholder="127.0.0.1" /></label>
            <label className="field"><span>端口<i className="required-mark" aria-hidden="true">*</i></span><input required disabled={disabled} type="number" value={form.port ?? ''} onChange={(event) => update('port', Number(event.target.value))} /></label>
          </div>
          <label className="field"><span>数据库<i className="required-mark" aria-hidden="true">*</i></span><input required disabled={disabled} value={form.database} onChange={(event) => update('database', event.target.value)} placeholder="database_name" /></label>
          <div className="field-grid two">
            <label className="field"><span>用户名<i className="required-mark" aria-hidden="true">*</i></span><input required disabled={disabled} value={form.username} onChange={(event) => update('username', event.target.value)} autoComplete="off" /></label>
            <label className="field"><span>密码</span><input type="password" disabled={disabled} value={form.password} onChange={(event) => update('password', event.target.value)} placeholder={passwordPlaceholder} autoComplete="new-password" /></label>
          </div>
          <div className="field">
            <span>SSL 模式</span>
            <SelectControl
              className="ssl-mode-select"
              ariaLabel="SSL 模式"
              value={form.sslMode ?? 'prefer'}
              options={[
                { value: 'prefer', label: '优先使用' },
                { value: 'require', label: '必须使用' },
                { value: 'disable', label: '禁用' },
                { value: 'verify-full', label: '完整验证' },
              ]}
              onChange={(value) => update('sslMode', value)}
              disabled={disabled}
            />
          </div>
        </>
      )}
      <div className="database-permission-note">
        <CircleAlert size={16} />
        <div><strong>请确认用户权限并谨慎操作</strong><span>Nova 使用当前连接账号的数据库权限执行查询</span></div>
      </div>
    </>
  )
}

function InitialSetupModal({ onClose, onComplete, showToast }: {
  onClose: () => void
  onComplete: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [source, setSource] = useState<DataSourceInput>({ ...EMPTY_SOURCE })
  const [channelName, setChannelName] = useState('默认提供商')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-5-mini')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [advancedModelSettingsOpen, setAdvancedModelSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)

  const chooseFile = async () => {
    const filePath = await window.nova.chooseDatabaseFile()
    if (filePath) setSource((current) => ({ ...current, filePath }))
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const result = await window.nova.testDataSource(source)
      showToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  const loadModels = async () => {
    setLoadingModels(true)
    try {
      const models = await window.nova.listModels({ baseUrl, apiKey })
      setAvailableModels(models)
      if (models.length && !models.includes(model)) setModel(models[0]!)
      showToast(models.length ? `已获取 ${models.length} 个模型` : '服务未返回可用模型，请继续手动填写', models.length ? 'success' : 'error')
    } catch (error) {
      setAvailableModels([])
      showToast(errorMessage(error), 'error')
    } finally {
      setLoadingModels(false)
    }
  }

  const complete = async () => {
    if (!isDataSourceFormComplete(source) || !baseUrl.trim() || !model.trim() || !apiKey.trim()) return
    setSaving(true)
    try {
      await window.nova.completeInitialSetup({
        dataSource: source,
        modelChannel: { name: channelName.trim(), baseUrl: baseUrl.trim(), apiKey, model: model.trim(), availableModels },
      })
      await onComplete()
      showToast('初始配置已完成')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const modelOptions = availableModels.includes(model)
    ? availableModels.map((item) => ({ value: item, label: item }))
    : [...availableModels.map((item) => ({ value: item, label: item })), { value: '__custom', label: '自定义模型' }]
  const providerPreset = modelProviderPresetForBaseUrl(baseUrl)

  const selectProvider = (preset: ModelProviderPreset | null) => {
    if (!preset) {
      setChannelName('自定义提供商')
      setBaseUrl('')
      setModel('')
      setAvailableModels([])
      setAdvancedModelSettingsOpen(true)
      return
    }
    setChannelName(preset.name)
    setBaseUrl(preset.baseUrl)
    setModel(preset.model)
    setAvailableModels([])
    setAdvancedModelSettingsOpen(false)
  }

  return (
    <div className="detail-modal-backdrop" onClick={onClose}>
      <form
        className="detail-modal initial-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="initial-setup-title"
        onSubmit={(event) => { event.preventDefault(); void complete() }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose() }}
      >
        <header className="detail-modal-header initial-setup-header">
          <div><h4 id="initial-setup-title">初始配置</h4><p>连接数据，并配置用于智能查询的模型</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗"><X size={16} /></button>
        </header>

        <div className="detail-modal-body initial-setup-body">
          <section className="initial-setup-section">
            <div className="initial-setup-section-heading"><Database size={18} /><div><h5>数据库</h5><p>查询的数据来源</p></div></div>
            <div className="initial-setup-fields">
              <DataSourceFields form={source} setForm={setSource} onChooseFile={() => void chooseFile()} disabled={saving} />
              <button className="secondary-button align-self-start" type="button" onClick={() => void testConnection()} disabled={testing || saving || !isDataSourceFormComplete(source)}>
                {testing ? <LoaderCircle size={16} className="spin" /> : <Database size={16} />}测试连接
              </button>
            </div>
          </section>

          <section className="initial-setup-section model-setup-section">
            <div className="initial-setup-section-heading"><Sparkles size={18} /><div><h5>模型</h5><p>生成 SQL 与分析结果</p></div></div>
            <div className="initial-setup-fields">
              <div className="field"><span>选择提供商</span><ModelProviderPicker baseUrl={baseUrl} onSelect={selectProvider} disabled={saving} /></div>
              <label className="field"><span>API Key<i className="required-mark" aria-hidden="true">*</i></span><input type="password" required disabled={saving} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerPreset?.apiKeyPlaceholder ?? '填写 API Key'} autoComplete="new-password" /></label>
              {providerPreset && <p className="provider-default-summary">已配置 <strong>{providerPreset.model}</strong>，填写 Key 即可开始使用</p>}
              <details className="provider-advanced" open={advancedModelSettingsOpen} onToggle={(event) => setAdvancedModelSettingsOpen(event.currentTarget.open)}>
                <summary>高级设置<ChevronDown size={15} /></summary>
                <div>
                  <label className="field"><span>提供商名称</span><input disabled={saving} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="默认提供商" /></label>
                  <label className="field"><span>API 地址<i className="required-mark" aria-hidden="true">*</i></span><input type="url" required disabled={saving} value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setAvailableModels([]) }} placeholder="https://api.example.com/v1" /></label>
                  <div className="field">
                    <span>模型<i className="required-mark" aria-hidden="true">*</i></span>
                    <div className="model-picker">
                      <div className="model-picker-main">
                        {availableModels.length ? (
                          <SelectControl className="model-select" ariaLabel="选择模型" value={availableModels.includes(model) ? model : '__custom'} options={modelOptions} onChange={(value) => setModel(value === '__custom' ? '' : value)} disabled={saving} />
                        ) : (
                          <input aria-label="模型" required disabled={saving} value={model} onChange={(event) => setModel(event.target.value)} placeholder="模型 ID" />
                        )}
                        <button className="model-pull-button" type="button" onClick={() => void loadModels()} disabled={loadingModels || saving || !baseUrl} aria-label="拉取模型列表" title="从 API 地址拉取模型列表">
                          {loadingModels ? <LoaderCircle size={16} className="spin" /> : <CloudDownload size={16} />}<span>{loadingModels ? '拉取中' : '拉取'}</span>
                        </button>
                      </div>
                      {availableModels.length > 0 && !availableModels.includes(model) && <input className="model-custom-input" autoFocus required disabled={saving} value={model} onChange={(event) => setModel(event.target.value)} placeholder="输入自定义模型 ID" aria-label="自定义模型 ID" />}
                    </div>
                  </div>
                </div>
              </details>
              <div className="security-note compact"><ShieldCheck size={16} /><div><strong>本地加密</strong><span>数据库密码与 API Key 仅在本地加密保存</span></div></div>
            </div>
          </section>
        </div>

        <footer className="detail-modal-footer initial-setup-footer">
          <button className="secondary-button compact" type="button" onClick={onClose} disabled={saving}>稍后配置</button>
          <button className="primary-button compact" type="submit" disabled={saving || !isDataSourceFormComplete(source) || !baseUrl.trim() || !model.trim() || !apiKey.trim()}>
            {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}完成配置
          </button>
        </footer>
      </form>
    </div>
  )
}

function SourcesView({ sources, activeSourceId, onDataChange, showToast }: {
  sources: DataSource[]
  activeSourceId: string | null
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [selectedId, setSelectedId] = useState<string | 'new'>(sources[0]?.id ?? 'new')
  const selected = sources.find((source) => source.id === selectedId)
  const [form, setForm] = useState<DataSourceInput>(selected ? sourceToInput(selected) : EMPTY_SOURCE)
  const [connectionUrl, setConnectionUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [schemaCache, setSchemaCache] = useState<SchemaCacheInfo | null>(null)
  const [loadingSchemaCache, setLoadingSchemaCache] = useState(false)
  const [rebuildingSchemaCache, setRebuildingSchemaCache] = useState(false)
  const [showSchemaStructure, setShowSchemaStructure] = useState(false)
  const [schemaStructure, setSchemaStructure] = useState<SchemaCacheStructure | null>(null)
  const [loadingSchemaStructure, setLoadingSchemaStructure] = useState(false)
  const [schemaSearch, setSchemaSearch] = useState('')
  const [editorTab, setEditorTab] = useState<'connection' | 'schema'>('connection')

  useEffect(() => {
    if (selected) {
      setForm((current) => current.id === selected.id ? current : sourceToInput(selected))
    } else if (selectedId === 'new') {
      setForm((current) => current.id ? { ...EMPTY_SOURCE } : current)
    }
  }, [selected, selectedId])

  useEffect(() => {
    let active = true
    if (!selected) {
      setSchemaCache(null)
      setSchemaStructure(null)
      setShowSchemaStructure(false)
      setSchemaSearch('')
      setLoadingSchemaCache(false)
      return () => { active = false }
    }
    setSchemaCache(null)
    setSchemaStructure(null)
    setShowSchemaStructure(false)
    setSchemaSearch('')
    setLoadingSchemaCache(true)
    void window.nova.getSchemaCacheInfo(selected.id)
      .then((info) => {
        if (active) setSchemaCache(info)
      })
      .catch((error) => {
        if (active) showToast(errorMessage(error), 'error')
      })
      .finally(() => {
        if (active) setLoadingSchemaCache(false)
      })
    return () => { active = false }
  }, [selected?.id])

  const filteredSchemaStructure = useMemo(() => {
    if (!schemaStructure) return []
    const query = schemaSearch.trim().toLocaleLowerCase()
    if (!query) return schemaStructure.schemas
    return schemaStructure.schemas
      .map((schema) => ({
        ...schema,
        relations: schema.relations.flatMap((relation) => {
          const relationMatches = [relation.name, relation.comment, schema.name]
            .some((value) => value?.toLocaleLowerCase().includes(query))
          const columns = relationMatches
            ? relation.columns
            : relation.columns.filter((column) => [column.name, column.type, column.description]
              .some((value) => value?.toLocaleLowerCase().includes(query)))
          return relationMatches || columns.length ? [{ ...relation, columns }] : []
        }),
      }))
      .filter((schema) => schema.relations.length)
  }, [schemaSearch, schemaStructure])

  const save = async () => {
    setSaving(true)
    try {
      const saved = await window.nova.saveDataSource(form)
      setForm(sourceToInput(saved))
      setSelectedId(saved.id)
      await onDataChange()
      setSchemaCache(await window.nova.getSchemaCacheInfo(saved.id))
      showToast('数据源已保存')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const rebuildSchemaCache = async () => {
    if (!selected) return
    setRebuildingSchemaCache(true)
    try {
      const info = await window.nova.rebuildSchemaCache(selected.id)
      setSchemaCache(info)
      if (showSchemaStructure) setSchemaStructure(await window.nova.getSchemaCacheStructure(selected.id))
      showToast(info.state === 'partial' ? '结构缓存已重建，部分对象读取失败' : '结构缓存已重建', info.state === 'partial' ? 'error' : 'success')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setRebuildingSchemaCache(false)
    }
  }

  const toggleSchemaStructure = async () => {
    if (!selected) return
    if (showSchemaStructure) {
      setShowSchemaStructure(false)
      return
    }
    setShowSchemaStructure(true)
    if (schemaStructure) return
    setLoadingSchemaStructure(true)
    try {
      setSchemaStructure(await window.nova.getSchemaCacheStructure(selected.id))
    } catch (error) {
      setShowSchemaStructure(false)
      showToast(errorMessage(error), 'error')
    } finally {
      setLoadingSchemaStructure(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await window.nova.testDataSource(form)
      showToast(result.message, result.ok ? 'success' : 'error')
      await onDataChange()
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    if (!selected || !window.confirm(`删除数据源“${selected.name}”？历史查询仍会保留。`)) return
    await window.nova.deleteDataSource(selected.id)
    setForm({ ...EMPTY_SOURCE })
    setSelectedId('new')
    setEditorTab('connection')
    await onDataChange()
    showToast('数据源已删除')
  }

  const chooseFile = async () => {
    const filePath = await window.nova.chooseDatabaseFile()
    if (filePath) setForm((current) => ({ ...current, filePath }))
  }

  const importConnectionUrl = () => {
    try {
      const parsed = parseDataSourceUrl(connectionUrl)
      setForm((current) => ({ ...current, ...parsed }))
      const typeLabel = DATABASE_TYPES.find((item) => item.value === parsed.type)?.label ?? '数据库'
      showToast(`已识别并填充 ${typeLabel} 连接信息`)
    } catch (error) {
      showToast(errorMessage(error), 'error')
    }
  }

  return (
    <div className="sources-layout">
      <section className="source-index">
        <div className="source-index-heading">
          <div><h1>连接</h1><span>{sources.length} 个数据源</span></div>
          <button className="icon-button dark" onClick={() => { setForm({ ...EMPTY_SOURCE }); setConnectionUrl(''); setSelectedId('new'); setEditorTab('connection') }} aria-label="添加数据源" title="添加数据源"><Plus size={17} /></button>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <button key={source.id} className={`source-item ${selectedId === source.id ? 'active' : ''}`} onClick={() => { setForm(sourceToInput(source)); setSelectedId(source.id) }}>
              <DatabaseGlyph type={source.type} />
              <span><strong>{source.name}</strong><small>{source.type === 'sqlite' ? source.filePath : `${source.host}:${source.port}`}</small></span>
              <i className={`status-dot ${source.status}`} />
              {source.id === activeSourceId && <span className="active-label">当前</span>}
            </button>
          ))}
          {!sources.length && <div className="list-empty compact"><Database size={21} /><span>还没有数据源</span></div>}
        </div>
      </section>

      <section className="source-editor">
        <div className={`editor-heading ${selected ? 'has-tabs' : ''}`}>
          <div><h2>{selected ? selected.name : '添加数据源'}</h2></div>
          {selected && <button className="danger-icon-button" onClick={() => void remove()} aria-label="删除数据源" title="删除数据源"><Trash2 size={17} /></button>}
        </div>

        {selected && (
          <div className="source-editor-tabs" role="tablist" aria-label="数据源详情">
            <button role="tab" aria-selected={editorTab === 'connection'} className={editorTab === 'connection' ? 'active' : ''} onClick={() => setEditorTab('connection')}>连接信息</button>
            <button role="tab" aria-selected={editorTab === 'schema'} className={editorTab === 'schema' ? 'active' : ''} onClick={() => setEditorTab('schema')}>
              数据库结构
              {schemaCache?.state === 'stale' && <i aria-label="结构缓存需要更新" />}
            </button>
          </div>
        )}

        {(!selected || editorTab === 'connection') && (
          <>
            {!selected && (
              <div className="connection-url-import">
                <label htmlFor="connection-url">粘贴连接串</label>
                <div>
                  <input
                    id="connection-url"
                    value={connectionUrl}
                    onChange={(event) => setConnectionUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        importConnectionUrl()
                      }
                    }}
                    placeholder="mysql://user:password@host:3306/database"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="secondary-button" type="button" onClick={importConnectionUrl} disabled={!connectionUrl.trim()}><Import size={16} />识别导入</button>
                </div>
              </div>
            )}

            <form onSubmit={(event) => { event.preventDefault(); void save() }} className="source-form">
              <DataSourceFields
                form={form}
                setForm={setForm}
                onChooseFile={() => void chooseFile()}
                passwordPlaceholder={selected?.hasPassword ? '已安全保存' : ''}
                disabled={saving}
              />
              <div className="form-actions">
                <button className="secondary-button" type="button" onClick={() => void test()} disabled={testing || saving || !isDataSourceFormComplete(form)}>{testing ? <LoaderCircle size={16} className="spin" /> : <Database size={16} />}测试连接</button>
                <button className="primary-button" type="submit" disabled={saving || testing || !isDataSourceFormComplete(form)}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存数据源</button>
              </div>
            </form>
          </>
        )}

        {selected && editorTab === 'schema' && (
          <section className="schema-cache-summary" aria-labelledby="schema-cache-heading">
            <div className="schema-cache-heading">
              <div className="schema-cache-status">
                <span>缓存状态</span>
                <strong id="schema-cache-heading">
                  {loadingSchemaCache ? '正在读取' : schemaCache?.state === 'ready' ? '状态正常' : schemaCache?.state === 'partial' ? '部分对象不可用' : schemaCache?.state === 'stale' ? '需要更新' : '尚未创建'}
                </strong>
              </div>
              <div className="schema-cache-actions">
                {schemaCache && schemaCache.state !== 'missing' && (
                  <button className="secondary-button compact" type="button" onClick={() => void toggleSchemaStructure()} disabled={loadingSchemaStructure} aria-expanded={showSchemaStructure}>
                    {loadingSchemaStructure ? <LoaderCircle size={14} className="spin" /> : showSchemaStructure ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                    {showSchemaStructure ? '收起结构' : '查看结构'}
                  </button>
                )}
                <button className={`${schemaCache?.state === 'stale' ? 'primary-button' : 'secondary-button'} compact`} type="button" onClick={() => void rebuildSchemaCache()} disabled={rebuildingSchemaCache || loadingSchemaCache}>
                  {rebuildingSchemaCache ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                  {rebuildingSchemaCache ? '正在重建' : '重建缓存'}
                </button>
              </div>
            </div>
            {schemaCache?.state === 'stale' && (
              <p className="schema-cache-reason"><CircleAlert size={15} />已超过 24 小时未更新，数据库结构可能已经变化。</p>
            )}
            {schemaCache?.state === 'partial' && (
              <p className="schema-cache-reason"><CircleAlert size={15} />部分数据库对象读取失败，重建缓存可以再次尝试读取。</p>
            )}
            {schemaCache?.state === 'missing' ? (
              <p className="schema-cache-empty">首次智能查询时会自动读取数据库结构，也可以现在重建。</p>
            ) : schemaCache ? (
              <>
                <dl className="schema-cache-metrics">
                  <div><dt>Schema</dt><dd>{schemaCache.schemaCount}</dd></div>
                  <div><dt>表与视图</dt><dd>{schemaCache.counts.table + schemaCache.counts.view}</dd></div>
                  <div><dt>字段</dt><dd>{schemaCache.counts.column}</dd></div>
                  <div><dt>大小</dt><dd>{formatBytes(schemaCache.sizeBytes)}</dd></div>
                </dl>
                <p className="schema-cache-meta">
                  最近更新 {schemaCache.refreshedAt ? formatTime(schemaCache.refreshedAt) : '未知'}
                  {schemaCache.errors.length ? ` · ${schemaCache.errors.length} 类对象读取失败` : ''}
                </p>
                {showSchemaStructure && (
                  <div className="schema-browser">
                    <label className="schema-browser-search">
                      <Search size={15} />
                      <input value={schemaSearch} onChange={(event) => setSchemaSearch(event.target.value)} placeholder="搜索表、视图或字段" />
                    </label>
                    <div className="schema-browser-content">
                      {filteredSchemaStructure.map((schema) => (
                        <section className="schema-browser-group" key={schema.name}>
                          <header><strong>{schema.name}</strong><span>{schema.relations.length} 个对象</span></header>
                          <div className="schema-relation-list">
                            {schema.relations.map((relation) => (
                              <details className="schema-relation" key={`${relation.type}-${relation.name}`}>
                                <summary>
                                  <ChevronRight size={14} />
                                  <span className={`schema-object-kind ${relation.type}`}>{relation.type === 'table' ? '表' : '视图'}</span>
                                  <strong>{relation.name}</strong>
                                  <small>{relation.columns.length} 个字段</small>
                                </summary>
                                {relation.comment && <p>{relation.comment}</p>}
                                {relation.columns.length ? (
                                  <div className="schema-column-list">
                                    {relation.columns.map((column) => (
                                      <div key={column.name}>
                                        <strong>{column.name}</strong>
                                        <span>{column.type || '未知类型'}</span>
                                        <small>{column.nullable === false ? '必填' : column.nullable === true ? '可空' : ''}</small>
                                        {column.description && <p>{column.description}</p>}
                                      </div>
                                    ))}
                                  </div>
                                ) : <p className="schema-columns-empty">缓存中没有字段详情</p>}
                              </details>
                            ))}
                          </div>
                        </section>
                      ))}
                      {!loadingSchemaStructure && !filteredSchemaStructure.length && (
                        <div className="schema-browser-empty">没有匹配的数据库对象</div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </section>
        )}
      </section>
    </div>
  )
}

function sourceToInput(source: DataSource): DataSourceInput {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    host: source.host,
    port: source.port,
    database: source.database,
    username: source.username,
    password: '',
    sslMode: source.sslMode,
    filePath: source.filePath,
  }
}

function DatabaseGlyph({ type }: { type: DatabaseType }) {
  return <span className={`database-glyph db-${type}`}>{type === 'postgres' ? 'PG' : type === 'sqlserver' ? 'MS' : type === 'mariadb' ? 'MA' : type === 'sqlite' ? 'SQ' : 'MY'}</span>
}

function modelChannelToInput(channel: ModelChannel): ModelChannelInput {
  return {
    id: channel.id,
    name: channel.name,
    baseUrl: channel.baseUrl,
    model: channel.model,
    availableModels: channel.availableModels,
    apiKey: '',
  }
}

function ModelsView({ channels, onDataChange, showToast }: {
  channels: ModelChannel[]
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [selectedId, setSelectedId] = useState<string | 'new'>(channels[0]?.id ?? 'new')
  const selected = channels.find((channel) => channel.id === selectedId)
  const [form, setForm] = useState<ModelChannelInput>(selected ? modelChannelToInput(selected) : { ...EMPTY_MODEL_CHANNEL })
  const [loadingModels, setLoadingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(() => !modelProviderPresetForBaseUrl(form.baseUrl))

  useEffect(() => {
    if (selected) {
      setForm((current) => current.id === selected.id ? current : modelChannelToInput(selected))
      setAdvancedOpen(!modelProviderPresetForBaseUrl(selected.baseUrl))
    } else if (selectedId === 'new') {
      setForm((current) => current.id ? { ...EMPTY_MODEL_CHANNEL } : current)
    }
  }, [selected, selectedId])

  const update = <K extends keyof ModelChannelInput>(key: K, value: ModelChannelInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const selectProvider = (preset: ModelProviderPreset | null) => {
    setForm((current) => preset
      ? applyModelProviderPreset(current, preset)
      : { ...current, name: '自定义提供商', baseUrl: '', model: '', availableModels: [] })
    setAdvancedOpen(!preset)
  }

  const loadModels = async () => {
    setLoadingModels(true)
    try {
      const models = await window.nova.listModels({ channelId: form.id, baseUrl: form.baseUrl, apiKey: form.apiKey || undefined })
      setForm((current) => ({
        ...current,
        availableModels: models,
        model: models.length && !models.includes(current.model) ? models[0]! : current.model,
      }))
      showToast(models.length ? `已获取 ${models.length} 个模型` : '服务未返回可用模型，请继续手动填写', models.length ? 'success' : 'error')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setLoadingModels(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const models = await window.nova.listModels({ channelId: form.id, baseUrl: form.baseUrl, apiKey: form.apiKey || undefined })
      showToast(models.length ? `连接成功，服务返回 ${models.length} 个模型` : '连接成功，服务未返回可用模型')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await window.nova.saveModelChannel(form)
      setForm(modelChannelToInput(saved))
      setSelectedId(saved.id)
      await onDataChange()
      showToast('模型提供商已保存')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!selected || !window.confirm(`删除模型提供商“${selected.name}”？历史查询仍会保留。`)) return
    await window.nova.deleteModelChannel(selected.id)
    setForm({ ...EMPTY_MODEL_CHANNEL })
    setSelectedId('new')
    await onDataChange()
    showToast('模型提供商已删除')
  }

  const availableModels = form.availableModels ?? []
  const modelOptions = availableModels.includes(form.model)
    ? availableModels.map((model) => ({ value: model, label: model }))
    : [...availableModels.map((model) => ({ value: model, label: model })), { value: '__custom', label: '自定义模型' }]
  const providerPreset = modelProviderPresetForBaseUrl(form.baseUrl)
  const needsApiKey = Boolean(providerPreset && !selected?.hasApiKey && !form.apiKey?.trim())

  return (
    <div className="sources-layout models-layout">
      <section className="source-index">
        <div className="source-index-heading">
          <div><h1>模型</h1><span>{channels.length} 个提供商</span></div>
          <button className="icon-button dark" onClick={() => { setForm({ ...EMPTY_MODEL_CHANNEL }); setSelectedId('new') }} aria-label="添加模型提供商" title="添加模型提供商"><Plus size={17} /></button>
        </div>
        <div className="source-list">
          {channels.map((channel) => (
            <button key={channel.id} className={`source-item model-channel-item ${selectedId === channel.id ? 'active' : ''}`} onClick={() => { setForm(modelChannelToInput(channel)); setSelectedId(channel.id) }}>
              <span className="model-channel-glyph"><Sparkles size={15} /></span>
              <span><strong>{channel.name}</strong><small>{channel.model}</small></span>
              <i className={`status-dot ${channel.hasApiKey ? 'connected' : 'untested'}`} title={channel.hasApiKey ? '已配置 API Key' : '未配置 API Key'} />
            </button>
          ))}
          {!channels.length && <div className="list-empty compact"><Sparkles size={21} /><span>还没有模型提供商</span></div>}
        </div>
      </section>

      <section className="source-editor">
        <div className="editor-heading">
          <div><h2>{selected ? selected.name : '添加模型提供商'}</h2></div>
          {selected && <button className="danger-icon-button" onClick={() => void remove()} aria-label="删除模型提供商" title="删除模型提供商"><Trash2 size={17} /></button>}
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void save() }} className="source-form model-channel-form">
          <div className="field"><span>选择提供商</span><ModelProviderPicker baseUrl={form.baseUrl} onSelect={selectProvider} disabled={saving || testing} /></div>
          <label className="field"><span>API Key{providerPreset && <i className="required-mark" aria-hidden="true">*</i>}</span><input type="password" required={Boolean(providerPreset && !selected?.hasApiKey)} disabled={saving || testing} value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={selected?.hasApiKey ? '已安全保存，留空则不修改' : providerPreset?.apiKeyPlaceholder ?? '填写 API Key（如需要）'} autoComplete="new-password" /></label>
          {providerPreset && <p className="provider-default-summary">默认使用 <strong>{form.model}</strong>，填写 Key 后即可保存</p>}
          <details className="provider-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary>高级设置<ChevronDown size={15} /></summary>
            <div>
              <label className="field"><span>提供商名称</span><input disabled={saving || testing} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="默认提供商" /></label>
              <label className="field"><span>API 地址<i className="required-mark" aria-hidden="true">*</i></span><input type="url" required disabled={saving || testing} value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value, availableModels: [] }))} placeholder="https://api.example.com/v1" /></label>
              <div className="field">
                <span>默认模型<i className="required-mark" aria-hidden="true">*</i></span>
                <div className="model-picker">
                  <div className="model-picker-main">
                    {availableModels.length ? <SelectControl className="model-select" ariaLabel="选择默认模型" value={availableModels.includes(form.model) ? form.model : '__custom'} options={modelOptions} onChange={(value) => update('model', value === '__custom' ? '' : value)} disabled={saving || testing} /> : <input aria-label="默认模型" required disabled={saving || testing} value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="模型 ID" />}
                    <button className="model-pull-button" type="button" onClick={() => void loadModels()} disabled={loadingModels || testing || saving || !form.baseUrl} aria-label="拉取模型列表" title="从该提供商拉取模型列表">{loadingModels ? <LoaderCircle size={16} className="spin" /> : <CloudDownload size={16} />}<span>{loadingModels ? '拉取中' : '拉取'}</span></button>
                  </div>
                  {availableModels.length > 0 && !availableModels.includes(form.model) && <input className="model-custom-input" autoFocus required disabled={saving || testing} value={form.model} onChange={(event) => update('model', event.target.value)} placeholder="输入自定义模型 ID" aria-label="自定义模型 ID" />}
                </div>
              </div>
            </div>
          </details>
          <div className="security-note"><ShieldCheck size={17} /><div><strong>本地加密</strong><span>API Key 仅在本地加密保存，不会发送到渲染页面</span></div></div>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => void testConnection()} disabled={testing || loadingModels || saving || !form.baseUrl.trim()}>{testing ? <LoaderCircle size={16} className="spin" /> : <PlugZap size={16} />}测试连接</button>
            <button className="primary-button" type="submit" disabled={saving || testing || loadingModels || !form.baseUrl.trim() || !form.model.trim() || needsApiKey}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}保存模型提供商</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function SettingsView({ appVersion, dataSources, activeDataSourceId, updateResult, checkingUpdate, downloadingUpdate, downloadProgress, updateDownloaded, onCheckUpdate, onDownloadUpdate, onApplyRendererUpdate, onOpenDownloadedUpdate, onDataChange, showToast }: {
  appVersion: string
  dataSources: DataSource[]
  activeDataSourceId: string | null
  updateResult: UpdateCheckResult | null
  checkingUpdate: boolean
  downloadingUpdate: boolean
  downloadProgress: UpdateDownloadProgress | null
  updateDownloaded: boolean
  onCheckUpdate: () => void
  onDownloadUpdate: (url: string) => Promise<void>
  onApplyRendererUpdate: () => void
  onOpenDownloadedUpdate: () => void
  onDataChange: () => Promise<void>
  showToast: (message: string, tone?: Toast['tone']) => void
}) {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchContent, setBatchContent] = useState('')
  const [batchDataSourceId, setBatchDataSourceId] = useState(activeDataSourceId ?? dataSources[0]?.id ?? '')
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('migration')
  const migrationSectionRef = useRef<HTMLElement>(null)
  const aboutSectionRef = useRef<HTMLElement>(null)
  const settingsContentRef = useRef<HTMLDivElement>(null)
  const navigationTargetRef = useRef<SettingsSectionId | null>(null)
  const navigationResetRef = useRef<number | null>(null)

  useEffect(() => {
    if (dataSources.some((source) => source.id === batchDataSourceId)) return
    setBatchDataSourceId(activeDataSourceId ?? dataSources[0]?.id ?? '')
  }, [activeDataSourceId, batchDataSourceId, dataSources])

  useEffect(() => {
    const scrollContainer = settingsContentRef.current
    if (!scrollContainer) return
    scrollContainer.closest('.main-content')?.scrollTo({ top: 0 })

    const updateActiveSection = () => {
      if (navigationTargetRef.current) return
      const marker = scrollContainer.getBoundingClientRect().top + 112
      const sections: Array<[SettingsSectionId, HTMLElement | null]> = [
        ['migration', migrationSectionRef.current],
        ['about', aboutSectionRef.current],
      ]
      let next: SettingsSectionId = 'migration'
      for (const [id, section] of sections) {
        if (section && section.getBoundingClientRect().top <= marker) next = id
      }
      if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 24) next = 'about'
      setActiveSection((current) => current === next ? current : next)
    }

    updateActiveSection()
    scrollContainer.addEventListener('scroll', updateActiveSection, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', updateActiveSection)
      if (navigationResetRef.current !== null) window.clearTimeout(navigationResetRef.current)
    }
  }, [])

  const importConfig = async () => {
    setImporting(true)
    try {
      const result = await window.nova.importConfig()
      if (!result.canceled && result.summary) {
        const summary = result.summary
        await onDataChange()
        const imported = [
          summary.dataSourcesImported ? `${summary.dataSourcesImported} 个数据源` : '',
          summary.modelChannelsImported ? `${summary.modelChannelsImported} 个模型提供商` : '',
          summary.savedSqlImported ? `${summary.savedSqlImported} 条 SQL` : '',
        ].filter(Boolean).join('、') || '0 项配置'
        const skipped = summary.dataSourcesSkipped + summary.modelChannelsSkipped + summary.savedSqlSkipped
        showToast(`已导入 ${imported}${skipped ? `，跳过 ${skipped} 项重复或无绑定内容` : ''}`)
      }
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setImporting(false)
    }
  }

  const exportConfig = async () => {
    setExporting(true)
    try {
      const result = await window.nova.exportConfig()
      if (!result.canceled) showToast('配置已导出')
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setExporting(false)
    }
  }

  const batchImportSql = async () => {
    if (!batchContent.trim() || !batchDataSourceId) return
    setBatchImporting(true)
    try {
      const result = await window.nova.batchImportSql({ content: batchContent, dataSourceId: batchDataSourceId })
      await onDataChange()
      setShowBatchModal(false)
      setBatchContent('')
      showToast(`已导入 ${result.imported} 条 SQL${result.skipped ? `，跳过 ${result.skipped} 条重复` : ''}`)
    } catch (error) {
      showToast(errorMessage(error), 'error')
    } finally {
      setBatchImporting(false)
    }
  }

  const goToSection = (id: SettingsSectionId, section: HTMLElement | null) => {
    navigationTargetRef.current = id
    setActiveSection(id)
    const scrollContainer = settingsContentRef.current
    if (scrollContainer && section) {
      const top = scrollContainer.scrollTop
        + section.getBoundingClientRect().top
        - scrollContainer.getBoundingClientRect().top
        - 40
      scrollContainer.scrollTo({ top, behavior: 'smooth' })
    }
    if (navigationResetRef.current !== null) window.clearTimeout(navigationResetRef.current)
    navigationResetRef.current = window.setTimeout(() => {
      navigationTargetRef.current = null
      navigationResetRef.current = null
    }, 650)
  }

  return (
    <>
    <div className="settings-page">
      <nav className="settings-nav" aria-label="设置分类">
        <div className="settings-nav-heading">
          <div><h1>设置</h1><span>2 个分类</span></div>
        </div>
        <div className="settings-nav-list">
          <button className={activeSection === 'migration' ? 'active' : ''} aria-current={activeSection === 'migration' ? 'location' : undefined} onClick={() => goToSection('migration', migrationSectionRef.current)}>
            <FolderOpen size={17} /><strong>配置迁移</strong>
          </button>
          <button className={activeSection === 'about' ? 'active' : ''} aria-current={activeSection === 'about' ? 'location' : undefined} onClick={() => goToSection('about', aboutSectionRef.current)}>
            <Info size={17} /><strong>关于</strong>
          </button>
        </div>
      </nav>

      <div className="settings-content" ref={settingsContentRef}>
        <div className="settings-content-inner">
          <section className="settings-section migration-settings-section" id="settings-migration" ref={migrationSectionRef}>
            <div className="settings-heading"><h1>配置迁移</h1></div>
            <div className="config-section">
              <div className="config-section-copy">
                <h2>导入与导出</h2>
                <p>数据源 · 模型提供商 · 收藏的 SQL</p>
              </div>
              <div className="config-section-actions">
                <button className="secondary-button" onClick={() => void importConfig()} disabled={importing || exporting}>
                  {importing ? <LoaderCircle size={16} className="spin" /> : <Import size={16} />}导入配置
                </button>
                <button className="primary-button" onClick={() => void exportConfig()} disabled={importing || exporting}>
                  {exporting ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}导出配置
                </button>
              </div>
            </div>
            <div className="config-section">
              <div className="config-section-copy">
                <h2>批量导入 SQL</h2>
                <p>粘贴常用 SQL，保存到指定数据源</p>
                <span>格式：以 "-- 名称" 开头，后跟 SQL 语句</span>
              </div>
              <div className="config-section-actions">
                <button className="primary-button" onClick={() => setShowBatchModal(true)} disabled={!dataSources.length}>
                  <FileCode2 size={16} />批量导入
                </button>
              </div>
            </div>
          </section>

          <section className="settings-section about-section" id="settings-about" ref={aboutSectionRef}>
            <div className="settings-heading"><h1>关于</h1></div>
            <div className="about-intro">
              <div className="about-product-mark" aria-hidden="true"><img src={novaIconUrl} alt="" /></div>
              <div className="about-copy">
                <span>Nova</span>
                <h2>数据库智能查询工具</h2>
                <p>Nova 是由 Yiheng 开发的数据库智能查询工具。你可以用自然语言提出数据问题，由 Nova 生成并执行 SQL，再将查询结果整理为结论、表格与图表。</p>
                <p>支持 PostgreSQL、MySQL、MariaDB、SQL Server 和 SQLite。连接信息与查询记录保存在本地，数据库访问范围由连接账号的权限决定。</p>
                <p>为防止数据泄露，建议使用测试数据库生成 SQL 语句后，在生产环境中直接使用「SQL 查询」，谨慎在生产环境中使用联网模型的「智能查询」。</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>当前版本</dt>
                <dd className="version-dd">
                  <span className="version-number">v{appVersion}</span>
                  <button
                    className="secondary-button compact update-check-btn"
                    type="button"
                    onClick={onCheckUpdate}
                    disabled={checkingUpdate || downloadingUpdate}
                  >
                    {checkingUpdate ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                    <span>{checkingUpdate ? '检查中' : '检查更新'}</span>
                  </button>
                  {updateResult?.hasUpdate && (
                    updateResult.updateKind === 'renderer' ? (
                      <button className="primary-button compact update-now-btn" type="button" onClick={onApplyRendererUpdate} disabled={downloadingUpdate}>
                        {downloadingUpdate ? <LoaderCircle size={14} className="spin" /> : <CloudDownload size={14} />}
                        <span>{downloadingUpdate ? '正在更新' : '立即更新'}</span>
                      </button>
                    ) : updateDownloaded ? (
                      <button className="primary-button compact update-now-btn" type="button" onClick={onOpenDownloadedUpdate}>
                        <PackageOpen size={14} /><span>打开安装包</span>
                      </button>
                    ) : updateResult.downloadUrl ? (
                      <button className="primary-button compact update-now-btn" type="button" onClick={() => void onDownloadUpdate(updateResult.downloadUrl!)} disabled={downloadingUpdate}>
                        {downloadingUpdate ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                        <span>{downloadingUpdate ? '正在下载' : '立即更新'}</span>
                      </button>
                    ) : updateResult.htmlUrl ? (
                      <a href={updateResult.htmlUrl} target="_blank" rel="noreferrer" className="primary-button compact update-now-btn"><ExternalLink size={13} /><span>立即更新</span></a>
                    ) : null
                  )}
                </dd>
              </div>
            </dl>

            {updateResult?.hasUpdate && (
              <div className="update-panel has-update" aria-live="polite">
                  <div className="update-release">
                    <div className="update-release-heading">
                      <div className="update-release-title">
                        <span>可用更新</span>
                        <strong>{updateResult.releaseName || `Nova ${updateResult.latestVersion}`}</strong>
                      </div>
                      {updateResult.updateKind !== 'renderer' && (
                        <div className="update-version-route" aria-label={`从 ${updateResult.currentVersion} 更新至 ${updateResult.latestVersion}`}>
                          <span>v{updateResult.currentVersion}</span>
                          <ChevronRight size={14} />
                          <strong>v{updateResult.latestVersion}</strong>
                        </div>
                      )}
                    </div>
                    {(updateResult.publishedAt || updateResult.downloadName) && (
                      <div className="update-meta">
                        {updateResult.publishedAt && <time dateTime={updateResult.publishedAt}>{formatReleaseDate(updateResult.publishedAt)}</time>}
                        {updateResult.downloadName && <span>{updateResult.downloadName}</span>}
                        {updateResult.downloadSize && <span>{formatBytes(updateResult.downloadSize)}</span>}
                      </div>
                    )}
                    {updateResult.releaseNotes && (
                      <div className="update-notes">{updateResult.releaseNotes}</div>
                    )}
                    {downloadingUpdate && (
                      <div className="update-download-progress">
                        <div><span>正在下载</span><strong>{downloadProgress?.percent !== null && downloadProgress?.percent !== undefined ? `${downloadProgress.percent}%` : formatBytes(downloadProgress?.transferred)}</strong></div>
                        <div className={`update-progress-track ${downloadProgress?.percent === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="更新下载进度" aria-valuenow={downloadProgress?.percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                          <i style={downloadProgress?.percent === null ? undefined : { transform: `scaleX(${(downloadProgress?.percent ?? 0) / 100})` }} />
                        </div>
                      </div>
                    )}
                    {updateResult.htmlUrl && <a href={updateResult.htmlUrl} target="_blank" rel="noreferrer" className="update-release-link">查看版本<ExternalLink size={13} /></a>}
                  </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>

      {showBatchModal && (
        <div className="detail-modal-backdrop" onClick={() => setShowBatchModal(false)}>
          <div className="detail-modal batch-import-modal" onClick={(e) => e.stopPropagation()}>
            <header className="detail-modal-header">
              <h4>批量导入 SQL</h4>
              <button className="icon-button" onClick={() => setShowBatchModal(false)} aria-label="关闭弹窗"><X size={16} /></button>
            </header>
            <div className="detail-modal-body batch-import-body">
              <div className="field">
                <span>数据源</span>
                <SelectControl
                  ariaLabel="选择 SQL 收藏的数据源"
                  value={batchDataSourceId}
                  options={dataSources.map((source) => ({ value: source.id, label: source.name }))}
                  onChange={setBatchDataSourceId}
                  disabled={batchImporting}
                />
              </div>
              <label className="field">
                <span>SQL 内容</span>
                <textarea
                  className="batch-import-textarea"
                  value={batchContent}
                  onChange={(e) => setBatchContent(e.target.value)}
                  placeholder={`-- 查询用户列表\nSELECT * FROM users LIMIT 100;`}
                  rows={12}
                  disabled={batchImporting}
                />
              </label>
            </div>
            <footer className="detail-modal-footer">
              <button className="secondary-button compact" onClick={() => setShowBatchModal(false)} disabled={batchImporting}>取消</button>
              <button className="primary-button compact" onClick={() => void batchImportSql()} disabled={batchImporting || !batchContent.trim() || !batchDataSourceId}>
                {batchImporting ? <LoaderCircle size={14} className="spin" /> : <FileCode2 size={14} />}导入
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
