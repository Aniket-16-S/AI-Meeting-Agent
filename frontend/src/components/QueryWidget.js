'use client';
import { useState, useRef, useEffect } from 'react';
import { queryAgent } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';

const SUGGESTIONS = [
  'Show all high priority tasks',
  'What are the critical risks?',
  'List my critical tasks',
  'Summarize recent meetings',
];

export default function QueryWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBubble, setShowBubble] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { organization, user } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowBubble(false);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuery = async (question) => {
    if (!question.trim()) return;
    const userMsg = { role: 'user', content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await queryAgent(question, organization?.id, user?.name);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          results: data.database_results,
          sql: data.filters_applied?.sql_queries,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'I encountered an error trying to process your request. Please try rephrasing your question or checking your connection.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery(input);
    }
  };

  const renderResultsTable = (results) => {
    if (!results || !results.length || typeof results[0] !== 'object') return null;
    const keys = Object.keys(results[0]).filter(
      (k) => !['id', 'meeting_id', 'content_hash', 'raw_transcript', 'owners_list', 'created_at'].includes(k)
    );
    if (!keys.length) return null;

    return (
      <div className="query-results-wrapper" style={{ marginTop: 8 }}>
        <div className="query-results-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Results ({results.length} rows)
          </span>
          <button 
            className="btn-download-xlsx" 
            onClick={() => downloadXLSX(results, keys)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: '600',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'transform 0.1s ease, box-shadow 0.1s ease',
              boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(16, 185, 129, 0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.2)';
            }}
          >
            Download Excel (XLSX)
          </button>
        </div>
        <div className="query-results-table-scroll" style={{ overflowX: 'auto', width: '100%', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
          <table className="query-results-table" style={{ margin: 0 }}>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k}>{k.replace(/_/g, ' ')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 10).map((row, i) => (
                <tr key={i}>
                  {keys.map((k) => (
                    <td key={k} title={row[k] || '—'}>{row[k] || '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const SqlBlock = ({ queries }) => {
    const [show, setShow] = useState(false);
    if (!queries || !queries.length) return null;
    return (
      <div>
        <button className="sql-toggle" onClick={() => setShow(!show)}>
          {show ? '▾' : '▸'} View SQL
        </button>
        {show && (
          <div className="sql-code">
            {queries.map((q, i) => (
              <div key={i}>{q}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Welcome Bubble */}
      {showBubble && !open && (
        <div className="query-bubble-tooltip">
          Hii, how can I help you?
        </div>
      )}

      {/* FAB */}
      <button
        className={`query-fab ${open ? 'hidden' : ''}`}
        onClick={() => {
          setOpen(true);
          setShowBubble(false);
        }}
        title="Ask AI Assistant"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* Chat Window */}
      {open && (
        <div className="query-window">
          <div className="query-window-header">
            <div className="query-window-title" style={{ display: 'flex', alignItems: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                <rect x="3" y="11" width="18" height="10" rx="2"/>
                <circle cx="12" cy="5" r="2"/>
                <path d="M12 7v4"/>
                <line x1="8" y1="16" x2="8" y2="16"/>
                <line x1="16" y1="16" x2="16" y2="16"/>
              </svg>
              Query Assistant
            </div>
            <button className="query-window-close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <div className="query-messages">
            {messages.length === 0 && !loading && (
              <div className="empty-state" style={{ padding: '24px 8px' }}>
                <div className="empty-state-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </div>
                <div className="empty-state-title" style={{ fontSize: 14 }}>
                  Ask anything about your meetings
                </div>
                <div className="empty-state-text" style={{ fontSize: 12 }}>
                  I can search tasks, risks, and meetings using natural language.
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`query-msg ${msg.role}`}>
                <div>{msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}</div>
                {msg.results && renderResultsTable(msg.results)}
                {msg.sql && <SqlBlock queries={msg.sql} />}
              </div>
            ))}

            {loading && (
              <div className="typing-indicator">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {messages.length === 0 && !loading && (
            <div className="query-suggestions">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="query-chip" onClick={() => sendQuery(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="query-input-area">
            <input
              ref={inputRef}
              className="query-input"
              placeholder="Ask about tasks, risks, meetings…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="query-send-btn"
              onClick={() => sendQuery(input)}
              disabled={!input.trim() || loading}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Load SheetJS dynamically from CDN
function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(window.XLSX);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
}

// Helper function to export results to a native Excel (XLSX) file using SheetJS
async function downloadXLSX(results, keys) {
  if (!results || !results.length) return;
  
  try {
    const XLSX = await loadSheetJS();
    
    // Map database rows to simple format suitable for Excel
    const data = results.map(row => {
      const formattedRow = {};
      keys.forEach(k => {
        const excelHeader = k.replace(/_/g, ' ').toUpperCase();
        formattedRow[excelHeader] = row[k] === null || row[k] === undefined ? '' : row[k];
      });
      return formattedRow;
    });

    // Create a worksheet from JSON
    const worksheet = XLSX.utils.json_to_sheet(data);
    
    // Create a workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Query Results");
    
    // Write workbook to file (true .xlsx binary zip file)
    XLSX.writeFile(workbook, `query_results_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    console.error("Failed to export Excel file", err);
    alert("Failed to export Excel file. Please try again.");
  }
}

// Simple and robust parser for rendering basic Markdown inline tags
function inlineMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Match **bold** (allowing leading/trailing spaces inside the asterisks)
  html = html.replace(/\*\*\s*([^*]+?)\s*\*\*/g, '<strong>$1</strong>');
  
  // Match *italic*
  html = html.replace(/\*\s*([^*]+?)\s*\*/g, '<em>$1</em>');
  
  // Match `inline code`
  html = html.replace(/`([^`]+)`/g, '<code class="chat-inline-code" style="background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.95em;">$1</code>');

  return html;
}

// Renders raw assistant responses using paragraph blocks, line heights, and lists
function renderMarkdown(text) {
  if (!text) return '';
  
  // Normalize bold spacing: change `** text **` to `**text**` to ensure consistent formatting
  let processed = text.replace(/\*\*\s*([^*]+?)\s*\*\*/g, '**$1**');
  
  const lines = processed.split('\n');
  const renderedElements = [];
  let inList = false;
  let listItems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Bullet list: starts with dash, asterisk, or plus
    const listMatch = line.match(/^[-*+]\s+(.*)/);
    if (listMatch) {
      if (!inList) {
        inList = true;
        listItems = [];
      }
      listItems.push(listMatch[1]);
      continue;
    } else if (inList) {
      renderedElements.push(
        <ul key={`ul-${i}`} className="chat-ul" style={{ margin: '6px 0', paddingLeft: '18px', listStyleType: 'disc' }}>
          {listItems.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />
          ))}
        </ul>
      );
      inList = false;
    }

    if (!line.trim()) {
      continue;
    }

    renderedElements.push(
      <p key={`p-${i}`} className="chat-p" style={{ margin: '6px 0', lineHeight: '1.4' }} dangerouslySetInnerHTML={{ __html: inlineMarkdown(line) }} />
    );
  }

  if (inList) {
    renderedElements.push(
      <ul key="ul-final" className="chat-ul" style={{ margin: '6px 0', paddingLeft: '18px', listStyleType: 'disc' }}>
        {listItems.map((item, idx) => (
          <li key={idx} style={{ marginBottom: 4 }} dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />
        ))}
      </ul>
    );
  }

  return <div className="formatted-chat-msg">{renderedElements}</div>;
}
