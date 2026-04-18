import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'

export default function Register() {
  const [form, setForm]     = useState({ full_name: '', email: '', password: '', company_name: '' })
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name || !form.email || !form.password) {
      toast.error('Please fill in all required fields')
      return
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      await register(form)
      toast.success('Account created!')
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      {/* Wordmark */}
      <div className="mb-8 text-center">
        <p className="text-[28px] font-light text-white tracking-tight">Veori</p>
        <p className="text-[13px] text-text-muted mt-1">Built to Achieve.</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-[420px] bg-card border border-border-subtle rounded-[12px] p-10">
        <h1 className="text-[22px] font-medium text-white mb-2">Create account</h1>
        <p className="text-[13px] text-text-muted mb-8">Start closing deals autonomously.</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Full Name"
            type="text"
            placeholder="John Smith"
            value={form.full_name}
            onChange={set('full_name')}
            autoComplete="name"
          />
          <Input
            label="Company Name"
            type="text"
            placeholder="Smith Acquisitions"
            value={form.company_name}
            onChange={set('company_name')}
          />
          <Input
            label="Email"
            type="email"
            placeholder="you@company.com"
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            placeholder="Minimum 8 characters"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
          />
          <Button type="submit" loading={loading} className="w-full mt-2" size="md">
            Create Account
          </Button>
        </form>

        <p className="text-center text-[13px] text-text-muted mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:text-primary-hover transition-colors font-medium">
            Sign in
          </Link>
        </p>
      </div>

      <p className="mt-8 text-[11px] text-text-muted">
        veori.net · Autonomous Real Estate Acquisitions
      </p>
    </div>
  )
}
