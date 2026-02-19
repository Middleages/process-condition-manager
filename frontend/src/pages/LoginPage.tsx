import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { login, isLoading, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // If already authenticated, redirect away from login
  useEffect(() => {
    if (isAuthenticated) {
      const redirect = searchParams.get('redirect') || '/projects'
      navigate(redirect, { replace: true })
    }
  }, [isAuthenticated, navigate, searchParams])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setErrorMessage(null)

    try {
      await login(username, password)
      const redirect = searchParams.get('redirect') || '/projects'
      navigate(redirect, { replace: true })
    } catch {
      setErrorMessage('아이디 또는 비밀번호가 올바르지 않습니다.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border rounded-lg shadow-sm bg-card">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">PCM 로그인</h1>
          <p className="text-sm text-muted-foreground">Process Condition Manager</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              아이디
            </label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              placeholder="아이디를 입력하세요"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              비밀번호
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              placeholder="비밀번호를 입력하세요"
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md"
            >
              {errorMessage}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? '로그인 중...' : '로그인'}
          </Button>
        </form>
      </div>
    </div>
  )
}
