import { Link } from 'react-router-dom'

export default function Header() {
  return (
    <header style={{
      height: 48,
      backgroundColor: '#2F5496',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 24,
    }}>
      <Link to="/projects" style={{ color: '#fff', textDecoration: 'none', fontWeight: 'bold', fontSize: 16 }}>
        PCM - Process Condition Manager
      </Link>
    </header>
  )
}
