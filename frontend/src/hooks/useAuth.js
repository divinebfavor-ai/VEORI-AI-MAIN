import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import useAuthStore from '../store/authStore'
import { auth } from '../services/api'

export function useAuth() {
  const { user, isAuthenticated, setAuth, clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const login = async (email, password) => {
    const res = await auth.login(email, password)
    const { token, user: userData } = res.data
    setAuth(userData, token)
    return userData
  }

  const logout = async () => {
    try {
      await auth.logout()
    } catch {
      // ignore logout errors
    }
    clearAuth()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  const register = async (data) => {
    const res = await auth.register(data)
    const { token, user: userData } = res.data
    setAuth(userData, token)
    return userData
  }

  return { user, isAuthenticated, login, logout, register }
}
