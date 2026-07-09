'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

export default function DepartmentManagementPage() {
  const { departments, createDepartment, user, deleteDepartmentInContext } = useAuth();
  const { addToast } = useToast();
  const [name, setName] = useState('');

  // Delete Department Modal States
  const [deleteDeptId, setDeleteDeptId] = useState(null);
  const [deleteDeptName, setDeleteDeptName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isOrgAdmin = user?.role === 'admin';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      addToast('Please enter a department name', 'warning');
      return;
    }
    try {
      createDepartment(name);
      addToast(`Department "${name}" created successfully!`, 'success');
      setName('');
    } catch (err) {
      addToast(err.message || 'Failed to create department', 'error');
    }
  };

  const triggerDeleteDepartment = (deptId, deptName) => {
    setDeleteDeptId(deptId);
    setDeleteDeptName(deptName);
    setPasswordConfirm('');
    setShowDeleteModal(true);
  };

  const handleConfirmDeleteDepartment = async (e) => {
    e.preventDefault();
    if (!passwordConfirm.trim()) {
      addToast('Password is required to delete departments', 'warning');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteDepartmentInContext(deleteDeptId, passwordConfirm);
      addToast(`Department "${deleteDeptName}" has been successfully deleted!`, 'success');
      setShowDeleteModal(false);
      window.location.reload();
    } catch (err) {
      addToast(err.message || 'Failed to delete department', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOrgAdmin) {
    return (
      <div className="glass-card" style={{ padding: '32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-critical-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-critical-text)' }}>Restricted Access</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '440px' }}>
          Only Organization Administrators (OrgAdmin) are authorized to create or configure departments. Please contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>Department Management</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
          Create and manage organizational departments.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* Department List */}
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Active Departments ({departments.length})</h3>
          
          <div className="data-table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Department Name</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.name}</td>
                    <td>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 750,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: 'var(--color-low-bg)',
                        color: 'var(--color-low-text)',
                      }}>
                        Active
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => triggerDeleteDepartment(d.id, d.name)}
                        style={{
                          color: 'var(--color-critical-text)',
                          background: 'var(--color-critical-bg)',
                          border: '1px solid var(--color-critical-border)',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Department Form */}
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Add New Department</h3>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Department Name</label>
              <input
                type="text"
                placeholder="Product Operations, Finance, Sales"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                background: 'var(--accent-gradient)',
                color: '#fff',
                padding: '11px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: '0 4px 12px hsla(250, 91%, 55%, 0.15)',
                marginTop: '6px'
              }}
            >
              Create Department
            </button>
          </form>
        </div>

      </div>

      {showDeleteModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          animation: 'fadeIn 0.25s ease'
        }}>
          <div className="glass-card" style={{
            width: '100%',
            maxWidth: '420px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: 'var(--shadow-elevated)',
            border: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)'
          }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Confirm Department Deletion
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Are you sure you want to delete department <strong>{deleteDeptName}</strong>? This action cannot be undone. Please enter your administrator password to authenticate:
              </p>
            </div>

            <form onSubmit={handleConfirmDeleteDepartment} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input
                type="password"
                placeholder="Enter admin password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoFocus
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  width: '100%'
                }}
              />

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeleting}
                  style={{
                    background: 'var(--color-critical-bg)',
                    color: 'var(--color-critical-text)',
                    border: '1px solid var(--color-critical-border)',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
