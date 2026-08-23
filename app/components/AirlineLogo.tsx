'use client'

import { useState } from 'react'
import { airlineCode, airlineColor } from '@/lib/flights'

/**
 * Real airline logo with a guaranteed fallback.
 *
 * Loads the carrier logo from a logo CDN by IATA code; if the code isn't a
 * 2-letter IATA designator or the image fails to load, it falls back to a
 * coloured monogram chip so a row is never blank.
 *
 * To self-host instead of hotlinking, drop files at public/airlines/{CODE}.png
 * and set LOGO_CDN = '/airlines'.
 */
const LOGO_CDN = 'https://images.kiwi.com/airlines/64'

export default function AirlineLogo({ flightNo, className = '' }: { flightNo: string; className?: string }) {
  const code = airlineCode(flightNo)
  const isIata = /^[A-Z0-9]{2}$/.test(code)
  const [err, setErr] = useState(false)

  // Fixed 28px box for every carrier: the CDN's 64×64 files vary in internal
  // padding (some glyphs fill the square, some don't), so a uniform, larger
  // canvas keeps all logos legible and visually consistent across airports.
  if (err || !isIata) {
    return (
      <span className={`inline-flex h-7 w-9 items-center justify-center shrink-0 ${className}`} aria-hidden="true">
        <span
          className="inline-flex items-center justify-center h-6 min-w-[34px] px-1.5 rounded-sm font-mono text-[12px] font-bold text-white"
          style={{ backgroundColor: airlineColor(flightNo) }}
        >
          {code}
        </span>
      </span>
    )
  }

  return (
    <span className={`inline-flex h-7 w-9 items-center justify-center shrink-0 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${LOGO_CDN}/${code}.png`}
        alt=""
        width={28}
        height={28}
        loading="lazy"
        onError={() => setErr(true)}
        className="h-7 w-7 object-contain"
      />
    </span>
  )
}
