import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'

function money(n, currency) {
  return `${currency || ''} ${Number(n || 0).toLocaleString()}`.trim()
}

export default function CommunityDashboard() {
  const api = useApi()
  const [summary, setSummary] = useState(null)
  const [group, setGroup] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.get('/community/summary'), api.get('/community/group')])
      .then(([s, g]) => { setSummary(s); setGroup(g) })
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1>{group?.name || 'Group'} — Home</h1>
      </div>
      {error && <div className="error-text">{error}</div>}

      {summary && (
        <div className="card-grid" style={{ marginBottom: 20 }}>
          <div className="card metric-card">
            <div className="label">Members</div>
            <div className="value">{summary.member_count}</div>
          </div>
          <div className="card metric-card">
            <div className="label">Total Contributions</div>
            <div className="value">{money(summary.total_contributions, group?.currency)}</div>
          </div>
          <div className="card metric-card">
            <div className="label">Total Payouts</div>
            <div className="value">{money(summary.total_payouts, group?.currency)}</div>
          </div>
          <div className="card metric-card">
            <div className="label">Loans Outstanding</div>
            <div className="value">{money(summary.total_loans_outstanding, group?.currency)}</div>
          </div>
        </div>
      )}

      {group && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h3 style={{ marginTop: 0 }}>Group details</h3>
          <div style={{ fontSize: 14, lineHeight: 1.9, color: 'var(--text-muted)' }}>
            <div><strong style={{ color: 'var(--text-dark)' }}>Type:</strong> {group.group_type}</div>
            <div><strong style={{ color: 'var(--text-dark)' }}>Location:</strong> {group.region}, {group.district}</div>
            <div><strong style={{ color: 'var(--text-dark)' }}>Contribution style:</strong> {group.contribution_style}{group.contribution_amount ? ` — ${money(group.contribution_amount, group.currency)}` : ''}</div>
            <div><strong style={{ color: 'var(--text-dark)' }}>Cycle:</strong> {group.cycle_frequency}{group.meeting_day ? ` (${group.meeting_day})` : ''}</div>
            <div><strong style={{ color: 'var(--text-dark)' }}>Rotation payouts:</strong> {group.rotation_enabled ? 'Enabled' : 'Disabled'}</div>
          </div>
        </div>
      )}
    </div>
  )
}
