'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      addToast('Welcome back!', 'success');
    } catch (err) {
      addToast(err.message || 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100vw',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-login-gradient)',
      color: 'var(--text-primary)',
      padding: '20px',
      overflowY: 'auto'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        
        {/* Brand Logo */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            display: 'inline-flex',
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, hsl(250, 91%, 55%), hsl(280, 80%, 60%))',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            boxShadow: 'var(--shadow-glow)',
            marginBottom: '12px'
          }}>⚡</div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, tracking: '-0.025em', margin: 0 }}>Action Center AI</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '6px' }}>B2B Enterprise Portal</p>
        </div>

        {/* Card */}
        <div className="glass-card" style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          padding: '32px',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-elevated)',
          backdropFilter: 'blur(16px)'
        }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '20px', color: 'var(--text-primary)' }}>Login to your organization</h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Work Email</label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                background: 'var(--accent-gradient)',
                color: '#fff',
                padding: '13px',
                borderRadius: '10px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: '0 4px 12px hsla(250, 91%, 55%, 0.15)',
                marginTop: '6px',
                transition: 'opacity 0.2s'
              }}
            >
              {submitting ? 'Authenticating…' : 'Sign In'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            New to Action Center?{' '}
            <Link href="/register" style={{ color: 'var(--text-accent)', fontWeight: 600 }}>
              Register Organization
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
