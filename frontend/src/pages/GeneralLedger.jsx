import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Modal from '../components/Modal.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const emptyLine = () => ({ account_id: '', debit: 0, credit: 0 })

export default function GeneralLedger() {
  const api = useApi()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'

  const [entries, setEntries] = useState([])
  const [chartAccounts, setChartAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [accountIdFilter, setAccountIdFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // New entry form
  const [showNewEntry, setShowNewEntry] = useState(false)
  const [entryForm, setEntryForm] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    reference: '',
    lines: [emptyLine(), emptyLine()],
  })
  const [saving, setSaving] = useState(false)

  const loadEntries = () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (accountIdFilter) params.set('account_id_filter', accountIdFilter)
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    
    api.get(`/ledgers/journal-entries?${params.toString()}`)
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  const loadChartAccounts = () => {
    api.get('/ledgers/chart-of-accounts')
      .then((accounts) => {
        // Flatten the tree for dropdown
        const flat = []
        const flatten = (accs) => {
          accs.forEach((acc) => {
            flat.push(acc)
            if (acc.children && acc.children.length > 0) {
              flatten(acc.children)
            }
          })
        }
        flatten(accounts)
        setChartAccounts(flat)
      })
      .catch((e) => console.error('Failed to load chart accounts:', e))
  }

  useEffect(() => {
    loadEntries()
    loadChartAccounts()
  }, [])

  useEffect(() => {
    // Reload when filters change
    loadEntries()
  }, [accountIdFilter, startDate, endDate])

  const addLine = () => setEntryForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }))
  const removeLine = (idx) => setEntryForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))
  const updateLine = (idx, field, value) => setEntryForm((f) => {
    const lines = [...f.lines]
    lines[idx] = { ...lines[idx], [field]: value }
    return { ...f, lines }
  })

  const totalDebit = entryForm.lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0)
  const totalCredit = entryForm.lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  const saveEntry = async () => {
    if (!entryForm.description.trim()) {
      setError('Description is required.')
      return
    }
    if (!isBalanced) {
      setError('Entry must balance (total debits must equal total credits).')
      return
    }
    if (entryForm.lines.some((l) => !l.account_id)) {
      setError('All lines must have an account selected.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await api.post('/ledgers/journal-entries', {
        date: entryForm.date ? new Date(entryForm.date).toISOString() : null,
        description: entryForm.description.trim(),
        reference: entryForm.reference.trim(),
        lines: entryForm.lines.map((l) => ({
          account_id: Number(l.account_id),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
      })
      setShowNewEntry(false)
      setEntryForm({
        date: new Date().toISOString().split('T')[0],
        description: '',
        reference: '',
        lines: [emptyLine(), emptyLine()],
      })
      loadEntries()
    } catch (e) {
      setError(e.message || 'Failed to create journal entry')
    } finally {
      setSaving(false)
    }
  }

  // Get account ID from URL query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    const accountId = params.get('account_id')
    if (accountId) {
      setAccountIdFilter(accountId)
    }
  }, [])

  // Running balance now comes straight from the server (see
  // routers/ledgers.list_journal_entries -> ledger.signed_balance) — it
  // already applies the correct debit/credit sign convention per account
  // type. The frontend used to recompute this itself as a flat
  // `debit - credit` across every line, which was wrong two ways at once:
  // (1) with no account selected, it summed every account touched by a
  // compound entry together, which is meaningless (a balanced entry always
  // nets to zero that way); (2) even with one account selected, plain
  // debit-minus-credit is the wrong sign for Liability/Equity/Revenue
  // accounts. Never re-derive this here — display whatever the server sent.
  const hasAccountFilter = !!accountIdFilter

  return (
    <div className="page">
      <div className="page-header">
        <h1>General Ledger</h1>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowNewEntry(true)}>
            + New Journal Entry
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Account</label>
          <select
            value={accountIdFilter}
            onChange={(e) => setAccountIdFilter(e.target.value)}
            style={{ minWidth: 200 }}
          >
            <option value="">All Accounts</option>
            {chartAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.code} - {acc.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>From</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>To</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button className="btn btn-outline" onClick={() => {
          setAccountIdFilter('')
          setStartDate('')
          setEndDate('')
        }}>
          Clear Filters
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      {!loading && !error && !hasAccountFilter && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}>
          Showing every entry across all accounts as a plain chronological journal — a
          journal entry always has debits = credits by definition, so summing that across
          multiple accounts wouldn't be a meaningful balance. <strong>Select an account above</strong> to
          see its own debit/credit history and running balance.
        </div>
      )}

      {!loading && !error && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Description</th>
                  <th style={{ padding: '8px 12px' }}>Reference</th>
                  {hasAccountFilter ? (
                    <>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Debit</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Credit</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Balance</th>
                    </>
                  ) : (
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Accounts touched</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={hasAccountFilter ? 6 : 4} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No journal entries found
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => {
                    // Filtered view: exactly one line belongs to this entry
                    // for the selected account (server already filtered
                    // lines down to it — see list_journal_entries).
                    const line = hasAccountFilter ? entry.lines[0] : null
                    return (
                    <tr key={entry.id} style={{ borderTop: '1px solid #f0ece1' }}>
                      <td style={{ padding: '8px 12px' }}>{new Date(entry.date).toLocaleDateString()}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {entry.description}
                        {entry.is_reversal && <span className="badge badge-unpaid" style={{ marginLeft: 8 }}>Reversal</span>}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{entry.reference || '—'}</td>
                      {hasAccountFilter ? (
                        <>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {line?.debit > 0 ? money(line.debit) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            {line?.credit > 0 ? money(line.credit) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                            {line?.running_balance != null ? money(line.running_balance) : '—'}
                          </td>
                        </>
                      ) : (
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>
                          {entry.lines.map((l) => l.account_code).join(', ')}
                        </td>
                      )}
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Journal Entry Modal */}
      {showNewEntry && (
        <Modal onClose={() => setShowNewEntry(false)} title="New Journal Entry" wide={true}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-row">
              <label>Date</label>
              <input
                type="date"
                value={entryForm.date}
                onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="form-row">
              <label>Description *</label>
              <input
                type="text"
                value={entryForm.description}
                onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g., Opening balance adjustment"
              />
            </div>
            <div className="form-row">
              <label>Reference</label>
              <input
                type="text"
                value={entryForm.reference}
                onChange={(e) => setEntryForm((f) => ({ ...f, reference: e.target.value }))}
                placeholder="e.g., ADJ-001"
              />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ margin: 0 }}>Lines</label>
                <button className="btn btn-outline" style={{ fontSize: 12, padding: '4px 8px' }} onClick={addLine}>
                  + Add Line
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entryForm.lines.map((line, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: 12 }}>Account</label>
                      <select
                        value={line.account_id}
                        onChange={(e) => updateLine(idx, 'account_id', e.target.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Select account</option>
                        {chartAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.code} - {acc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Debit</label>
                      <input
                        type="number"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) => updateLine(idx, 'debit', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12 }}>Credit</label>
                      <input
                        type="number"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) => updateLine(idx, 'credit', e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>
                    {entryForm.lines.length > 2 && (
                      <button
                        className="btn btn-outline"
                        style={{ padding: '8px 12px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => removeLine(idx)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: 'var(--bg-light)', borderRadius: 4 }}>
              <span>Total Debit: <strong>{money(totalDebit)}</strong></span>
              <span>Total Credit: <strong>{money(totalCredit)}</strong></span>
              <span style={{ color: isBalanced ? 'var(--success)' : 'var(--danger)' }}>
                {isBalanced ? '✓ Balanced' : '✗ Not balanced'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => setShowNewEntry(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEntry} disabled={saving || !isBalanced}>
                {saving ? 'Saving…' : 'Save Entry'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
