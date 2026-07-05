'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { fetchMeeting, fetchTasks, fetchRisks, updateTaskStatus } from '@/lib/api';
import Tabs from '@/components/Tabs';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EntityResolutionBadge from '@/components/EntityResolutionBadge';
import { useToast } from '@/components/Toast';

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
                {t.status === 'Open' ? (
                  <button
                    onClick={() => onToggleComplete(t.id, t.status)}
                    className="btn-complete"
                  >
                    ✓ Mark Complete
                  </button>
                ) : (
                  <span className="text-completed">✓ Completed</span>
                )}
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

function TranscriptTab({ transcript }) {
  if (!transcript) {
    return (
      <EmptyState
        icon="📄"
        title="No transcript"
        text="The raw transcript is not available for this meeting."
      />
    );
  }

  return <div className="transcript-viewer">{transcript}</div>;
}

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = params.id;
  const { department, isMeetingInDepartment, organization } = useAuth();
  const { addToast } = useToast();

  const [meeting, setMeeting] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [risks, setRisks] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleToggleComplete = async (taskId, currentStatus) => {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    try {
      await updateTaskStatus(taskId, newStatus);
      setTasks((prevTasks) =>
        prevTasks?.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
      addToast(
        newStatus === 'Closed'
          ? 'Task marked as completed!'
          : 'Task reopened!',
        'success'
      );
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

  const hasAccess = isMeetingInDepartment(meetingId, department?.id);

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
            count: risks?.length || 0,
            content: <RisksTab risks={risks} />,
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
