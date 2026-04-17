import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'

export default function Register() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    company_name: '',
  })
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password || !form.full_name) {
      toast.error('Please fill in all required fields')
      return
    }
    setLoading(true)
    try {
      await register(form)
      toast.success('Account created! Welcome to Veori AI.')
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-2xl mb-5">
            <span className="text-white font-black text-3xl leading-none">V</span>
          </div>
          <h1 className="text-4xl font-black text-text-primary tracking-tight">VEORI AI</h1>
          <p className="text-text-secondary mt-2 text-base">Built to Achieve.</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border-subtle rounded-2xl p-8">
          <h2 className="text-xl font-bold text-text-primary mb-6">Create Account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              placeholder="Smith Real Estate LLC"
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
              placeholder="Create a strong password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
            />
            <Button
              type="submit"
              loading={loading}
              className="w-full mt-2"
              size="lg"
            >
              Create Account
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border-subtle text-center">
            <p className="text-text-secondary text-sm">
              Already have an account?{' '}
              <Link to="/login" className="text-primary hover:text-primary-hover font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
