'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { fetchTasks, fetchMeetings, updateTaskStatus } from '@/lib/api';
import PriorityBadge from '@/components/PriorityBadge';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { SkeletonTable } from '@/components/SkeletonLoader';
import EntityResolutionBadge from '@/components/EntityResolutionBadge';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDateString(d) {
  if (!d) return null;
  const match = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10) - 1,
      day: parseInt(match[3], 10),
    };
  }
  try {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) {
      return {
        year: dt.getFullYear(),
        month: dt.getMonth(),
        day: dt.getDate(),
      };
    }
  } catch {}
  return null;
}

function formatDate(d) {
  if (!d) return '-';
  const parsed = parseDateString(d);
  if (!parsed) return '-';
  return `${parsed.day} ${shortMonths[parsed.month]}`;
}

function getDueDateStyle(d, status) {
  if (!d || status === 'Closed' || status === 'Completed' || status === 'Done') return {};
  const parsed = parseDateString(d);
  if (!parsed) return {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(parsed.year, parsed.month, parsed.day);
  due.setHours(0, 0, 0, 0);

  const diffTime = due.getTime() - today.getTime();
  if (diffTime === 0) {
    return { color: 'var(--color-high-text)', fontWeight: '600' };
  } else if (diffTime < 0) {
    return { color: 'var(--color-critical-text)', fontWeight: '600' };
  }
  return {};
}

export default function BacklogPage() {
  const { user, department, getDepartmentMeetingIds, organization } = useAuth();
  const { addToast } = useToast();
  const [tasks, setTasks] = useState(null);
  const [meetings, setMeetings] = useState({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterPriority, setFilterPriority] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMeeting, setFilterMeeting] = useState('');

  const handleStatusChange = async (taskId, newStatus) => {
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
    if (!organization?.id) return;
    setLoading(true);
    Promise.all([fetchTasks(null, organization.id), fetchMeetings(organization.id)])
      .then(([t, m]) => {
        setTasks(t);
        const map = {};
        m.forEach((mtg) => { map[mtg.id] = mtg; });
        setMeetings(map);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [organization?.id]);

  // Filter tasks belonging to active department or assigned to the user
  const filteredDeptTasks = useMemo(() => {
    if (!tasks || !department || !user) return [];
    const deptMtgIds = getDepartmentMeetingIds(department.id);
    
    const userFullName = user.name.trim().toLowerCase();
    const userFirstName = user.name.trim().split(/\s+/)[0].toLowerCase();

    return tasks.filter((t) => {
      const isInDept = deptMtgIds.includes(t.meeting_id);
      
      let isAssignedToMe = false;
      if (Array.isArray(t.owners_list)) {
        isAssignedToMe = t.owners_list.some((o) => {
          if (!o) return false;
          const oLower = String(o).trim().toLowerCase();
          return oLower === userFullName || oLower === userFirstName;
        });
      }
      if (!isAssignedToMe && t.owner) {
        const ownerLower = String(t.owner).trim().toLowerCase();
        isAssignedToMe = (
          ownerLower === userFullName ||
          ownerLower === userFirstName ||
          ownerLower.includes(userFullName) ||
          ownerLower.includes(userFirstName)
        );
      }
      
      return isInDept || isAssignedToMe;
    });
  }, [tasks, department, getDepartmentMeetingIds, user]);

  // Get all meetings that are referenced by the filtered dept tasks
  const backlogMeetings = useMemo(() => {
    const ids = new Set(filteredDeptTasks.map((t) => t.meeting_id).filter(Boolean));
    return Array.from(ids).map((id) => meetings[id]).filter(Boolean);
  }, [filteredDeptTasks, meetings]);

  const filtered = useMemo(() => {
    return filteredDeptTasks.filter((t) => {
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterMeeting && t.meeting_id !== filterMeeting) return false;
      if (filterOwner) {
        const queryLower = filterOwner.toLowerCase();
        const matchesOwnerStr = (t.owner || '').toLowerCase().includes(queryLower);
        
        let matchesOwnersList = false;
        if (Array.isArray(t.owners_list)) {
          matchesOwnersList = t.owners_list.some(o => 
            (o || '').toLowerCase().includes(queryLower)
          );
        }
        
        if (!matchesOwnerStr && !matchesOwnersList) return false;
      }
      return true;
    });
  }, [filteredDeptTasks, filterPriority, filterCategory, filterOwner, filterStatus, filterMeeting]);

  if (loading) {
    return (
      <div className="page-animate">
        <div className="page-header">
          <h1 className="page-title">Global Backlog</h1>
        </div>
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  return (
    <div className="page-animate">
      <div className="page-header">
        <h1 className="page-title">Global Backlog</h1>
        <p className="page-subtitle">
          {filtered.length} of {filteredDeptTasks.length} tasks in {department?.name}
        </p>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <select
          className="filter-select"
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
        >
          <option value="">All Priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          className="filter-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          <option value="Action Item">Action Item</option>
          <option value="Decision">Decision</option>
          <option value="Follow-up">Follow-up</option>
          <option value="Info">Info</option>
        </select>

        <select
          className="filter-select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Closed">Closed</option>
        </select>

        <select
          className="filter-select"
          value={filterMeeting}
          onChange={(e) => setFilterMeeting(e.target.value)}
          style={{ maxWidth: '200px', textOverflow: 'ellipsis' }}
        >
          <option value="">All Meetings</option>
          {backlogMeetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title || m.file_name}
            </option>
          ))}
        </select>

        <input
          className="filter-input"
          type="text"
          placeholder="Search by owner…"
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No tasks match your filters"
          text={filteredDeptTasks.length ? 'Try adjusting your filters to see more results.' : 'Upload a meeting transcript in this department to populate the backlog.'}
        />
      ) : (
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
                <th>Meeting</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const mtg = meetings[t.meeting_id];
                return (
                  <tr key={t.id}>
                    <td className="td-description">{t.task_description}</td>
                    <td>
                      <EntityResolutionBadge ownerName={t.owner} />
                    </td>
                    <td><PriorityBadge level={t.priority} /></td>
                    <td><span className="category-badge">{t.category}</span></td>
                    <td className="td-date" style={getDueDateStyle(t.due_date, t.status)}>
                      {t.due_date ? formatDate(t.due_date) : (
                        <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                      )}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      {mtg ? (
                        <Link
                          href={`/meetings/${t.meeting_id}`}
                          style={{ fontSize: 12, color: 'var(--text-accent)' }}
                          title={mtg.title || mtg.file_name}
                        >
                          {(mtg.title || mtg.file_name || '').slice(0, 20)}
                          {(mtg.title || mtg.file_name || '').length > 20 ? '…' : ''}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <select
                        value={t.status}
                        onChange={(e) => handleStatusChange(t.id, e.target.value)}
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
