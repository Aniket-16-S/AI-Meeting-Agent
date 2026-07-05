'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

export default function RegisterPage() {
  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminDepartment, setAdminDepartment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { registerOrg } = useAuth();
  const { addToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!orgName || !adminName || !adminEmail || !adminPassword || !adminDepartment) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    if (adminPassword.length < 6) {
      addToast('Password must be at least 6 characters', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await registerOrg(orgName, adminName, adminEmail, adminPassword, adminDepartment);
      addToast('Organization registered and Admin logged in!', 'success');
    } catch (err) {
      addToast(err.message || 'Registration failed', 'error');
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
      background: 'radial-gradient(circle at top right, hsl(220, 20%, 96%), hsl(220, 20%, 90%))',
      color: 'var(--text-primary)',
      padding: '20px',
      overflowY: 'auto'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
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
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Register Organization</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>Create an account to start analyzing team meetings.</p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Organization Name</label>
              <input
                type="text"
                placeholder="Google Inc, Acme Corp, etc."
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Admin Full Name</label>
              <input
                type="text"
                placeholder="Sundar Pichai"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Admin Email</label>
              <input
                type="email"
                placeholder="admin@company.com"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Admin Password</label>
              <input
                type="password"
                placeholder="Min. 6 characters"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Department Name</label>
              <input
                type="text"
                placeholder="e.g. Engineering, Sales, Marketing"
                value={adminDepartment}
                onChange={(e) => setAdminDepartment(e.target.value)}
                style={{
                  padding: '11px 14px',
                  borderRadius: '10px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
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
                marginTop: '10px',
                transition: 'opacity 0.2s'
              }}
            >
              {submitting ? 'Creating Organization…' : 'Register & Start'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: 'var(--text-accent)', fontWeight: 600 }}>
              Log In
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
