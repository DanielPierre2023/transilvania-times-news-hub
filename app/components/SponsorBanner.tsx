'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

interface Banner {
  id: string
  advertiser_name: string
  headline_ro: string
  headline_en: string
  body_ro: string
  body_en: string
  cta_ro: string
  cta_en: string
  url: string
  image_url: string | null
  bg_color: string
  accent_color: string
}

interface SponsorBannerProps {
  slot?: string
}

export default function SponsorBanner({ slot = 'sidebar-homepage' }: SponsorBannerProps) {
  const pathname = usePathname()
  const isEn = pathname?.startsWith('/en')
  const [banner, setBanner] = useState<Banner | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function fetchBanner() {
      const { data } = await supabase
        .from('sponsor_banners')
        .select('id, advertiser_name, headline_ro, headline_en, body_ro, body_en, cta_ro, cta_en, url, image_url, bg_color, accent_color, weight')
        .eq('slot', slot)
        .eq('is_active', true)
        .or('start_date.is.null,start_date.lte.' + new Date().toISOString().split('T')[0])
        .or('end_date.is.null,end_date.gte.' + new Date().toISOString().split('T')[0])

      if (data && data.length > 0) {
        // Weighted random selection
        const totalWeight = data.reduce((sum, b) => sum + (b.weight || 1), 0)
        let random = Math.random() * totalWeight
        let selected = data[0]
        for (const b of data) {
          random -= (b.weight || 1)
          if (random <= 0) { selected = b; break }
        }
        setBanner(selected)

        // Log impression (fire and forget)
        supabase.rpc('increment_banner_impressions', { banner_id: selected.id }).then(() => {})
      }
      setLoading(false)
    }
    fetchBanner()
  }, [slot]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleClick() {
    if (!banner) return
    await supabase.rpc('increment_banner_clicks', { banner_id: banner.id })
  }

  // No active sponsor — show ADD fallback
  if (!loading && !banner) {
    return <AddFallback isEn={isEn ?? false} />
  }

  if (!banner) return null

  const headline = isEn ? banner.headline_en : banner.headline_ro
  const body     = isEn ? banner.body_en     : banner.body_ro
  const cta      = isEn ? banner.cta_en      : banner.cta_ro
  const bg       = banner.bg_color    || '#0D1B4B'
  const accent   = banner.accent_color || '#F0A500'

  return (
    <a
      href={banner.url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={handleClick}
      className="block"
      aria-label={banner.advertiser_name}
    >
      {banner.image_url ? (
        <div className="w-full overflow-hidden">
          <img src={banner.image_url} alt={banner.advertiser_name} className="w-full h-auto object-cover" />
        </div>
      ) : (
        <BannerCSS headline={headline} body={body} cta={cta} advertiser={banner.advertiser_name} bg={bg} accent={accent} isEn={isEn ?? false} />
      )}
    </a>
  )
}

// ── CSS banner renderer ────────────────────────────────────────────────────
function BannerCSS({ headline, body, cta, advertiser, bg, accent, isEn }: {
  headline: string; body: string; cta: string
  advertiser: string; bg: string; accent: string; isEn: boolean
}) {
  return (
    <div style={{
      width: '100%', maxWidth: '300px', minHeight: '250px',
      background: `linear-gradient(160deg, ${bg} 0%, ${bg}cc 60%, ${bg} 100%)`,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: '24px 20px 20px', cursor: 'pointer',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 32px ${bg}66`
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
      }}
    >
      {/* Accent circles */}
      <div style={{ position:'absolute', top:'-40px', right:'-40px', width:'140px', height:'140px', borderRadius:'50%', background:`${accent}1f`, pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'-30px', left:'-30px', width:'100px', height:'100px', borderRadius:'50%', background:`${accent}14`, pointerEvents:'none' }} />

      <div>
        <p style={{ fontFamily:'Arial,sans-serif', fontSize:'9px', fontWeight:'700', letterSpacing:'0.18em', textTransform:'uppercase', color:`${accent}b3`, marginBottom:'16px' }}>
          {isEn ? 'Sponsored content' : 'Conținut sponsorizat'}
        </p>
        <p style={{ fontFamily:'Georgia,serif', fontSize:'20px', fontWeight:'700', color:'#ffffff', lineHeight:'1.25', marginBottom:'12px' }}
          dangerouslySetInnerHTML={{ __html: headline.replace('\n', '<br/>') }} />
        <p style={{ fontFamily:'Arial,sans-serif', fontSize:'12px', color:'rgba(255,255,255,0.65)', lineHeight:'1.6', marginBottom:'20px' }}>
          {body}
        </p>
      </div>

      <div>
        <div style={{ display:'inline-block', background:accent, color:bg, fontFamily:'Arial,sans-serif', fontSize:'11px', fontWeight:'700', letterSpacing:'0.1em', textTransform:'uppercase', padding:'9px 16px', marginBottom:'16px' }}>
          {cta}
        </div>
        <div style={{ borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:'12px', display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{ width:'28px', height:'28px', background:accent, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ fontFamily:'Georgia,serif', fontSize:'13px', fontWeight:'700', color:bg, lineHeight:1 }}>
              {advertiser.charAt(0).toUpperCase()}
            </span>
          </div>
          <p style={{ fontFamily:'Arial,sans-serif', fontSize:'11px', fontWeight:'700', color:'#ffffff', lineHeight:'1.2', margin:0 }}>
            {advertiser}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── ADD Individual Solutions fallback ─────────────────────────────────────
function AddFallback({ isEn }: { isEn: boolean }) {
  const copy = isEn ? {
    label: 'Sponsored content',
    headline: 'Working more.\nDelivering less.',
    body: 'We automate repetitive processes with AI and machine learning. Your team focuses on what matters.',
    cta: 'Discover our solutions →',
  } : {
    label: 'Conținut sponsorizat',
    headline: 'Lucrezi mai mult.\nProduci mai puțin.',
    body: 'Automatizăm procesele repetitive cu AI și machine learning. Echipa ta se concentrează pe ce contează.',
    cta: 'Descoperă soluțiile →',
  }

  return (
    <a href="https://add-individual-solutions.com" target="_blank" rel="noopener noreferrer sponsored" className="block">
      <BannerCSS
        headline={copy.headline} body={copy.body} cta={copy.cta}
        advertiser="ADD Individual Solutions" bg="#0D1B4B" accent="#F0A500" isEn={isEn}
      />
    </a>
  )
}
