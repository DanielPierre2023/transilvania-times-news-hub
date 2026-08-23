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

  if (err || !isIata) {
    return (
      <span
        className={`inline-flex items-center justify-center h-5 min-w-[30px] px-1.5 rounded-sm font-mono text-[11px] font-bold text-white ${className}`}
        style={{ backgroundColor: airlineColor(flightNo) }}
        aria-hidden="true"
      >
        {code}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${LOGO_CDN}/${code}.png`}
      alt=""
      width={46}
      height={20}
      loading="lazy"
      onError={() => setErr(true)}
      className={`h-5 w-auto max-w-[46px] object-contain ${className}`}
    />
  )
}
