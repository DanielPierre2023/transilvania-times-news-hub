// app/components/SectionHeader.tsx
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  accent?: 'red' | 'dark'
  className?: string
}

export default function SectionHeader({ children, accent = 'red', className = '' }: Props) {
  const color = accent === 'red' ? 'text-brand-red' : 'text-foreground'
  return (
    <div className={`font-sans font-bold text-[11px] uppercase tracking-[0.2em] ${color} ${className}`}>
      {children}
    </div>
  )
}
