'use client';
import { useState } from 'react';
import { scheduleGoogleMeeting } from '@/lib/api';
import { useToast } from './Toast';
import { useAuth } from '@/lib/AuthContext';
import ParticipantSelector from './ParticipantSelector';

const COMMON_TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST, GMT+5:30)' },
  { value: 'UTC', label: 'UTC (GMT+0:00)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT, GMT+8:00)' },
];

export default function ScheduleMeetModal({ onClose, onSuccess }) {
  const { user, organization } = useAuth();
  const { addToast } = useToast();

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [attendees, setAttendees] = useState([]);

  // UI States
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Helper to calculate timezone offset and build ISO string
  const buildIsoString = (dateStr, timeStr, tzName) => {
    const combinedStr = `${dateStr}T${timeStr}:00`;
    const localDate = new Date(combinedStr);

    let offset = '+05:30'; // Default to Kolkata
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tzName,
        timeZoneName: 'longOffset',
      });
      const parts = formatter.formatToParts(localDate);
      const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value || '';
      const match = tzPart.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1][0];
        const hours = parseInt(match[1].slice(1), 10);
        const minutes = parseInt(match[2] || '0', 10);
        const padHours = String(hours).padStart(2, '0');
        const padMinutes = String(minutes).padStart(2, '0');
        offset = `${sign}${padHours}:${padMinutes}`;
      }
    } catch (e) {
      console.error('Error resolving timezone offset', e);
    }

    return `${combinedStr}${offset}`;
  };

  const handleSchedule = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    // Initial validations
    if (!title.trim()) {
      setErrorMsg('Meeting Title is required');
      return;
    }
    if (!date) {
      setErrorMsg('Meeting Date is required');
      return;
    }
    if (!startTime) {
      setErrorMsg('Start Time is required');
      return;
    }
    if (!endTime) {
      setErrorMsg('End Time is required');
      return;
    }
    if (startTime >= endTime) {
      setErrorMsg('End Time must be after Start Time');
      return;
    }
    if (attendees.length === 0) {
      setErrorMsg('At least one participant is required');
      return;
    }

    setLoading(true);

    try {
      const startIso = buildIsoString(date, startTime, timezone);
      const endIso = buildIsoString(date, endTime, timezone);

      const meetingData = {
        title,
        description,
        start: startIso,
        end: endIso,
        timezone,
        attendees,
      };

      const result = await scheduleGoogleMeeting(user.id, organization.id, meetingData);
      
      if (result.success) {
        addToast('Google Meet meeting scheduled successfully!', 'success');
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMsg('Failed to schedule meeting. Try again.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to schedule meeting');
      addToast(err.message || 'Failed to schedule meeting', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '550px' }}>
        <div className="modal-header" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px', marginBottom: '20px' }}>
          <h2 className="modal-title">Schedule Google Meet</h2>
          <button className="modal-close" onClick={onClose} disabled={loading}>✕</button>
        </div>

        <form onSubmit={handleSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {errorMsg && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#ef4444',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500
            }}>
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Meeting Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sprint Planning"
              style={{
                width: '100%',
                padding: '10px 14px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                outline: 'none'
              }}
              required
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Meeting Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add agenda or details..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                outline: 'none',
                resize: 'none'
              }}
              disabled={loading}
            />
          </div>

          {/* Date and Time Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
                required
                disabled={loading}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Start Time *
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
                required
                disabled={loading}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                End Time *
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
                required
                disabled={loading}
              />
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '14px',
                outline: 'none',
                cursor: 'pointer'
              }}
              disabled={loading}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>

          {/* Participants */}
          <ParticipantSelector
            selectedEmails={attendees}
            onChange={setAttendees}
            onError={setErrorMsg}
          />

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '14px', justifyContent: 'flex-end', marginTop: '10px', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: '1px solid var(--border-primary)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                width: 'auto',
                height: 'auto',
                position: 'static'
              }}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="upload-submit-btn"
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: 'none',
                background: 'var(--accent-primary)',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                width: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <span className="typing-dot" style={{ background: '#fff' }} />
                    <span className="typing-dot" style={{ background: '#fff' }} />
                    <span className="typing-dot" style={{ background: '#fff' }} />
                  </span>
                  Scheduling...
                </>
              ) : (
                'Schedule Meet'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
