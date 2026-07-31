import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import type { AgentProgressEvent, QueryTable } from '../electron/shared/types'

function formatDuration(elapsedMs: number) {
  return elapsedMs < 1000 ? `${elapsedMs} ms` : `${(elapsedMs / 1000).toFixed(1)} 秒`
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function ProcessResultTable({ table }: { table: QueryTable }) {
  if (table.affectedRows !== undefined) {
    return <p className="process-result-empty">影响 {table.affectedRows} 行</p>
  }
  if (!table.rows.length) {
    return <p className="process-result-empty">查询结果为空</p>
  }

  return (
    <div className="process-result-table-wrap">
      <div className="process-result-meta">{table.rows.length}{table.truncated ? '+' : ''} 行</div>
      <table className="process-result-table">
        <thead>
          <tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {table.columns.map((column) => {
                const value = displayValue(row[column])
                return <td key={column}>{value === null ? <span className="null-value">NULL</span> : value}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProcessStep({ item }: { item: AgentProgressEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`${item.status} process-step ${open ? 'open' : ''}`}>
      <button className="process-step-summary" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="process-status">{item.status === 'running' ? <LoaderCircle size={14} className="spin" /> : item.status === 'error' ? <CircleAlert size={14} /> : <Check size={14} />}</span>
        <strong>{item.title}</strong>
        <time>{item.status === 'running' ? '进行中' : formatDuration(item.elapsedMs)}</time>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="process-step-content">
          <pre>{item.detail}</pre>
          {item.queryResult && <ProcessResultTable table={item.queryResult} />}
        </div>
      )}
    </li>
  )
}

export function ResultProcess({ logs }: { logs: AgentProgressEvent[] }) {
  return (
    <ol className="process-steps result-process-steps">
      {logs.map((item) => <ProcessStep key={item.id} item={item} />)}
    </ol>
  )
}
