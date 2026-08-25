'use client'

import { useState } from 'react'
import { airlineCode, airlineColor } from '@/lib/flights'

/**
 * Airline logo with uniform visual weight and a guaranteed fallback chain:
 *
 *   1. Daisycon wordmark (normalized: every logo fills the requested canvas,
 *      transparent background, CORS-friendly) — for carriers verified to have
 *      a real logo there (the service returns a placeholder for the rest).
 *   2. Kiwi 64px square by IATA code — full coverage, but files vary in
 *      internal padding, so padded ones get a per-code zoom for parity.
 *   3. Coloured monogram chip — never a blank cell.
 *
 * `wide` renders a 76×28 wordmark box (the flight board); default is the
 * compact 36×28 box (homepage widget).
 */
const DAISY = new Set(['W6', 'OS', 'FR', 'TK', 'RO', 'GQ', 'LH', 'LO', 'LX', 'PC', 'DY', 'A3'])
// Same brand, different AOC: Wizz Air Malta (W4) flies the WIZZ livery (W6).
const DAISY_ALIAS: Record<string, string> = { W4: 'W6' }
// Kiwi files with big internal padding → scale up to match full-bleed ones.
const KIWI_ZOOM: Record<string, number> = {
  W4: 1.4, W6: 1.15, OS: 1.4, RO: 1.2, H4: 1.3, NE: 1.35, XC: 1.4, SM: 1.2, U5: 1.2, TI: 1.15,
}

function sources(code: string, wide: boolean): string[] {
  const d = DAISY_ALIAS[code] ?? code
  const out: string[] = []
  if (DAISY.has(d)) {
    out.push(
      wide
        ? `https://images.daisycon.io/airline/?width=152&height=56&color=transparent&iata=${d}`
        : `https://images.daisycon.io/airline/?width=72&height=56&color=transparent&iata=${d}`,
    )
  }
  out.push(`https://images.kiwi.com/airlines/64/${code}.png`)
  return out
}

export default function AirlineLogo({
  flightNo,
  wide = false,
  large = false,
  className = '',
}: {
  flightNo: string
  wide?: boolean
  large?: boolean
  className?: string
}) {
  const code = airlineCode(flightNo)
  const isIata = /^[A-Z0-9]{2}$/.test(code)
  const [idx, setIdx] = useState(0)

  const box = large
    ? (wide
        ? 'inline-flex h-10 w-[92px] items-center justify-start shrink-0'
        : 'inline-flex h-10 w-12 items-center justify-center shrink-0')
    : (wide
        ? 'inline-flex h-7 w-[76px] items-center justify-start shrink-0'
        : 'inline-flex h-7 w-9 items-center justify-center shrink-0')

  const srcs = isIata ? sources(code, wide) : []
  const src = srcs[idx]

  if (!src) {
    return (
      <span className={`${box} ${className}`} aria-hidden="true">
        <span
          className={`inline-flex items-center justify-center rounded-sm font-mono font-bold text-white ${
            large ? 'h-9 min-w-[46px] px-2 text-[15px]' : 'h-6 min-w-[34px] px-1.5 text-[12px]'}`}
          style={{ backgroundColor: airlineColor(flightNo) }}
        >
          {code}
        </span>
      </span>
    )
  }

  const isKiwi = src.includes('images.kiwi.com')
  const zoom = isKiwi ? (KIWI_ZOOM[code] ?? 1) : 1

  return (
    <span className={`${box} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt=""
        width={wide && !isKiwi ? (large ? 92 : 76) : (large ? 40 : 28)}
        height={large ? 40 : 28}
        loading="lazy"
        onError={() => setIdx((i) => i + 1)}
        className={
          wide && !isKiwi
            ? (large ? 'h-10 w-[92px] object-contain object-left' : 'h-7 w-[76px] object-contain object-left')
            : (large ? 'h-10 w-10 object-contain' : 'h-7 w-7 object-contain')
        }
        style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: wide ? 'left center' : 'center' } : undefined}
      />
    </span>
  )
}
