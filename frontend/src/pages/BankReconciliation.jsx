import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

export default function BankReconciliation() {
  const api = useApi()
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState(null)
  const [lines, setLines] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10))
  const [statementBalance, setStatementBalance] = useState('')
  const [notes, setNotes] = useState('')
  const [completing, setCompleting] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.get('/bank-reconciliation/accounts')
      .then((accs) => {
        setAccounts(accs)
        if (accs.length > 0) setAccountId(accs[0].id)
      })
      .catch((e) => setError(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadAccountData = (id) => {
    setLoading(true)
    setResult(null)
    Promise.all([
      api.get(`/bank-reconciliation/${id}/lines`),
      api.get(`/bank-reconciliation/${id}/history`),
    ])
      .then(([l, h]) => { setLines(l); setHistory(h) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (accountId) loadAccountData(accountId)
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLine = async (lineId) => {
    // Optimistic flip so ticking feels instant while working through a
    // long statement, one line at a time.
    setLines((prev) => prev.map((l) => l.line_id === lineId ? { ...l, is_reconciled: !l.is_reconciled } : l))
    try {
      const updated = await api.post(`/bank-reconciliation/lines/${lineId}/toggle`, {})
      setLines((prev) => prev.map((l) => l.line_id === lineId ? updated : l))
    } catch (e) {
      setError(e.message)
      loadAccountData(accountId) // revert to server truth on failure
    }
  }

  const reconciledLines = lines.filter((l) => l.is_reconciled)
  const bookBalance = reconciledLines.reduce((sum, l) => sum + (l.debit - l.credit), 0)
  const previewDifference = statementBalance !== ''
    ? Number(statementBalance) - bookBalance
    : null

  const complete = async () => {
    if (statementBalance === '') { setError('Enter the statement ending balance first.'); return }
    setCompleting(true)
    setError('')
    try {
      const res = await api.post(`/bank-reconciliation/${accountId}/complete`, {
        statement_date: new Date(statementDate).toISOString(),
        statement_balance: Number(statementBalance),
        notes,
      })
      setResult(res)
      setHistory((prev) => [res, ...prev])
      setStatementBalance('')
      setNotes('')
    } catch (e) {
      setError(e.message)
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Bank Reconciliation</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
          Tick off each transaction against your bank statement, then enter the statement's
          ending balance to confirm everything matches.
        </p>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="form-row" style={{ maxWidth: 360, marginBottom: 20 }}>
        <label>Account</label>
        <select value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.length === 0 && <option value="">No bank/cash accounts found</option>}
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </select>
      </div>

      {accountId && (
        <>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card home-kpi-card metric-card">
              <div className="label">Book Balance (ticked lines)</div>
              <div className="value">{money(bookBalance)}</div>
            </div>
            <div className="card home-kpi-card metric-card">
              <div className="label">Lines Ticked</div>
              <div className="value">{reconciledLines.length} / {lines.length}</div>
            </div>
            {previewDifference !== null && (
              <div className="card home-kpi-card metric-card">
                <div className="label">Difference vs Statement</div>
                <div className="value" style={{ color: Math.abs(previewDifference) < 0.01 ? 'var(--success)' : 'var(--danger)' }}>
                  {money(previewDifference)}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Complete Reconciliation</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-row" style={{ maxWidth: 200 }}>
                <label>Statement Date</label>
                <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
              </div>
              <div className="form-row" style={{ maxWidth: 200 }}>
                <label>Statement Ending Balance</label>
                <input type="number" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-row" style={{ flex: 1, minWidth: 200 }}>
                <label>Notes (optional)</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. bank fee not yet entered" />
              </div>
              <button className="btn btn-primary" onClick={complete} disabled={completing}>
                {completing ? 'Saving…' : 'Complete Reconciliation'}
              </button>
            </div>
            {result && (
              <div style={{ marginTop: 14, fontSize: 14 }}>
                {Math.abs(result.difference) < 0.01
                  ? <span style={{ color: 'var(--success)' }}>✓ Reconciled clean — difference {money(result.difference)}.</span>
                  : <span style={{ color: 'var(--danger)' }}>Saved with a difference of {money(result.difference)} — something's still unmatched.</span>}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Transactions</h3>
            {loading ? (
              <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : lines.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>No transactions posted to this account yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '8px 6px', width: 40 }}></th>
                      <th style={{ padding: '8px 6px' }}>Date</th>
                      <th style={{ padding: '8px 6px' }}>Description</th>
                      <th style={{ padding: '8px 6px' }}>Ref</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Debit</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr
                        key={l.line_id}
                        onClick={() => toggleLine(l.line_id)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: l.is_reconciled ? 'var(--surface-sunken)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '8px 6px' }}>
                          <input type="checkbox" checked={l.is_reconciled} readOnly style={{ width: 18, height: 18 }} />
                        </td>
                        <td style={{ padding: '8px 6px' }}>{new Date(l.date).toLocaleDateString()}</td>
                        <td style={{ padding: '8px 6px' }}>{l.description}</td>
                        <td style={{ padding: '8px 6px', color: 'var(--text-muted)' }}>{l.reference || '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{l.debit ? money(l.debit) : ''}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{l.credit ? money(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Reconciliation History</h3>
              {history.map((h) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
                  <span>{new Date(h.statement_date).toLocaleDateString()} — {money(h.statement_balance)}{h.notes ? ` (${h.notes})` : ''}</span>
                  <span style={{ color: Math.abs(h.difference) < 0.01 ? 'var(--success)' : 'var(--danger)' }}>
                    {Math.abs(h.difference) < 0.01 ? 'Clean' : `Diff ${money(h.difference)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
