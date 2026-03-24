'use client'

import { useState } from 'react'
import type { Metadata } from 'next'

// Note: metadata export must be in a server component.
// This page is 'use client' so metadata is declared in a separate layout or via generateMetadata.
// For simplicity we rely on the default metadata template.

const SUBJECTS_RO = [
  'Întrebare generală',
  'Corectură articol',
  'Colaborare / parteneriat',
  'Publicitate',
  'Solicitare GDPR',
  'Eroare tehnică',
  'Altele',
]

const SUBJECTS_EN = [
  'General enquiry',
  'Article correction',
  'Collaboration / partnership',
  'Advertising',
  'GDPR request',
  'Technical issue',
  'Other',
]

export default function ContactPage() {
  const [lang,    setLang]    = useState<'ro' | 'en'>('ro')
  const [form,    setForm]    = useState({ name: '', email: '', subject: '', message: '' })
  const [status,  setStatus]  = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errMsg,  setErrMsg]  = useState('')

  const subjects = lang === 'ro' ? SUBJECTS_RO : SUBJECTS_EN

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.email || !form.subject || !form.message) return
    setStatus('loading')
    setErrMsg('')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setStatus('success')
      setForm({ name: '', email: '', subject: '', message: '' })
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Eroare necunoscută')
      setStatus('error')
    }
  }

  const inp = "w-full border border-foreground/20 bg-background text-foreground font-sans text-sm px-4 py-3 outline-none focus:border-brand-red transition-colors"
  const lbl = "block font-sans text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5"

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 bg-brand-red" />
          <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
            Contact
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
          {lang === 'ro' ? 'Contactați-ne' : 'Contact Us'}
        </h1>
        <p className="font-sans text-muted-foreground leading-relaxed max-w-lg">
          {lang === 'ro'
            ? 'Aveți o întrebare, o corecție sau doriți să colaborați? Scrieți-ne.'
            : 'Have a question, a correction or wish to collaborate? Write to us.'}
        </p>
      </div>

      {/* Language switcher */}
      <div className="flex gap-1 mb-8">
        <button onClick={() => setLang('ro')}
          className={`font-sans text-[11px] uppercase tracking-wider px-4 py-2 border transition-colors ${
            lang === 'ro' ? 'bg-brand-red border-brand-red text-white' : 'border-foreground/20 text-muted-foreground'
          }`}>
          🇷🇴 Română
        </button>
        <button onClick={() => setLang('en')}
          className={`font-sans text-[11px] uppercase tracking-wider px-4 py-2 border transition-colors ${
            lang === 'en' ? 'bg-brand-red border-brand-red text-white' : 'border-foreground/20 text-muted-foreground'
          }`}>
          🇬🇧 English
        </button>
      </div>

      {status === 'success' ? (
        <div className="bg-green-50 border border-green-200 p-8 text-center">
          <p className="font-serif text-xl font-bold text-green-700 mb-2">
            {lang === 'ro' ? 'Mesaj trimis!' : 'Message sent!'}
          </p>
          <p className="font-sans text-sm text-green-600">
            {lang === 'ro'
              ? 'Vă mulțumim. Vom răspunde în cel mai scurt timp posibil.'
              : 'Thank you. We will respond as soon as possible.'}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className={lbl}>
                {lang === 'ro' ? 'Nume complet' : 'Full name'} *
              </label>
              <input
                className={inp}
                type="text"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                placeholder={lang === 'ro' ? 'Numele dvs.' : 'Your name'}
                required
              />
            </div>
            <div>
              <label className={lbl}>Email *</label>
              <input
                className={inp}
                type="email"
                value={form.email}
                onChange={e => update('email', e.target.value)}
                placeholder={lang === 'ro' ? 'adresa@email.com' : 'address@email.com'}
                required
              />
            </div>
          </div>

          <div>
            <label className={lbl}>
              {lang === 'ro' ? 'Subiect' : 'Subject'} *
            </label>
            <select
              className={inp}
              value={form.subject}
              onChange={e => update('subject', e.target.value)}
              required
            >
              <option value="">
                {lang === 'ro' ? '— Selectați subiectul —' : '— Select a subject —'}
              </option>
              {subjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={lbl}>
              {lang === 'ro' ? 'Mesaj' : 'Message'} *
            </label>
            <textarea
              className={inp + ' resize-none leading-relaxed'}
              rows={8}
              value={form.message}
              onChange={e => update('message', e.target.value)}
              placeholder={lang === 'ro'
                ? 'Scrieți mesajul dvs. aici...'
                : 'Write your message here...'}
              required
            />
          </div>

          {status === 'error' && (
            <p className="font-sans text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3">
              {errMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full py-4 bg-brand-red text-white font-sans font-bold uppercase text-sm tracking-widest hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {status === 'loading'
              ? (lang === 'ro' ? 'Se trimite...' : 'Sending...')
              : (lang === 'ro' ? 'Trimite mesajul' : 'Send message')}
          </button>

          <p className="font-sans text-[11px] text-muted-foreground/60 text-center">
            {lang === 'ro'
              ? 'Datele dvs. sunt protejate conform '
              : 'Your data is protected in accordance with our '}
            <a href="/politica-confidentialitate" className="underline hover:text-foreground transition-colors">
              {lang === 'ro' ? 'Politicii de confidențialitate' : 'Privacy Policy'}
            </a>.
          </p>
        </form>
      )}
    </div>
  )
}
