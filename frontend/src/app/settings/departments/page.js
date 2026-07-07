'use client';
import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/Toast';

export default function DepartmentManagementPage() {
  const { departments, createDepartment, user } = useAuth();
  const { addToast } = useToast();
  const [name, setName] = useState('');

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

  if (!isOrgAdmin) {
    return (
      <div className="glass-card" style={{ padding: '32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ fontSize: '48px' }}>🚫</div>
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
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)' }}>🏢 Department Management</h2>
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
                boxShadow: '0 4px 12px hsla(217, 91%, 55%, 0.15)',
                marginTop: '6px'
              }}
            >
              Create Department
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
