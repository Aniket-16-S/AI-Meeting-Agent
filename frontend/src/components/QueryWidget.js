'use client';
import { useState, useRef, useEffect } from 'react';
import { queryAgent } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';

const SUGGESTIONS = [
  'Show all high priority tasks',
  'What are the critical risks?',
  'Tasks assigned to Speaker A',
  'Summarize recent meetings',
];

export default function QueryWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { organization } = useAuth();

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
      const data = await queryAgent(question, organization?.id);
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
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
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
      <table className="query-results-table">
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
      {/* FAB */}
      <button
        className={`query-fab ${open ? 'hidden' : ''}`}
        onClick={() => setOpen(true)}
        title="Ask AI Assistant"
      >
        💬
      </button>

      {/* Chat Window */}
      {open && (
        <div className="query-window">
          <div className="query-window-header">
            <div className="query-window-title">
              <span>🤖</span> Query Assistant
            </div>
            <button className="query-window-close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <div className="query-messages">
            {messages.length === 0 && !loading && (
              <div className="empty-state" style={{ padding: '24px 8px' }}>
                <div className="empty-state-icon" style={{ fontSize: 36 }}>🔍</div>
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
                <div>{msg.content}</div>
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
