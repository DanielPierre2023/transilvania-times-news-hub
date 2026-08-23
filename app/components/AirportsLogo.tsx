/**
 * Section mark for the Zboruri (flights) tool — an editorial roundel with a
 * climbing aircraft, in the Transilvania Times brand red. Pure inline SVG, no
 * external assets. `className` controls the box size (defaults to h-10 w-10).
 */
export default function AirportsLogo({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Zboruri — Aeroporturile Transilvaniei"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Roundel */}
      <circle cx="24" cy="24" r="22.5" className="fill-brand-red" />
      <circle cx="24" cy="24" r="22.5" className="stroke-black/10" strokeWidth="1" />

      {/* Compass ticks */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line
          key={deg}
          x1="24"
          y1="4.5"
          x2="24"
          y2="7.5"
          stroke="white"
          strokeOpacity="0.55"
          strokeWidth="1.1"
          strokeLinecap="round"
          transform={`rotate(${deg} 24 24)`}
        />
      ))}

      {/* Climbing aircraft */}
      <g transform="rotate(-38 24 24)">
        <path
          d="M23.2 12.5c.5-1.5 2.1-1.5 2.6 0l1.1 8.6 8.4 5.1c.7.4.9 1 .9 1.7v.7c0 .6-.5 1-1.1.8l-8.5-2.6-.5 5.4 2.4 2c.3.2.4.5.4.9v.5c0 .5-.4.8-.9.7l-3.4-1-3.4 1c-.5.1-.9-.2-.9-.7v-.5c0-.4.1-.7.4-.9l2.4-2-.5-5.4-8.5 2.6c-.6.2-1.1-.2-1.1-.8v-.7c0-.7.2-1.3.9-1.7l8.4-5.1 1.1-8.6z"
          fill="white"
        />
      </g>
    </svg>
  )
}
