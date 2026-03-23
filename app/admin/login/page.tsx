'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (authError) {
      setError('Credențiale incorecte. Verificați email-ul și parola.')
      setLoading(false)
      return
    }

    router.push('/admin/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-serif text-3xl font-bold text-white tracking-tight">
            Transilvania Times
          </h1>
          <p className="text-white/50 font-sans text-xs uppercase tracking-widest mt-2">
            Editorial Admin
          </p>
        </div>

        {/* Form */}
        <div className="bg-white/[0.04] border border-white/10 p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/50 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-white/[0.06] border border-white/10 text-white font-sans text-sm px-4 py-3 outline-none focus:border-brand-red transition-colors placeholder:text-white/20"
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/50 mb-2">
                Parolă
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-white/[0.06] border border-white/10 text-white font-sans text-sm px-4 py-3 outline-none focus:border-brand-red transition-colors placeholder:text-white/20"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="font-sans text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-widest py-3 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Se autentifică...' : 'Autentificare'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 font-sans text-[11px] mt-6">
          © {new Date().getFullYear()} ADD Individual Solutions Ltd.
        </p>
      </div>
    </div>
  )
}
