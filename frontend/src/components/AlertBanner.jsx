import React, { useMemo } from 'react';

/**
 * Parses a reminder text into an AlertItem if it matches an overdue pattern.
 */
const parseAlert = (reminder) => {
  // Pattern 1: Payment to {entity} is due {days} day(s) overdue ({date})
  const loanRegex = /Payment to (.*) is due (\d+) day\(s\) overdue \((.*)\)/;
  const loanMatch = reminder.text.match(loanRegex);
  if (loanMatch) {
    return {
      id: reminder.id,
      entity: loanMatch[1],
      daysOverdue: parseInt(loanMatch[2], 10),
      dueDate: loanMatch[3],
      type: 'loan'
    };
  }

  // Pattern 2: ({amount}) is {days} day(s) overdue. (Invoices)
  const invoiceRegex = /\((.*)\) is (\d+) day\(s\) overdue/;
  const invMatch = reminder.text.match(invoiceRegex);
  if (invMatch) {
    return {
      id: reminder.id,
      entity: `Invoice (${invMatch[1]})`,
      daysOverdue: parseInt(invMatch[2], 10),
      dueDate: '',
      type: 'invoice'
    };
  }

  return null;
};

export function AlertBannerContainer({ reminders, onDismiss }) {
  // Deduplicate alerts to show only the most critical alert per entity
  const deduplicatedAlerts = useMemo(() => {
    const map = new Map();

    reminders.forEach((r) => {
      const alert = parseAlert(r);
      if (!alert) return;

      const existing = map.get(alert.entity);
      if (!existing || alert.daysOverdue > existing.daysOverdue) {
        map.set(alert.entity, alert);
      }
    });

    return Array.from(map.values());
  }, [reminders]);

  if (deduplicatedAlerts.length === 0) return null;

  return (
    <div className="alerts-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
      {deduplicatedAlerts.map((alert) => (
        <div
          key={alert.id}
          className="alert-banner alert-warning"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.85rem 1.25rem',
            backgroundColor: 'rgba(212, 114, 79, 0.12)', // Terracotta tint
            borderLeft: '4px solid var(--accent, #C15F3C)',
            borderRadius: '10px',
            color: 'var(--text-dark)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
              Payment to <strong>{alert.entity}</strong> is due ({alert.daysOverdue} day(s) overdue).
            </span>
          </div>
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              style={{
                background: 'rgba(0,0,0,0.05)',
                border: 'none',
                cursor: 'pointer',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                color: 'var(--text-muted)'
              }}
              title="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
