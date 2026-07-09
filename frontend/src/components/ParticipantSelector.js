'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';

export default function ParticipantSelector({ selectedEmails, onChange, onError }) {
  const { users } = useAuth();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Email validation regex
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // Handle outside click to close suggestions
  useEffect(() => {
    function handleOutsideClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Update suggestions when query changes
  useEffect(() => {
    if (!query.trim()) {
      // If query is empty, show all organization users that are not already selected
      const filtered = users.filter((u) => !selectedEmails.includes(u.email));
      setSuggestions(filtered);
      setActiveIndex(-1);
      return;
    }

    const q = query.toLowerCase();
    const filtered = users.filter(
      (u) =>
        (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        !selectedEmails.includes(u.email)
    );
    setSuggestions(filtered);
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [query, users, selectedEmails]);

  const addParticipant = (email) => {
    if (!emailRegex.test(email)) {
      if (onError) onError('Invalid email address format');
      return false;
    }
    if (selectedEmails.includes(email)) {
      if (onError) onError('Participant is already added');
      return false;
    }
    onChange([...selectedEmails, email]);
    setQuery('');
    setShowSuggestions(false);
    if (onError) onError(null);
    inputRef.current?.focus();
    return true;
  };

  const removeParticipant = (email) => {
    onChange(selectedEmails.filter((e) => e !== email));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggestions) {
        setShowSuggestions(true);
        return;
      }
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && activeIndex >= 0 && activeIndex < suggestions.length) {
        addParticipant(suggestions[activeIndex].email);
      } else if (query.trim()) {
        addParticipant(query.trim());
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Backspace' && !query && selectedEmails.length > 0) {
      removeParticipant(selectedEmails[selectedEmails.length - 1]);
    }
  };

  // Find user details by email to show name on chips if they exist
  const getDisplayName = (email) => {
    const found = users.find((u) => u.email === email);
    return found ? found.name : email;
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Participants
      </label>

      {/* Input container */}
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          alignItems: 'center',
          minHeight: '44px',
          padding: '8px 12px',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          cursor: 'text',
          transition: 'border-color 0.2s ease',
        }}
        className="input-focus-ring-target"
      >
        {selectedEmails.map((email) => (
          <span
            key={email}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15))',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              color: 'var(--text-primary)',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 500,
              boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
            }}
          >
            {getDisplayName(email)}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeParticipant(email);
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                padding: '0 2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={selectedEmails.length === 0 ? "Search members or type email and press Enter..." : ""}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--text-primary)',
            fontSize: '14px',
            flex: 1,
            minWidth: '120px',
            padding: '2px 0',
          }}
        />
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4)',
            maxHeight: '200px',
            overflowY: 'auto',
            zIndex: 9999,
          }}
        >
          {suggestions.map((u, index) => (
            <div
              key={u.id}
              onClick={() => addParticipant(u.email)}
              onMouseEnter={() => setActiveIndex(index)}
              style={{
                padding: '10px 14px',
                cursor: 'pointer',
                background: index === activeIndex ? 'var(--bg-tertiary)' : 'transparent',
                color: 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                transition: 'background 0.15s ease',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{u.name}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{u.email}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
