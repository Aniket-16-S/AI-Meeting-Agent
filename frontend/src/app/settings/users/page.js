'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

export default function UserManagementPage() {
  const { users, departments, createUser, user: currentUser, deleteUserInContext, assignUserDepartmentInContext } = useAuth();
  const { addToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('employee');
  const [departmentId, setDepartmentId] = useState('');

  // Delete User Modal States
  const [deleteUserId, setDeleteUserId] = useState(null);
  const [deleteUserName, setDeleteUserName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password || !role || !departmentId) {
      addToast('Please fill in all fields', 'warning');
      return;
    }
    if (password.length < 6) {
      addToast('Password must be at least 6 characters', 'warning');
      return;
    }

    try {
      await createUser(name, email, password, role, departmentId);
      addToast(`User "${name}" has been registered successfully!`, 'success');
      // Reset form
      setName('');
      setEmail('');
      setPassword('');
      setRole('employee');
      setDepartmentId('');
    } catch (err) {
      addToast(err.message || 'Failed to create user', 'error');
    }
  };

  const triggerDeleteUser = (userId, userName) => {
    setDeleteUserId(userId);
    setDeleteUserName(userName);
    setPasswordConfirm('');
    setShowDeleteModal(true);
  };

  const handleConfirmDeleteUser = async (e) => {
    e.preventDefault();
    if (!passwordConfirm.trim()) {
      addToast('Password is required to delete users', 'warning');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteUserInContext(deleteUserId, passwordConfirm);
      addToast(`User "${deleteUserName}" has been successfully deleted!`, 'success');
      setShowDeleteModal(false);
      window.location.reload();
    } catch (err) {
      addToast(err.message || 'Failed to delete user', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAssignDepartment = async (userId, deptId) => {
    if (!deptId) return;
    try {
      await assignUserDepartmentInContext(userId, deptId);
      addToast('Department assigned successfully!', 'success');
      window.location.reload();
    } catch (err) {
      addToast(err.message || 'Failed to assign department', 'error');
    }
  };

  // Filter users to current active organization
  const orgUsers = users.filter((u) => u.organizationId === currentUser?.organizationId);

  // Group users by department name for displaying nicely
  const getDeptName = (deptId) => {
    const d = departments.find((dept) => dept.id === deptId);
    return d ? d.name : 'Unknown';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>👥 User Management</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
          View team directory and register new employee accounts.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* User Directory List */}
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Employee Directory ({orgUsers.length})</h3>
          
          <div className="data-table-wrapper" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 600 }}>{u.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{u.email}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        background: u.role === 'admin' ? 'var(--color-critical-bg)' : 'var(--color-low-bg)',
                        color: u.role === 'admin' ? 'var(--color-critical-text)' : 'var(--color-low-text)',
                      }}>
                        {u.role === 'admin' ? 'Admin' : 'Employee'}
                      </span>
                    </td>
                    <td style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {getDeptName(u.departmentId) === 'Unknown' || !u.departmentId ? (
                        <select
                          defaultValue=""
                          onChange={(e) => handleAssignDepartment(u.id, e.target.value)}
                          style={{
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-primary)',
                            color: 'var(--text-primary)',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="" disabled>Assign Dept...</option>
                          {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                              {dept.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        getDeptName(u.departmentId)
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {u.role !== 'admin' && (
                        <button
                          onClick={() => triggerDeleteUser(u.id, u.name)}
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
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create User Form */}
        <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Create New User</h3>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Full Name</label>
              <input
                type="text"
                placeholder="Jane Doe"
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Email Address</label>
              <input
                type="email"
                placeholder="jane@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Password</label>
              <input
                type="password"
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>Department</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">Select a Department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
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
              Add Employee User
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
                ⚠️ Confirm Account Deletion
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Are you sure you want to delete user <strong>{deleteUserName}</strong>? This action cannot be undone. Please enter your administrator password to authenticate:
              </p>
            </div>

            <form onSubmit={handleConfirmDeleteUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
