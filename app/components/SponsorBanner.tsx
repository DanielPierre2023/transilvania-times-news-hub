'use client'

// Pure CSS sponsor banner for ADD Individual Solutions Ltd.
// Displays in sidebar ad slot while awaiting Google AdSense approval.
// Replace with AdUnit real slot once AdSense is approved.

export default function SponsorBanner() {
  return (
    <a
      href="https://add-individual-solutions.com"
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="block group"
      aria-label="ADD Individual Solutions — AI Solutions Engineered for Impact"
    >
      <div style={{
        width: '100%',
        maxWidth: '300px',
        minHeight: '250px',
        background: 'linear-gradient(160deg, #0D1B4B 0%, #0a1438 60%, #0D1B4B 100%)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 20px 20px',
        cursor: 'pointer',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 32px rgba(13,27,75,0.4)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
        }}
      >
        {/* Amber accent circle — top right */}
        <div style={{
          position: 'absolute',
          top: '-40px',
          right: '-40px',
          width: '140px',
          height: '140px',
          borderRadius: '50%',
          background: 'rgba(240,165,0,0.12)',
          pointerEvents: 'none',
        }} />

        {/* Amber accent circle — bottom left */}
        <div style={{
          position: 'absolute',
          bottom: '-30px',
          left: '-30px',
          width: '100px',
          height: '100px',
          borderRadius: '50%',
          background: 'rgba(240,165,0,0.08)',
          pointerEvents: 'none',
        }} />

        {/* Top: label */}
        <div>
          <p style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            fontWeight: '700',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(240,165,0,0.7)',
            marginBottom: '16px',
          }}>
            Conținut sponsorizat
          </p>

          {/* Headline */}
          <p style={{
            fontFamily: 'Georgia, serif',
            fontSize: '22px',
            fontWeight: '700',
            color: '#ffffff',
            lineHeight: '1.25',
            marginBottom: '12px',
          }}>
            Lucrezi mai mult.<br />
            <span style={{ color: '#F0A500' }}>Produci mai puțin.</span>
          </p>

          {/* Body */}
          <p style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.65)',
            lineHeight: '1.6',
            marginBottom: '20px',
          }}>
            Automatizăm procesele repetitive cu AI și machine learning. Echipa ta se concentrează pe ce contează.
          </p>
        </div>

        {/* Bottom: brand + CTA */}
        <div>
          {/* CTA button */}
          <div style={{
            display: 'inline-block',
            background: '#F0A500',
            color: '#0D1B4B',
            fontFamily: 'Arial, sans-serif',
            fontSize: '11px',
            fontWeight: '700',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '9px 16px',
            marginBottom: '16px',
            transition: 'background 0.2s',
          }}>
            Descoperă soluțiile →
          </div>

          {/* Brand name */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.1)',
            paddingTop: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            {/* ADD logo mark — pure CSS */}
            <div style={{
              width: '28px',
              height: '28px',
              background: '#F0A500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{
                fontFamily: 'Georgia, serif',
                fontSize: '13px',
                fontWeight: '700',
                color: '#0D1B4B',
                lineHeight: 1,
              }}>A</span>
            </div>
            <div>
              <p style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: '11px',
                fontWeight: '700',
                color: '#ffffff',
                lineHeight: '1.2',
              }}>
                ADD Individual Solutions
              </p>
              <p style={{
                fontFamily: 'Arial, sans-serif',
                fontSize: '9px',
                color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.08em',
              }}>
                OUR VISION · YOUR WAY
              </p>
            </div>
          </div>
        </div>
      </div>
    </a>
  )
}
