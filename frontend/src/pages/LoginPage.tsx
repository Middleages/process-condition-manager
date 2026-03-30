import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/useAuthStore'
import { Button } from '@/components/ui/button'

const isDevMode = import.meta.env.DEV

export default function LoginPage() {
  const { login, isLoading, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    if (isLoading) {
      return
    }

    if (isAuthenticated) {
      const redirect = searchParams.get('redirect') || '/projects'
      navigate(redirect, { replace: true })
      return
    }

    if (!isDevMode) {
      void login()
    }
  }, [isAuthenticated, isLoading, login, navigate, searchParams])


  const handleLoginClick = async () => {
    await login()
  }

  const handleDevLoginClick = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/api/auth/dev-login'
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 border rounded-lg shadow-sm bg-card">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">PCM 로그인</h1>
          <p className="text-sm text-muted-foreground">사내 통합인증으로 로그인합니다.</p>
        </div>

        <Button type="button" className="w-full" disabled={isLoading} onClick={handleLoginClick}>
          통합인증 로그인
        </Button>

        {isDevMode && (
          <Button type="button" variant="outline" className="w-full" onClick={handleDevLoginClick}>
            개발용 로그인
          </Button>
        )}
      </div>
    </div>
  )
}
