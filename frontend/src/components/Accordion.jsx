import React, { useState } from 'react';

export default function Accordion({ title, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{
      marginBottom: '1rem',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--glass-bg)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '1rem 1.25rem',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.05)',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '1rem',
          color: 'var(--text-dark)',
          textAlign: 'left',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
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
