'use client';
import { useAuth } from '@/lib/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';

export default function SettingsLayout({ children }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role === 'employee') {
      router.replace('/');
    }
  }, [user, router]);

  if (!user || user.role === 'employee') {
    return null;
  }

  const isOrgAdmin = user.role === 'admin';

  const menuItems = [
    {
      href: '/settings/users',
      label: 'User Management',
      active: pathname === '/settings/users',
      visible: true
    },
    {
      href: '/settings/departments',
      label: 'Department Management',
      active: pathname === '/settings/departments',
      visible: isOrgAdmin
    }
  ];

  return (
    <div style={{ display: 'flex', gap: '32px', flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      
      {/* Settings Sub-sidebar */}
      <aside className="glass-card" style={{
        width: '240px',
        flexShrink: 0,
        padding: '20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        border: '1px solid var(--border-primary)',
        borderRadius: '12px',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', padding: '0 8px 12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: '8px' }}>
          Settings Menu
        </div>
        {menuItems.filter(item => item.visible).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: 'block',
              padding: '10px 12px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: item.active ? 600 : 500,
              background: item.active ? 'var(--accent-primary-glow)' : 'transparent',
              color: item.active ? 'var(--text-accent)' : 'var(--text-secondary)',
              transition: 'all 0.2s',
              border: item.active ? '1px solid var(--border-glow)' : '1px solid transparent'
            }}
          >
            {item.label}
          </Link>
        ))}
      </aside>

      {/* Main Settings Content */}
      <div style={{ flex: 1, minWidth: '320px' }}>
        {children}
      </div>

    </div>
  );
}
