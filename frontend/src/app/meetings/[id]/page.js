'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { fetchMeeting, fetchTasks, fetchRisks, updateTaskStatus } from '@/lib/api';
import Tabs from '@/components/Tabs';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EntityResolutionBadge from '@/components/EntityResolutionBadge';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/AuthContext';

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return '-'; }
}

function formatTime(t) {
  if (!t) return '';
  try {
    const [h, m] = String(t).split(':');
    const hr = parseInt(h);
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const hr12 = hr % 12 || 12;
    return `${hr12}:${m} ${ampm}`;
  } catch { return t; }
}

function TasksTab({ tasks, onToggleComplete }) {
  if (!tasks?.length) {
    return (
      <EmptyState
        icon="✅"
        title="No tasks found"
        text="No action items were extracted from this meeting."
      />
    );
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Owner</th>
            <th>Priority</th>
            <th>Category</th>
            <th>Due Date</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="td-description">{t.task_description}</td>
              <td>
                <EntityResolutionBadge ownerName={t.owner} />
              </td>
              <td><PriorityBadge level={t.priority} /></td>
              <td><span className="category-badge">{t.category}</span></td>
              <td className="td-date">
                {t.due_date ? (
                  <>
                    {formatDate(t.due_date)}
                    {t.due_time && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 4, fontSize: 11 }}>
                        {formatTime(t.due_time)}
                      </span>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>No deadline</span>
                )}
              </td>
              <td><StatusBadge status={t.status} /></td>
              <td style={{ textAlign: 'right' }}>
                <select
                  value={t.status}
                  onChange={(e) => onToggleComplete(t.id, e.target.value)}
                  style={{
                    background: t.status === 'Closed' ? 'rgba(34, 197, 94, 0.1)' : t.status === 'In Progress' ? 'hsla(45, 93%, 47%, 0.1)' : 'var(--bg-input)',
                    color: t.status === 'Closed' ? '#22c55e' : t.status === 'In Progress' ? 'hsl(45, 93%, 40%)' : 'var(--text-primary)',
                    border: `1px solid ${t.status === 'Closed' ? 'rgba(34, 197, 94, 0.2)' : t.status === 'In Progress' ? 'hsla(45, 93%, 47%, 0.2)' : 'var(--border-primary)'}`,
                    cursor: 'pointer',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 500,
                    outline: 'none',
                  }}
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Closed">Closed</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function RisksTab({ risks }) {
  if (!risks?.length) {
    return (
      <EmptyState
        icon="⛵"
        title="Smooth sailing!"
        text="No risks or issues were detected in this meeting."
      />
    );
  }

  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>Risk Description</th>
            <th>Severity</th>
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <tr key={r.id}>
              <td className="td-description">{r.risk_description}</td>
              <td><PriorityBadge level={r.severity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTranscriptText(text) {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 10) {
    let wordCount = 0;
    lines.forEach(l => {
      wordCount += l.split(/\s+/).length;
    });
    const avgWordsPerLine = wordCount / lines.length;
    if (avgWordsPerLine < 2.0) {
      let result = [];
      let currentLine = [];
      lines.forEach(word => {
        const isSpeakerHeader = /^[A-Z][a-zA-Z0-9_\s]*:$/.test(word) || (word.endsWith(':') && word.length < 30);
        const isTimestamp = /^\[\d{2}:\d{2}(:\d{2})?\]$/.test(word) || /^\(\d{2}:\d{2}(:\d{2})?\)$/.test(word);
        if ((isSpeakerHeader || isTimestamp) && currentLine.length > 0) {
          result.push(currentLine.join(' '));
          currentLine = [];
        }
        currentLine.push(word);
      });
      if (currentLine.length > 0) {
        result.push(currentLine.join(' '));
      }
      return result.join('\n\n');
    }
  }
  return text;
}

function TranscriptTab({ transcript }) {
  const formatted = useMemo(() => formatTranscriptText(transcript), [transcript]);

  if (!transcript) {
    return (
      <EmptyState
        icon="📄"
        title="No transcript"
        text="The raw transcript is not available for this meeting."
      />
    );
  }

  return <div className="transcript-viewer">{formatted}</div>;
}

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = params.id;
  const { user, department, isMeetingInDepartment, organization } = useAuth();
  const { addToast } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check if the logged in user is assigned any tasks in this meeting
  const userHasTasksInMeeting = useMemo(() => {
    if (!tasks || !user) return false;
    const userFirstName = user.name.trim().split(/\s+/)[0].toLowerCase();
    return tasks.some((t) => {
      if (!t.owner) return false;
      const ownerLower = t.owner.toLowerCase();
      return ownerLower === user.name.toLowerCase() || ownerLower === userFirstName;
    });
  }, [tasks, user]);

  // Filter risks to show only High and Critical severity
  const filteredRisks = useMemo(() => {
    if (!risks) return [];
    return risks.filter(r => {
      const sev = r.severity?.toLowerCase();
      return sev === 'high' || sev === 'critical';
    });
  }, [risks]);

  const handleToggleComplete = async (taskId, newStatus) => {
    try {
      await updateTaskStatus(taskId, newStatus);
      setTasks((prevTasks) =>
        prevTasks?.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
      let msg = 'Task status updated!';
      if (newStatus === 'Closed') {
        msg = 'Task marked as completed!';
      } else if (newStatus === 'In Progress') {
        msg = 'Task marked as In Progress!';
      } else if (newStatus === 'Open') {
        msg = 'Task reopened!';
      }
      addToast(msg, 'success');
    } catch (err) {
      addToast(err.message || 'Failed to update task status', 'error');
    }
  };

  useEffect(() => {
    if (!meetingId || !organization?.id) return;
    setLoading(true);
    Promise.all([
      fetchMeeting(meetingId, organization.id),
      fetchTasks(meetingId, organization.id),
      fetchRisks(meetingId, organization.id),
    ])
      .then(([m, t, r]) => {
        setMeeting(m);
        setTasks(t);
        setRisks(r);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [meetingId, organization?.id]);

  const hasAccess = isMeetingInDepartment(meetingId, department?.id) || userHasTasksInMeeting;

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <div className="skeleton skeleton-line" style={{ width: '40%', height: 28 }} />
          <div className="skeleton skeleton-line short" style={{ height: 14, marginTop: 8 }} />
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="page-animate">
        <EmptyState
          icon="🚫"
          title="Access Denied"
          text="You do not have access to view this meeting transcript, or it belongs to a different department."
        />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="page-animate">
        <EmptyState
          icon="❌"
          title="Meeting not found"
          text="This meeting may have been deleted or the ID is invalid."
        />
      </div>
    );
  }




  return (
    <div className="page-animate">
      <div className="page-header">
        <h1 className="page-title">{meeting.title || meeting.file_name}</h1>
        <div className="page-subtitle">
          <span>Uploaded {formatDate(meeting.upload_date)}</span>
          {meeting.content_hash && (
            <span className="hash-badge" title="Content hash for idempotency">
              #{meeting.content_hash.slice(0, 8)}
            </span>
          )}
        </div>
        {meeting.summary && (
          <div className="meeting-summary-card">
            <div className="meeting-summary-label">AI Summary</div>
            {meeting.summary}
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          {
            label: 'Tasks',
            icon: '📋',
            count: tasks?.length || 0,
            content: <TasksTab tasks={tasks} onToggleComplete={handleToggleComplete} />,
          },
          {
            label: 'Risks',
            icon: '⚠️',
            count: filteredRisks.length,
            content: <RisksTab risks={filteredRisks} />,
          },
          {
            label: 'Transcript',
            icon: '📄',
            content: <TranscriptTab transcript={meeting.raw_transcript} />,
          },
        ]}
      />
    </div>
  );
}
