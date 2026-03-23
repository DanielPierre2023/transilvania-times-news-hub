'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Save } from 'lucide-react'

export default function SettingsPage() {
  const [siteName, setSiteName] = useState('Transilvania Times')
  const [siteUrl, setSiteUrl] = useState('https://transilvaniatimes.com')
  const [geminiModel, setGeminiModel] = useState('gemini-1.5-pro')
  const [autoPublish, setAutoPublish] = useState(false)
  const [qualityThreshold, setQualityThreshold] = useState(7)
  const [msg, setMsg] = useState('')

  function save() {
    // Settings are stored as env vars / Supabase config
    // For now save to localStorage as a lightweight approach
    localStorage.setItem('admin_settings', JSON.stringify({
      siteName, siteUrl, geminiModel, autoPublish, qualityThreshold
    }))
    setMsg('✓ Setări salvate')
    setTimeout(() => setMsg(''), 3000)
  }

  useEffect(() => {
    const saved = localStorage.getItem('admin_settings')
    if (saved) {
      const s = JSON.parse(saved)
      if (s.siteName) setSiteName(s.siteName)
      if (s.geminiModel) setGeminiModel(s.geminiModel)
      if (s.autoPublish !== undefined) setAutoPublish(s.autoPublish)
      if (s.qualityThreshold) setQualityThreshold(s.qualityThreshold)
    }
  }, [])

  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors"

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-[#1a1a1a] border border-white/[0.07] p-6 space-y-4">
      <h2 className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">{title}</h2>
      {children}
    </div>
  )

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block font-sans text-[12px] text-white/50 mb-1.5">{label}</label>
      {children}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-white">Setări</h1>
        <div className="flex items-center gap-3">
          {msg && <span className="font-sans text-[12px] text-green-400">{msg}</span>}
          <button
            onClick={save}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Salvează
          </button>
        </div>
      </div>

      <Section title="General">
        <Field label="Numele site-ului">
          <input className={inputCls} value={siteName} onChange={e => setSiteName(e.target.value)} />
        </Field>
        <Field label="URL site">
          <input className={inputCls} value={siteUrl} onChange={e => setSiteUrl(e.target.value)} />
        </Field>
      </Section>

      <Section title="Pipeline AI">
        <Field label="Model Gemini">
          <select className={inputCls} value={geminiModel} onChange={e => setGeminiModel(e.target.value)}>
            <option value="gemini-1.5-pro">gemini-1.5-pro (calitate maximă)</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash (rapid)</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash (cel mai nou)</option>
          </select>
        </Field>
        <Field label={`Prag calitate minimă AI: ${qualityThreshold}/10`}>
          <input
            type="range" min={1} max={10} value={qualityThreshold}
            onChange={e => setQualityThreshold(Number(e.target.value))}
            className="w-full accent-brand-red"
          />
          <div className="flex justify-between font-sans text-[10px] text-white/20 mt-1">
            <span>1 (acceptă tot)</span>
            <span>10 (doar calitate maximă)</span>
          </div>
        </Field>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox" checked={autoPublish}
            onChange={e => setAutoPublish(e.target.checked)}
            className="accent-brand-red w-4 h-4"
          />
          <div>
            <p className="font-sans text-[13px] text-white">Auto-publică după rewriting AI</p>
            <p className="font-sans text-[11px] text-white/30">Articolele care trec pragul de calitate sunt publicate automat</p>
          </div>
        </label>
      </Section>

      <Section title="Informații sistem">
        <div className="space-y-2 font-sans text-[12px]">
          <div className="flex justify-between">
            <span className="text-white/40">Supabase Project</span>
            <span className="text-white/60 font-mono">zimpimoierpsocnmnizm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Netlify Site</span>
            <span className="text-white/60 font-mono">bespoke-unicorn-cefa67</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Next.js</span>
            <span className="text-white/60">15.5.14</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Funcții Supabase</span>
            <span className="text-white/60">19 active</span>
          </div>
        </div>
      </Section>
    </div>
  )
}
