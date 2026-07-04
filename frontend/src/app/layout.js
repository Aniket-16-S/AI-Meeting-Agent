'use client';
import './globals.css';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UploadModal from '@/components/UploadModal';
import QueryWidget from '@/components/QueryWidget';
import { ToastProvider } from '@/components/Toast';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

function LayoutWrapper({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const toggleSidebar = () => setSidebarOpen((p) => !p);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (!loading) {
      if (!user && !isAuthPage) {
        router.replace('/login');
      } else if (user && isAuthPage) {
        router.replace('/');
      } else if (user && user.role === 'Member' && pathname.startsWith('/settings')) {
        router.replace('/');
      }
    }
  }, [user, loading, pathname, isAuthPage, router]);

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className="pulse-danger" style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>⚡</div>
          <div style={{ fontWeight: 500 }}>Initializing Command Center…</div>
        </div>
      </div>
    );
  }

  // If not logged in and trying to access protected page, show loading state while redirecting
  if (!user && !isAuthPage) {
    return null;
  }

  // If logged in and trying to access login/register, show loading state while redirecting
  if (user && isAuthPage) {
    return null;
  }

  // Render auth pages full-screen without sidebar and widgets
  if (isAuthPage) {
    return <main style={{ minHeight: '100vh' }}>{children}</main>;
  }

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        onUpload={() => setUploadOpen(true)}
      />

      {/* Top bar with hamburger */}
      <div className="topbar">
        <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Toggle menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="topbar-title">ActionCenter AI</span>
      </div>

      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : ''}`} key={refreshKey}>
        {children}
      </main>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <QueryWidget />
    </div>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>ActionCenter AI, Project Command Center</title>
        <meta name="description" content="AI-powered meeting transcript analyzer. Extract tasks, risks, and insights automatically." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
      </head>
      <body>
        <ToastProvider>
          <AuthProvider>
            <LayoutWrapper>{children}</LayoutWrapper>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

