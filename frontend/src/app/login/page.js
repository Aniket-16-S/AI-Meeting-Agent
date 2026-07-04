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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email || !password) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      login(email, password);
      addToast('Welcome back!', 'success');
    } catch (err) {
      addToast(err.message || 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickLogin = (emailVal, passVal, roleLabel) => {
    setEmail(emailVal);
    setPassword(passVal);
    try {
      login(emailVal, passVal);
      addToast(`Logged in as ${roleLabel}!`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100vw',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at top right, hsl(220, 20%, 96%), hsl(220, 20%, 90%))',
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
            background: 'linear-gradient(135deg, hsl(217, 91%, 55%), hsl(250, 80%, 60%))',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            boxShadow: 'var(--shadow-glow)',
            marginBottom: '12px'
          }}>⚡</div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, tracking: '-0.025em', margin: 0 }}>ActionCenter AI</h1>
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
                boxShadow: '0 4px 12px hsla(217, 91%, 55%, 0.15)',
                marginTop: '6px',
                transition: 'opacity 0.2s'
              }}
            >
              {submitting ? 'Authenticating…' : 'Sign In'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            New to ActionCenter?{' '}
            <Link href="/register" style={{ color: 'var(--text-accent)', fontWeight: 600 }}>
              Register Organization
            </Link>
          </div>
        </div>

        {/* Credentials Helper Cards */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          background: 'rgba(255, 255, 255, 0.4)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          padding: '16px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', tracking: '0.05em' }}>
            💡 Quick Demo Access
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={() => handleQuickLogin('admin@acme.com', 'password', 'Org Admin')}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '11px',
                textAlign: 'left',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-critical-text)' }}>OrgAdmin</div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Sundar Pichai</div>
            </button>
            <button
              onClick={() => handleQuickLogin('manager@acme.com', 'password', 'Dept Manager')}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '11px',
                textAlign: 'left',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-high-text)' }}>DeptManager</div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Steve Jobs</div>
            </button>
            <button
              onClick={() => handleQuickLogin('member@acme.com', 'password', 'Member')}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '8px 10px',
                fontSize: '11px',
                textAlign: 'left',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                gridColumn: 'span 2',
                boxShadow: 'var(--shadow-card)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-low-text)' }}>Member Employee</div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Member User (admin@acme.com / password)</div>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
