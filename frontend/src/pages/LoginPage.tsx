import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/atoms/Button';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (!res.ok) throw new Error('Invalid credentials');
      
      const data = await res.json();
      login(data.access_token, data.account);
      navigate('/workspace-select');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login gagal');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--simprok-surface-light)' }}>
      <form onSubmit={handleLogin} style={{ backgroundColor: 'var(--simprok-white)', padding: 'var(--space-8)', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', textAlign: 'center', margin: 0 }}>SIMPROK</h1>
        <p style={{ textAlign: 'center', color: 'var(--simprok-engineering-blue-600)', margin: '0 0 var(--space-4) 0' }}>Project Intelligence Platform</p>
        
        {error && <div style={{ color: 'var(--simprok-critical-red-600)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>{error}</div>}
        
        <input 
          type="email" 
          placeholder="Email" 
          value={email} 
          onChange={e => setEmail(e.target.value)}
          style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--simprok-engineering-blue-200)' }}
          required
        />
        <input 
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={e => setPassword(e.target.value)}
          style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--simprok-engineering-blue-200)' }}
          required
        />
        <Button type="submit">Access Secure Environment</Button>
      </form>
    </div>
  );
}
