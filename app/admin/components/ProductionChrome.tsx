'use client'

// app/admin/components/ProductionChrome.tsx
//
// The panel and the note, in one place.
//
// Producție and Podcast are now two pages that look the same on purpose: same
// panel, same three levels of note, same monospaced timecodes. Copying the
// markup into the second page would have been quicker today and would have
// produced two surfaces that drift a shade apart every time either is touched —
// which is precisely the kind of difference nobody decides on and nobody can
// defend afterwards.
//
// The markup below is BYTE-FOR-BYTE what Producție already rendered. This is a
// move, not a redesign: extracting shared chrome and restyling it in the same
// commit means any visual change that follows is impossible to attribute.

import type { ReactNode } from 'react'

export const Panel = ({ title, note, children }: { title: string; note?: string; children: ReactNode }) => (
  <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
    <h2 className="font-sans text-[13px] uppercase tracking-widest text-white/70">{title}</h2>
    {note && <p className="mt-1 text-[12px] text-white/40 leading-relaxed max-w-[70ch]">{note}</p>}
    <div className="mt-4">{children}</div>
  </div>
)

export const Note = ({ level, children }: { level: 'info' | 'warn' | 'error'; children: ReactNode }) => (
  <p className={`text-[12px] leading-relaxed px-3 py-2 border ${
    level === 'error' ? 'border-red-500/30 bg-red-500/[0.06] text-red-200/90'
      : level === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200/90'
        : 'border-white/[0.07] bg-black/30 text-white/50'}`}>{children}</p>
)

/** m:ss, because a podcast is discussed in minutes and never in seconds. */
export const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export const uid = () => Math.random().toString(36).slice(2, 10)
