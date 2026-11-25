import { useEffect, useRef, useState } from 'react'

export interface MenuEntry {
  label?: string
  shortcut?: string
  onClick?: () => void
  disabled?: boolean
  divider?: boolean
  section?: string
}

export function Menu({
  label,
  items,
  align = 'left',
}: {
  label: string
  items: MenuEntry[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`menu-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className={`menu-pop menu-${align}`}>
          {items.map((item, index) => {
            if (item.divider) return <div className="menu-divider" key={`d${index}`} />
            if (item.section)
              return (
                <div className="menu-section" key={`s${index}`}>
                  {item.section}
                </div>
              )
            return (
              <button
                type="button"
                className="menu-item"
                key={`i${index}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick?.()
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
