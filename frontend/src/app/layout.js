'use client';
import './globals.css';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import UploadModal from '@/components/UploadModal';
import QueryWidget from '@/components/QueryWidget';
import { ToastProvider, useToast } from '@/components/Toast';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider, useTheme } from '@/lib/ThemeContext';
import { fetchMeetingStatus } from '@/lib/api';

function LayoutWrapper({ children }) {
  const { user, loading, organization } = useAuth();
  const { addToast } = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [processingMeetings, setProcessingMeetings] = useState([]);

  const toggleSidebar = () => setSidebarOpen((p) => !p);

  const isAuthPage = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    if (!loading) {
      if (!user && !isAuthPage) {
        router.replace('/login');
      } else if (user && isAuthPage) {
        router.replace('/');
      } else if (user && user.role === 'employee' && pathname.startsWith('/settings')) {
        router.replace('/');
      }
    }
  }, [user, loading, pathname, isAuthPage, router]);

  const handleUploadQueued = (meetingId, filename) => {
    setProcessingMeetings((prev) => [
      ...prev,
      { id: meetingId, filename, status: 'PROCESSING' }
    ]);
  };

  // Poll for background transcription jobs
  useEffect(() => {
    const activeProcessing = processingMeetings.filter((m) => m.status === 'PROCESSING');
    if (!activeProcessing.length || !organization?.id) {
      return;
    }

    const interval = setInterval(async () => {
      for (const meeting of activeProcessing) {
        try {
          const status = await fetchMeetingStatus(meeting.id, organization.id);
          if (status === 'COMPLETED' || status === 'FAILED') {
            setProcessingMeetings((prev) =>
              prev.map((m) => (m.id === meeting.id ? { ...m, status } : m))
            );
            // Reload page content automatically
            setRefreshKey((k) => k + 1);
            
            if (status === 'COMPLETED') {
              addToast(`"${meeting.filename}" processed successfully! 🎉`, 'success');
            } else {
              addToast(`Failed to process "${meeting.filename}". ❌`, 'error');
            }
          }
        } catch (e) {
          console.error("Error polling meeting status", e);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [processingMeetings, organization, addToast]);

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

  const activeProcessingCount = processingMeetings.filter((m) => m.status === 'PROCESSING').length;

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
        <span className="topbar-title">Action Center AI</span>
        
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <ThemeToggle />
        </div>
      </div>

      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : ''}`} key={refreshKey}>
        {children}
      </main>

      {/* Floating Processing Panel */}
      {activeProcessingCount > 0 && (
        <div className="processing-floating-panel">
          <div className="processing-panel-header">
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 8, animation: 'pulse-dot 1.5s infinite' }} />
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>AI Processing ({activeProcessingCount})</span>
          </div>
          <div className="processing-panel-body">
            {processingMeetings.filter((m) => m.status === 'PROCESSING').map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                <span className="spinning-loader" />
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 200, color: 'var(--text-secondary)' }} title={m.filename}>
                  {m.filename}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onSuccess={() => setRefreshKey((k) => k + 1)}
          onUploadQueued={handleUploadQueued}
        />
      )}

      <QueryWidget />
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-primary)',
        borderRadius: '20px',
        padding: '6px 12px',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        fontWeight: '500',
        transition: 'all 0.2s ease',
      }}
    >
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Action Center AI, Project Command Center</title>
        <meta name="description" content="AI-powered meeting transcript analyzer. Extract tasks, risks, and insights automatically." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <LayoutWrapper>{children}</LayoutWrapper>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

