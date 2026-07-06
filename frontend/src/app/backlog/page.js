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

function formatDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return '-'; }
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

  const filtered = useMemo(() => {
    return filteredDeptTasks.filter((t) => {
      if (filterPriority && t.priority !== filterPriority) return false;
      if (filterCategory && t.category !== filterCategory) return false;
      if (filterStatus && t.status !== filterStatus) return false;
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
  }, [filteredDeptTasks, filterPriority, filterCategory, filterOwner, filterStatus]);

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
          <option value="Closed">Closed</option>
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
                    <td className="td-date">
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
                      {t.status === 'Open' ? (
                        <button
                          onClick={() => handleToggleComplete(t.id, t.status)}
                          className="btn-complete"
                        >
                          ✓ Mark Complete
                        </button>
                      ) : (
                        <span className="text-completed">✓ Completed</span>
                      )}
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
