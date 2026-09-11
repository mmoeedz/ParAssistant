import { useEffect, useMemo, useRef, useState } from 'react'
import { Filter, Search, Trash2, Trash } from 'lucide-react'
import { useSession, type ConsoleLine } from '@/store/session'
import { Composer } from '@/components/chat/Composer'
import { AGENT_BY_ID, agentForTool } from '@/types/agents'
import { clockTime, relative } from '@/lib/time'
import './dashboard.css'

type Tab = 'console' | 'logs' | 'memory'

/** Console lines are grouped under the headings from the reference. */
function groupOf(line: ConsoleLine): 'SYSTEM' | 'AGENT' | 'TOOL' | 'RESULT' {
  if (line.source === 'nexus' || line.source === 'transport') {
    return line.text.startsWith('task ') && line.level !== 'info' ? 'RESULT' : 'SYSTEM'
  }
  if (line.source === 'permissions' || line.source === 'memory') return 'SYSTEM'
  return line.level === 'ok' ? 'RESULT' : line.level === 'info' ? 'AGENT' : 'TOOL'
}

export function ConsoleDock() {
  const [tab, setTab] = useState<Tab>('console')
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [errorsOnly, setErrorsOnly] = useState(false)

  const lines = useSession((s) => s.console)
  const messages = useSession((s) => s.messages)
  const facts = useSession((s) => s.memory.facts)
  const memStats = useSession((s) => s.memory.stats)
  const forgetMemory = useSession((s) => s.forgetMemory)
  const clearConsole = useSession((s) => s.clearConsole)

  const endRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return lines.filter((line) => {
      if (errorsOnly && line.level !== 'error' && line.level !== 'warn') return false
      if (!needle) return true
      return `${line.source} ${line.text}`.toLowerCase().includes(needle)
    })
  }, [lines, query, errorsOnly])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [filtered.length, messages.length, tab])

  /**
   * Grouped as in the reference, and a line that repeats — a reconnect loop
   * being the usual one — collapses into a single row with a count, rather
   * than pushing everything else off the panel.
   */
  const grouped = useMemo(() => {
    const out: { group: string; lines: { line: ConsoleLine; repeat: number }[] }[] = []
    for (const line of filtered.slice(-120)) {
      const group = groupOf(line)
      let bucket = out[out.length - 1]
      if (!bucket || bucket.group !== group) {
        bucket = { group, lines: [] }
        out.push(bucket)
      }
      const prev = bucket.lines[bucket.lines.length - 1]
      if (prev && prev.line.source === line.source && prev.line.text === line.text &&
          prev.line.level === line.level) {
        prev.repeat += 1
        prev.line = line // keep the most recent timestamp
      } else {
        bucket.lines.push({ line, repeat: 1 })
      }
    }
    return out
  }, [filtered])

  return (
    <section className="panel dock">
      <header className="dock__head">
        <div className="dock__tabs">
          {(['console', 'logs', 'memory'] as Tab[]).map((name) => (
            <button
              key={name}
              type="button"
              className="dtab"
              data-active={tab === name}
              onClick={() => setTab(name)}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="dock__tools">
          <button type="button" className="iconbtn" data-on={showSearch}
                  onClick={() => setShowSearch(!showSearch)} title="Search">
            <Search size={14} />
          </button>
          <button type="button" className="iconbtn" data-on={errorsOnly}
                  onClick={() => setErrorsOnly(!errorsOnly)} title="Problems only">
            <Filter size={14} />
          </button>
          <button type="button" className="iconbtn" onClick={clearConsole} title="Clear the console">
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {showSearch ? (
        <input
          className="dock__search"
          autoFocus
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}

      <div className="dock__body">
        {tab === 'console' ? (
          grouped.length === 0 ? (
            <p className="panel__blank">
              Nothing yet. Every tool call and its result is logged here as it happens.
            </p>
          ) : (
            grouped.map((block, i) => (
              <div key={i} className="cgroup">
                <div className="cgroup__title">&gt; {block.group}</div>
                {block.lines.map((item) => (
                  <Line key={item.line.id} line={item.line} repeat={item.repeat} />
                ))}
              </div>
            ))
          )
        ) : null}

        {tab === 'logs' ? (
          messages.length === 0 ? (
            <p className="panel__blank">The conversation with NEXUS appears here.</p>
          ) : (
            messages.slice(-60).map((message) => (
              <div key={message.id} className="logline" data-role={message.role}
                   data-error={message.error}>
                <span className="console__time">[{clockTime(message.createdAt)}]</span>
                <span className="logline__who">
                  {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'NEXUS' : 'system'}
                </span>
                <span className="logline__text">{message.text}</span>
              </div>
            ))
          )
        ) : null}

        {tab === 'memory' ? (
          facts.length === 0 ? (
            <p className="panel__blank">
              Nothing remembered yet. NEXUS stores a fact when you ask it to, or when something will
              obviously matter again — and it is all deletable.
            </p>
          ) : (
            <>
              <div className="memhead">
                {memStats ? `${memStats.facts} facts · ${memStats.tasks} tasks` : ''}
              </div>
              {facts.map((fact) => (
                <div key={fact.id} className="memrow">
                  <span className="memrow__kind">{fact.kind}</span>
                  <span className="memrow__body">
                    <b>{fact.key}</b>
                    <span>{fact.value}</span>
                  </span>
                  <span className="memrow__time">{relative(fact.updatedAt)}</span>
                  <button type="button" className="iconbtn" title="Forget this"
                          onClick={() => forgetMemory(fact.id)}>
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </>
          )
        ) : null}

        <div ref={endRef} />
      </div>

      <Composer />
    </section>
  )
}

function Line({ line, repeat = 1 }: { line: ConsoleLine; repeat?: number }) {
  const agent = AGENT_BY_ID[agentForTool(line.source)]
  return (
    <div className="console__row" data-level={line.level}>
      <span className="console__time">[{clockTime(line.at)}]</span>
      <span className="console__src" style={{ color: agent.color }}>
        {line.source}
      </span>
      <span className="console__arrow">→</span>
      <span className="console__text">{line.text}</span>
      {repeat > 1 ? <span className="console__repeat">×{repeat}</span> : null}
    </div>
  )
}
