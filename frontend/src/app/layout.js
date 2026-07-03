'use client';
import './globals.css';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import UploadModal from '@/components/UploadModal';
import QueryWidget from '@/components/QueryWidget';
import { ToastProvider } from '@/components/Toast';

export default function RootLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const toggleSidebar = () => setSidebarOpen((p) => !p);

  return (
    <html lang="en">
      <head>
        <title>ActionCenter AI — Project Command Center</title>
        <meta name="description" content="AI-powered meeting transcript analyzer. Extract tasks, risks, and insights automatically." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
      </head>
      <body>
        <ToastProvider>
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
          </div>

          {uploadOpen && (
            <UploadModal
              onClose={() => setUploadOpen(false)}
              onSuccess={() => setRefreshKey((k) => k + 1)}
            />
          )}

          <QueryWidget />
        </ToastProvider>
      </body>
    </html>
  );
}
