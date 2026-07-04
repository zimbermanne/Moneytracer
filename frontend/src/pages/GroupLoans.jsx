import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'

const empty = { member_id: '', principal: '', interest_rate: 0 }

function statusBadge(status) {
  if (status === 'paid') return <span className="badge badge-paid">Paid</span>
  if (status === 'defaulted') return <span className="badge badge-unpaid">Defaulted</span>
  return <span className="badge badge-partial">Active</span>
}

export default function GroupLoans() {
  const api = useApi()
  const [loans, setLoans] = useState([])
  const [members, setMembers] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [repayTarget, setRepayTarget] = useState(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [historyTarget, setHistoryTarget] = useState(null)
  const [history, setHistory] = useState([])
  const [listLoading, setListLoading] = useState(true)

  const load = () => {
    setListLoading(true)
    Promise.all([api.get('/community/loans'), api.get('/community/members')])
      .then(([l, m]) => { setLoans(l); setMembers(m) })
      .catch((e) => setError(e.message))
      .finally(() => setListLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const memberName = (id) => members.find((m) => m.id === id)?.name || `#${id}`

  const save = async () => {
    try {
      await api.post('/community/loans', {
        member_id: Number(form.member_id),
        principal: Number(form.principal),
        interest_rate: Number(form.interest_rate) || 0,
      })
      setOpen(false)
      setForm(empty)
      load()
    } catch (e) { setError(e.message) }
  }

  const repay = async () => {
    try {
      await api.post(`/community/loans/${repayTarget.id}/repay`, { amount: Number(repayAmount) })
      setRepayTarget(null)
      setRepayAmount('')
      load()
    } catch (e) { setError(e.message) }
  }

  const viewHistory = async (loan) => {
    setHistoryTarget(loan)
    try {
      setHistory(await api.get(`/community/loans/${loan.id}/repayments`))
    } catch (e) { setError(e.message) }
  }

  const columns = [
    { key: 'member_id', header: 'Member', render: (r) => memberName(r.member_id) },
    { key: 'principal', header: 'Principal', render: (r) => r.principal.toLocaleString() },
    { key: 'interest_rate', header: 'Interest', render: (r) => `${r.interest_rate}%` },
    { key: 'balance', header: 'Balance', render: (r) => r.balance.toLocaleString() },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'issued_at', header: 'Issued', render: (r) => new Date(r.issued_at).toLocaleDateString() },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div style={{ display: 'flex', gap: 8 }}>
          {r.status === 'active' && <button className="btn btn-outline" onClick={() => setRepayTarget(r)}>Record repayment</button>}
          <button className="btn btn-outline" onClick={() => viewHistory(r)}>History</button>
        </div>
      ),
    },
  ]

  const outstanding = loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.balance, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Group Loans</h1>
        <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={members.length === 0}>+ Issue Loan</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <div className="card metric-card">
          <div className="label">Outstanding Balance</div>
          <div className="value">{outstanding.toLocaleString()}</div>
        </div>
        <div className="card metric-card">
          <div className="label">Loans issued</div>
          <div className="value">{loans.length}</div>
        </div>
      </div>

      <Table columns={columns} rows={loans} loading={listLoading} loadingText="Loading loans…" emptyText="No loans issued yet." />

      {open && (
        <Modal
          title="Issue Loan"
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!form.member_id || !form.principal}>Save</button>
          </>)}
        >
          <div className="form-row">
            <label>Member</label>
            <select value={form.member_id} onChange={(e) => setForm({ ...form, member_id: e.target.value })}>
              <option value="">Select member…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Principal</label><input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
          <div className="form-row"><label>Interest rate (%)</label><input type="number" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })} /></div>
        </Modal>
      )}

      {repayTarget && (
        <Modal
          title={`Record Repayment — ${memberName(repayTarget.member_id)}`}
          onClose={() => setRepayTarget(null)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setRepayTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={repay} disabled={!repayAmount}>Save</button>
          </>)}
        >
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            Outstanding balance: {repayTarget.balance.toLocaleString()}
          </div>
          <div className="form-row"><label>Amount</label><input type="number" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} /></div>
        </Modal>
      )}

      {historyTarget && (
        <Modal title={`Repayment History — ${memberName(historyTarget.member_id)}`} onClose={() => setHistoryTarget(null)}
          footer={<button className="btn btn-outline" onClick={() => setHistoryTarget(null)}>Close</button>}>
          <Table
            columns={[
              { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
              { key: 'amount', header: 'Amount', render: (r) => r.amount.toLocaleString() },
            ]}
            rows={history}
            emptyText="No repayments recorded yet."
          />
        </Modal>
      )}
    </div>
  )
}
