// app/components/GoogleNewsBadge.tsx
interface Props {
  locale?: 'ro' | 'en'
  variant?: 'top' | 'inline'
}

const URL = 'https://www.google.com/preferences/source?q=transilvaniatimes.com'

export default function GoogleNewsBadge({ locale = 'ro', variant = 'inline' }: Props) {
  const label =
    locale === 'ro'
      ? 'Adaugă Transilvania Times ca sursă preferată pe Google'
      : 'Add Transilvania Times as a preferred source on Google'

  const subtitle =
    locale === 'ro'
      ? 'Vezi articolele noastre în Discover și Search.'
      : 'See our articles in Google Discover and Search.'

  const isTop = variant === 'top'

  return (
    
      href={URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group not-prose flex items-center gap-3 border px-4 py-3 my-6 no-underline transition-colors ${
        isTop
          ? 'border-brand-red/30 bg-brand-red/5 hover:bg-brand-red/10'
          : 'border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.05]'
      }`}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.5c2-1.9 3.3-4.7 3.3-7.8z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.8C3.8 20.5 7.6 23 12 23z" />
        <path fill="#FBBC05" d="M5.7 14.1c-.2-.7-.4-1.4-.4-2.1 0-.7.1-1.4.4-2.1V7H2C1.4 8.5 1 10.2 1 12s.4 3.5 1 5l3.7-2.9z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.1-3.1C17.4 2.1 14.9 1 12 1 7.6 1 3.8 3.5 2 7l3.7 2.8C6.6 7.2 9.1 5.4 12 5.4z" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="font-sans text-sm font-semibold text-foreground group-hover:text-brand-red leading-snug">
          {label}
        </div>
        <div className="font-sans text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="text-muted-foreground group-hover:text-brand-red shrink-0"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
          clipRule="evenodd"
        />
      </svg>
    </a>
  )
}
