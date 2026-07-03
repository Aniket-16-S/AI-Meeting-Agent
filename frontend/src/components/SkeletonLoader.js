export function SkeletonCards({ count = 4 }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-card">
          <div className="kpi-card-inner">
            <div className="skeleton" style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton-line" style={{ width: '50%', height: 28, marginBottom: 8 }} />
              <div className="skeleton skeleton-line short" style={{ height: 12 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  const widths = ['30%', '18%', '15%', '12%', '10%'];
  return (
    <div className="data-table-wrapper">
      <div style={{ padding: 0 }}>
        <div className="skeleton-table-row" style={{ background: 'hsla(222,40%,10%,0.8)' }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="skeleton skeleton-table-cell" style={{ width: widths[i] || '15%' }} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-table-row">
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="skeleton skeleton-table-cell" style={{ width: widths[j] || '15%' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
