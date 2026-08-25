import React, { useState } from 'react';

export default function Accordion({ title, defaultOpen = false, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{
      marginBottom: '1rem',
      borderRadius: '20px',
      overflow: 'hidden',
      border: '1px solid var(--glass-border)',
      background: 'var(--glass-tint)',
      backdropFilter: 'var(--glass-filter)',
      WebkitBackdropFilter: 'var(--glass-filter)',
      boxShadow: 'inset 0 0 2px 1px rgba(255, 255, 255, 0.35), inset 0 0 10px 4px rgba(255, 255, 255, 0.15)',
      contain: 'layout paint style',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '1.1rem 1.4rem',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.05)',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: '1rem',
          color: 'var(--text-dark)',
          textAlign: 'left',
          transition: 'background 0.2s ease',
          fontFamily: 'var(--font-display)',
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
          borderTop: '1px solid var(--glass-border)',
          animation: 'accordion-fade-in 0.2s ease-out'
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
