import { useState } from 'react'

/** Inline editing (Electron does not support window.prompt). */
export function InlineEdit({ value, onSave, multiline = true }: { value: string; onSave: (v: string) => void; multiline?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing)
    return (
      <button
        className="btn-sec px-2 py-0.5 text-xs"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
      >
        Edit
      </button>
    )
  return (
    <div className="flex w-full flex-col gap-1">
      {multiline ? (
        <textarea className="input min-h-16" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input className="input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
      <div className="flex justify-end gap-1">
        <button className="btn-sec px-2 py-0.5 text-xs" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          className="btn px-2 py-0.5 text-xs"
          onClick={() => {
            setEditing(false)
            if (draft.trim() && draft !== value) onSave(draft.trim())
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
