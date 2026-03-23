'use client'

import { useState } from 'react'
import { Facebook, Twitter, Linkedin, Link2, Check } from 'lucide-react'

interface ShareButtonsProps {
  url: string
  title: string
  summary?: string
}

export default function ShareButtons({ url, title, summary = '' }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false)

  const encodedUrl     = encodeURIComponent(url)
  const encodedTitle   = encodeURIComponent(title)
  const encodedSummary = encodeURIComponent(summary.substring(0, 200))

  const shares = [
    {
      label: 'Facebook',
      Icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      color: 'hover:bg-[#1877F2] hover:border-[#1877F2]',
    },
    {
      label: 'X / Twitter',
      Icon: Twitter,
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      color: 'hover:bg-black hover:border-black',
    },
    {
      label: 'LinkedIn',
      Icon: Linkedin,
      href: `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedTitle}&summary=${encodedSummary}`,
      color: 'hover:bg-[#0A66C2] hover:border-[#0A66C2]',
    },
    {
      label: 'WhatsApp',
      Icon: () => (
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ),
      href: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
      color: 'hover:bg-[#25D366] hover:border-[#25D366]',
    },
  ]

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 my-8 py-6 border-t border-b border-foreground/10">
      <span className="text-[11px] font-sans font-bold uppercase tracking-widest text-muted-foreground mr-2">
        Distribuie
      </span>

      {shares.map(({ label, Icon, href, color }) => (
        
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Distribuie pe ${label}`}
          className={`
            inline-flex items-center gap-1.5 px-3 py-1.5
            border border-foreground/20 text-foreground/70
            text-[11px] font-sans font-bold uppercase tracking-wider
            transition-all duration-200 hover:text-white
            ${color}
          `}
        >
          <Icon className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </a>
      ))}

      <button
        onClick={copyLink}
        aria-label="Copiază link"
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5
          border transition-all duration-200
          text-[11px] font-sans font-bold uppercase tracking-wider
          ${copied
            ? 'border-green-500 bg-green-500 text-white'
            : 'border-foreground/20 text-foreground/70 hover:border-brand-red hover:text-brand-red'
          }
        `}
      >
        {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
        <span className="hidden sm:inline">{copied ? 'Copiat!' : 'Link'}</span>
      </button>
    </div>
  )
}
