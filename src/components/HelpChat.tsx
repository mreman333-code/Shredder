import { useCallback, useEffect, useRef, useState } from 'react'
import { SUGGESTED_QUESTIONS, answerHelp, type HelpSuggestion } from '../help'
import { IconChat, IconSend } from './Icons'

interface HelpChatProps {
  /** Set from the Help menu or the empty-scene card to ask immediately. */
  seed?: { id: string; question?: string } | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'guide'
  text: string
  related?: HelpSuggestion[]
}

const WELCOME =
  'Hi — I’m the Shredder guide. Ask me anything about how this app works: importing models, ' +
  'characters, moving things around, saving, exporting or shortcuts.\n\n' +
  'I only answer questions — I never change your scene.'

let messageCounter = 0
const nextId = (prefix: string) => {
  messageCounter += 1
  return `${prefix}-${messageCounter}`
}

export function HelpChat({ seed }: HelpChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: 'welcome', role: 'guide', text: WELCOME, related: SUGGESTED_QUESTIONS },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const ask = useCallback((raw: string) => {
    const question = raw.trim()
    if (!question) return
    setInput('')
    setThinking(true)
    setMessages((current) => [
      ...current,
      { id: nextId('u'), role: 'user', text: question },
    ])

    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      const reply = answerHelp(question)
      setMessages((current) => [
        ...current,
        { id: nextId('g'), role: 'guide', text: reply.text, related: reply.related },
      ])
      setThinking(false)
      inputRef.current?.focus()
    }, 220)
  }, [])

  // Questions sent from the Help menu appear in the conversation immediately.
  useEffect(() => {
    if (seed?.question) ask(seed.question)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.id])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, thinking])

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  return (
    <div className="help-chat">
      <header className="hc-head">
        <span className="hc-avatar" aria-hidden="true">
          <IconChat size={15} />
        </span>
        <div>
          <div className="section-title">Shredder guide</div>
          <div className="panel-hint tight">Built-in answers · works offline · never edits your scene</div>
        </div>
      </header>

      <div className="hc-messages" ref={listRef} aria-live="polite">
        {messages.map((message) => (
          <div className={`hc-message ${message.role}`} key={message.id}>
            <div className="hc-bubble">{message.text}</div>
            {message.related && message.related.length > 0 && (
              <div className="hc-related">
                {message.related.slice(0, 4).map((suggestion) => (
                  <button
                    type="button"
                    className="hc-chip"
                    key={`${message.id}-${suggestion.label}`}
                    onClick={() => ask(suggestion.question)}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="hc-message guide">
            <div className="hc-bubble hc-typing" aria-label="The guide is answering">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <form
        className="hc-form"
        onSubmit={(event) => {
          event.preventDefault()
          ask(input)
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="Ask how something works…"
          aria-label="Ask the Shredder guide"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              ask(input)
            }
          }}
        />
        <button
          type="submit"
          className="hc-send"
          disabled={!input.trim()}
          title="Send question"
          aria-label="Send question"
        >
          <IconSend size={16} />
        </button>
      </form>
      <div className="hc-note">Answers come from help built into Shredder. No account or internet needed.</div>
    </div>
  )
}
