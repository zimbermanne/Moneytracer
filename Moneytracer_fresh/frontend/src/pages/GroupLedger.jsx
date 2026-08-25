import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const money = (n, currency = 'TZS') => `${currency} ${(Number(n) || 0).toLocaleString()}`

// This page is deliberately its own module, not part of the business
// (POS/Inventory/Accounting) surface — a Vikoba/social savings group is
// a different kind of tenant (AccountType.community), with its own
// backend (/api/community/*) and its own concerns: contributions, payouts,
// and internal member loans. It never touches business data.
export default function GroupLedger() {
  const api = useApi()
  const [tab, setTab] = useState('contributions')
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')

  const loadGroup = () => {
    api.get('/community/group').then(setGroup).catch((e) => setError(e.message))
    api.get('/community/members').then(setMembers).catch(() => {})
  }

  useEffect(() => { loadGroup() }, []) // eslint-disable-line

  if (error) return <div className="page"><div className="error-text">{error}</div></div>
  if (!group) return <div className="page">Loading…</div>

  const memberName = (id) => members.find((m) => m.id === id)?.name || `Member #${id}`

  return (
    <div className="page">
      <div className="page-header">
        <h1>{group.name}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {group.group_type || 'Savings Group'} · {group.contribution_style === 'fixed' ? 'Fixed' : 'Flexible'} contributions
          {group.contribution_style === 'fixed' && group.contribution_amount ? ` (${money(group.contribution_amount, group.currency)}/${group.cycle_frequency})` : ''}
        </div>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          ['contributions', 'Contributions'],
          ...(group.rotation_enabled ? [['payouts', 'Payouts']] : []),
          ...(group.lending_enabled ? [['loans', 'Loans']] : []),
          ['members', 'Members'],
        ].map(([key, label]) => (
          <div
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              color: tab === key ? 'var(--accent, #C15F3C)' : 'var(--text-muted)',
              borderBottom: tab === key ? '2px solid var(--accent, #C15F3C)' : '2px solid transparent',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {tab === 'contributions' && <ContributionsTab api={api} group={group} members={members} memberName={memberName} />}
      {tab === 'payouts' && group.rotation_enabled && <PayoutsTab api={api} group={group} members={members} memberName={memberName} />}
      {tab === 'loans' && group.lending_enabled && <LoansTab api={api} group={group} members={members} memberName={memberName} />}
      {tab === 'members' && <MembersTab members={members} />}
    </div>
  )
}

// ---------- Contributions ----------

function ContributionsTab({ api, group, members, memberName }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ member_id: '', cycle_label: '', amount: group.contribution_amount || '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/community/contributions').then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line

  const save = async () => {
    if (!form.member_id || !form.amount) { setError('Member and amount are required.'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/community/contributions', {
        member_id: Number(form.member_id),
        cycle_label: form.cycle_label || '',
        amount: Number(form.amount),
      })
      setOpen(false)
      setForm({ member_id: '', cycle_label: '', amount: group.contribution_amount || '' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const total = rows.reduce((sum, r) => sum + r.amount, 0)

  return (
    <div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div className="card home-kpi-card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Contributed</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(total, group.currency)}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Record Contribution</button>
      </div>

      <Table
        columns={[
          { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
          { key: 'member_id', header: 'Member', render: (r) => memberName(r.member_id) },
          { key: 'cycle_label', header: 'Cycle' },
          { key: 'amount', header: 'Amount', render: (r) => money(r.amount, group.currency) },
          { key: 'recorded_by', header: 'Recorded By' },
        ]}
        rows={rows}
        emptyText="No contributions recorded yet."
      />

      {open && (
        <Modal
          title="Record Contribution"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label>Member</label>
          <select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
            <option value="">Select a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.group_role})</option>)}
          </select>
          <label>Cycle Label (optional, e.g. "2026-08" or "Cycle 5")</label>
          <input value={form.cycle_label} onChange={(e) => setForm({ ...form, cycle_label: e.target.value })} />
          <label>Amount</label>
          <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Modal>
      )}
    </div>
  )
}

// ---------- Payouts (only shown if rotation_enabled) ----------

