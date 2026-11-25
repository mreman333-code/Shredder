import type { AiLogEntry, AiSessionView } from '../ai'
import { aiSessionLabel, formatAiArgs } from '../ai'

interface AiPanelProps {
  entries: AiLogEntry[]
  sessions: AiSessionView[]
  paused: boolean
  desktop: boolean
  onTogglePause: () => void
  onRevert: (sessionId: string) => void
  onClear: () => void
}

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function AiPanel({
  entries,
  sessions,
  paused,
  desktop,
  onTogglePause,
  onRevert,
  onClear,
}: AiPanelProps) {
  const groups = sessions
    .map((session) => ({ session, items: entries.filter((entry) => entry.session === session.id) }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <div>
          <div className="section-title">AI actions</div>
          <div className="panel-hint tight">
            {paused
              ? 'Paused — bridge calls are refused until you resume.'
              : 'Bridge and MCP calls appear here with their arguments and results.'}
          </div>
        </div>
        <button
          type="button"
          className={`ai-toggle ${paused ? 'on' : ''}`}
          onClick={onTogglePause}
          disabled={!desktop}
          aria-pressed={paused}
          title={
            desktop
              ? paused
                ? 'Resume the AI bridge'
                : 'Pause the AI bridge (calls return 423)'
              : 'The AI bridge only runs in the desktop app'
          }
        >
          <span className="ai-toggle-knob" />
          {paused ? 'Paused' : 'Live'}
        </button>
      </div>

      {!desktop && (
        <div className="panel-hint">
          The bridge runs in the desktop app. In this browser preview no model can call the tools,
          so the log stays empty.
        </div>
      )}

      {groups.length === 0 && (
        <div className="ai-empty">
          {desktop
            ? 'No AI calls yet. Point a model at the bridge endpoint or the MCP server and every call will show up here.'
            : 'No AI calls in this preview.'}
        </div>
      )}

      {groups.map(({ session, items }) => (
        <section className="ai-session" key={session.id}>
          <header className="ai-session-head">
            <div>
              <span className="ai-session-title">{aiSessionLabel(session.id)}</span>
              <span className="ai-session-meta">
                {session.calls} {session.calls === 1 ? 'call' : 'calls'} ·{' '}
                {timeOf(session.startedAt)}
              </span>
            </div>
            <button
              type="button"
              className="btn ghost ai-revert"
              onClick={() => onRevert(session.id)}
              disabled={session.reverted || session.calls === 0}
              title="Restore the project to how it was before this session's first call"
            >
              {session.reverted ? 'Reverted' : 'Revert'}
            </button>
          </header>

          {items.map((entry) => (
            <details key={entry.id} className={`ai-entry ${entry.status}`}>
              <summary>
                <span className={`ai-status-dot ${entry.status}`} />
                <span className="ai-entry-tool">{entry.tool}</span>
                <span className="ai-entry-time">{timeOf(entry.at)}</span>
                <span className="ai-entry-ms">{entry.ms} ms</span>
              </summary>
              <div className="ai-entry-body">
                <div className="ai-entry-label">Arguments</div>
                <code className="ai-entry-json">{formatAiArgs(entry.args)}</code>
                <div className="ai-entry-label">
                  {entry.status === 'ok' ? 'Result' : 'Error'}
                </div>
                <code className="ai-entry-json">{entry.summary}</code>
              </div>
            </details>
          ))}
        </section>
      ))}

      {entries.length > 0 && (
        <button type="button" className="btn ghost wide ai-clear" onClick={onClear}>
          Clear log and revert points
        </button>
      )}
    </div>
  )
}
