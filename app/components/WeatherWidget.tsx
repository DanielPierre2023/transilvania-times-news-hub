'use client'

import { useState, useEffect } from 'react'
import { Sun, Cloud } from 'lucide-react'

export default function WeatherWidget() {
  const [temp, setTemp] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=46.7712&longitude=23.6236&current_weather=true')
      .then(r => r.json())
      .then(d => {
        setTemp(Math.round(d.current_weather.temperature))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading || temp === null) return null

  return (
    <div className="flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-wider text-foreground border-l border-foreground/10 pl-4 ml-4">
      {temp > 15
        ? <Sun size={13} className="text-brand-red" />
        : <Cloud size={13} className="text-muted-foreground" />
      }
      <span>{temp}°C</span>
      <span className="text-muted-foreground font-medium hidden sm:inline">Cluj-Napoca</span>
    </div>
  )
}
