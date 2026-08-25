import React, { useState } from 'react';

export default function Accordion({ title, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{
      marginBottom: '1rem',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '1rem 1.25rem',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'var(--surface-sunken)',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '1rem',
          color: 'var(--text-dark)',
          textAlign: 'left',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.08)'}
        onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {title}
        </span>
        <span style={{
          fontSize: '0.8rem',
          opacity: 0.6,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease'
        }}>▼</span>
      </button>
      {isOpen && (
        <div style={{
          padding: '1.25rem',
          background: 'transparent',
          borderTop: '1px solid var(--border)',
          animation: 'accordion-fade-in 0.2s ease-out'
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
