'use client';
import { useState } from 'react';

export default function Tabs({ tabs }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="tabs">
        {tabs.map((tab, i) => (
          <button
            key={i}
            className={`tab-button ${i === active ? 'active' : ''}`}
            onClick={() => setActive(i)}
          >
            {tab.icon && <span style={{ fontSize: 15 }}>{tab.icon}</span>}
            {tab.label}
            {tab.count != null && <span className="tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>
      <div>{tabs[active]?.content}</div>
    </div>
  );
}
