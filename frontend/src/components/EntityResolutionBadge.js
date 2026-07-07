'use client';
import { useAuth } from '@/lib/AuthContext';

function getInitials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function getAvatarColor(name) {
  if (!name) return 'hsl(220, 10%, 60%)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Curated pastel HSL values
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 55%)`;
}

export default function EntityResolutionBadge({ ownerName }) {
  const { users } = useAuth();

  const isUnassigned = !ownerName || ownerName.toLowerCase() === 'unassigned' || ownerName.toLowerCase() === 'none';

  // Find user by name match (case-insensitive), first name match, or email match
  const matchedUser = !isUnassigned
    ? users.find((u) => {
        const uNameLower = u.name.toLowerCase();
        const oNameLower = ownerName.toLowerCase();
        const uFirstName = u.name.trim().split(/\s+/)[0].toLowerCase();
        return (
          uNameLower === oNameLower ||
          uFirstName === oNameLower ||
          u.email.toLowerCase() === oNameLower
        );
      })
    : null;

  if (matchedUser) {
    const initials = getInitials(matchedUser.name);
    const bgColor = getAvatarColor(matchedUser.name);

    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: bgColor,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 700,
            textShadow: '0 1px 2px rgba(0,0,0,0.15)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}
          title={`Verified: ${matchedUser.name} (${matchedUser.role})`}
        >
          {initials}
        </div>
        <span style={{ fontSize: '13px', fontWeight: 550, color: 'var(--text-primary)' }}>
          {matchedUser.name}
        </span>
      </div>
    );
  }

  // Fallback / Placeholder for unassigned or raw string
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        borderRadius: '20px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-secondary)',
        fontSize: '12px',
        fontWeight: 500,
      }}
    >
      <span style={{ fontSize: '10px' }}>👤</span>
      {isUnassigned ? 'Unassigned' : `${ownerName}`}
    </span>
  );
}