function PayoutsTab({ api, group, members, memberName }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ member_id: '', cycle_label: '', amount: '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/community/payouts').then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line

  const save = async () => {
    if (!form.member_id || !form.amount) { setError('Member and amount are required.'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/community/payouts', {
        member_id: Number(form.member_id),
        cycle_label: form.cycle_label || '',
        amount: Number(form.amount),
      })
      setOpen(false)
      setForm({ member_id: '', cycle_label: '', amount: '' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Record Payout</button>
      </div>

      <Table
        columns={[
          { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
          { key: 'member_id', header: 'Member', render: (r) => memberName(r.member_id) },
          { key: 'cycle_label', header: 'Cycle' },
          { key: 'amount', header: 'Amount', render: (r) => money(r.amount, group.currency) },
          { key: 'recorded_by', header: 'Recorded By' },
        ]}
        rows={rows}
        emptyText="No pot payouts recorded yet."
      />

      {open && (
        <Modal
          title="Record Payout"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label>Member Receiving This Cycle's Pot</label>
          <select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
            <option value="">Select a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.group_role})</option>)}
          </select>
          <label>Cycle Label</label>
          <input value={form.cycle_label} onChange={(e) => setForm({ ...form, cycle_label: e.target.value })} />
          <label>Amount</label>
          <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </Modal>
      )}
    </div>
  )
}

// ---------- Loans (only shown if lending_enabled) ----------

function LoansTab({ api, group, members, memberName }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ member_id: '', principal: '', interest_rate: '' })
  const [saving, setSaving] = useState(false)
  const [repayAmount, setRepayAmount] = useState({})

  const load = () => api.get('/community/loans').then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line

  const issueLoan = async () => {
    if (!form.member_id || !form.principal) { setError('Member and principal are required.'); return }
    setSaving(true)
    setError('')
    try {
      await api.post('/community/loans', {
        member_id: Number(form.member_id),
        principal: Number(form.principal),
        interest_rate: Number(form.interest_rate) || 0,
      })
      setOpen(false)
      setForm({ member_id: '', principal: '', interest_rate: '' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const repay = async (loanId) => {
    const amount = Number(repayAmount[loanId])
    if (!amount) return
    try {
      await api.post(`/community/loans/${loanId}/repay`, { amount })
      setRepayAmount({ ...repayAmount, [loanId]: '' })
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ marginBottom: 18 }}>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Issue Loan</button>
      </div>

      <Table
        columns={[
          { key: 'member_id', header: 'Member', render: (r) => memberName(r.member_id) },
          { key: 'principal', header: 'Principal', render: (r) => money(r.principal, group.currency) },
          { key: 'interest_rate', header: 'Interest', render: (r) => `${r.interest_rate}%` },
          { key: 'balance', header: 'Balance', render: (r) => money(r.balance, group.currency) },
          { key: 'status', header: 'Status' },
          { key: 'repay', header: 'Repay', stopRowClick: true, render: (r) => r.status === 'active' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number" placeholder="Amount" style={{ width: 90, padding: '4px 6px', fontSize: 12 }}
                value={repayAmount[r.id] || ''}
                onChange={(e) => setRepayAmount({ ...repayAmount, [r.id]: e.target.value })}
              />
              <button className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => repay(r.id)}>Pay</button>
            </div>
          ) : '—' },
        ]}
        rows={rows}
        emptyText="No internal loans issued yet."
      />

      {open && (
        <Modal
          title="Issue Loan"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={issueLoan} disabled={saving}>
                {saving ? 'Saving…' : 'Issue'}
              </button>
            </>
          }
        >
          <label>Member</label>
          <select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
            <option value="">Select a member…</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.group_role})</option>)}
          </select>
          <label>Principal</label>
          <input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
          <label>Interest Rate (%, flat, applied once)</label>
          <input type="number" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} />
        </Modal>
      )}
    </div>
  )
}

// ---------- Members (read-only here; add/remove stays in Settings/Onboarding) ----------

function MembersTab({ members }) {
  return (
    <Table
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'group_role', header: 'Role' },
        { key: 'phone', header: 'Phone' },
        { key: 'has_login', header: 'Has Login', render: (r) => r.has_login ? 'Yes' : 'No' },
      ]}
      rows={members}
      emptyText="No members yet."
    />
  )
}
