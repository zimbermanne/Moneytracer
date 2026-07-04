import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const empty = { member_id: '', cycle_label: '', amount: '' }

export default function Contributions() {
  const api = useApi()
  const [contributions, setContributions] = useState([])
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [listLoading, setListLoading] = useState(true)

  const load = () => {
    setListLoading(true)
    Promise.all([api.get('/community/contributions'), api.get('/community/members')])
      .then(([c, m]) => { setContributions(c); setMembers(m) })
      .catch((e) => setError(e.message))
      .finally(() => setListLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const memberName = (id) => members.find((m) => m.id === id)?.name || `#${id}`

  const save = async () => {
    try {
      await api.post('/community/contributions', {
        member_id: Number(form.member_id),
        cycle_label: form.cycle_label,
        amount: Number(form.amount),
      })
      setOpen(false)
      setForm(empty)
      load()
    } catch (e) { setError(e.message) }
  }

  const columns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'member_id', header: 'Member', render: (r) => memberName(r.member_id) },
    { key: 'cycle_label', header: 'Cycle' },
    { key: 'amount', header: 'Amount', render: (r) => r.amount.toLocaleString() },
    { key: 'recorded_by', header: 'Recorded by' },
  ]

  const total = contributions.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Contributions</h1>
        <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={members.length === 0}>+ Record Contribution</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {members.length === 0 && !listLoading && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
          Add group members first, then come back here to record their contributions.
        </div>
      )}

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <div className="card metric-card">
          <div className="label">Total Contributions</div>
          <div className="value">{total.toLocaleString()}</div>
        </div>
        <div className="card metric-card">
          <div className="label">Entries</div>
          <div className="value">{contributions.length}</div>
        </div>
      </div>

      <Table columns={columns} rows={contributions} loading={listLoading} loadingText="Loading contributions…" emptyText="No contributions recorded yet." />

      {open && (
        <Modal
          title="Record Contribution"
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!form.member_id || !form.cycle_label || !form.amount}>Save</button>
          </>)}
        >
          <div className="form-row">
            <label>Member</label>
            <select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
              <option value="">Select member…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Cycle label</label><input value={form.cycle_label} onChange={(e) => setForm({ ...form, cycle_label: e.target.value })} placeholder="e.g. July 2026" /></div>
          <div className="form-row"><label>Amount</label><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  )
}
