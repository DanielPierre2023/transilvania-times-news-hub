// app/components/FollowUs.tsx
import { Facebook, Twitter, Linkedin, Rss } from 'lucide-react'
import SectionHeader from './SectionHeader'

interface Props {
  locale?: 'ro' | 'en'
}

// EDIT THESE URLs to match your actual social accounts.
const SOCIAL = {
  facebook:   'https://www.facebook.com/transilvaniatimes',
  twitter:    'https://twitter.com/TransilvaniaTms',
  linkedin:   'https://www.linkedin.com/company/transilvania-times',
  rss:        '/rss.xml',
  googleNews: 'https://www.google.com/preferences/source?q=transilvaniatimes.com',
}

const ICON_CLASS =
  'w-10 h-10 flex items-center justify-center border border-foreground/15 ' +
  'hover:border-brand-red hover:text-brand-red text-muted-foreground transition-colors'

function GoogleNewsLogo() {
  return (
    <span className="font-sans font-medium text-[15px] inline-flex items-center leading-none">
      <span style={{ color: '#4285F4' }}>G</span>
      <span style={{ color: '#EA4335' }}>o</span>
      <span style={{ color: '#FBBC05' }}>o</span>
      <span style={{ color: '#4285F4' }}>g</span>
      <span style={{ color: '#34A853' }}>l</span>
      <span style={{ color: '#EA4335' }}>e</span>
      <span className="ml-1.5 text-foreground">News</span>
    </span>
  )
}

export default function FollowUs({ locale = 'ro' }: Props) {
  const label = locale === 'ro' ? 'Urmărește-ne' : 'Follow us'

  return (
    <div className="mt-10 pt-6 border-t border-foreground/10">
      <SectionHeader className="mb-4">{label}</SectionHeader>
      <div className="flex items-center gap-2 flex-wrap">
        <a href={SOCIAL.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className={ICON_CLASS}>
          <Facebook className="w-4 h-4" />
        </a>
        <a href={SOCIAL.twitter} target="_blank" rel="noopener noreferrer" aria-label="Twitter / X" className={ICON_CLASS}>
          <Twitter className="w-4 h-4" />
        </a>
        <a href={SOCIAL.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className={ICON_CLASS}>
          <Linkedin className="w-4 h-4" />
        </a>
        <a href={SOCIAL.rss} target="_blank" rel="noopener noreferrer" aria-label="RSS feed" className={ICON_CLASS}>
          <Rss className="w-4 h-4" />
        </a>
        <a href={SOCIAL.googleNews} target="_blank" rel="noopener noreferrer" aria-label="Google News" className="flex items-center gap-2 px-4 h-10 border border-foreground/15 hover:border-brand-red hover:text-brand-red transition-colors">
          <GoogleNewsLogo />
        </a>
      </div>
    </div>
  )
}
