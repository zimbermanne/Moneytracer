import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const emptyForm = () => ({
  lender_name: '', principal: '', interest_type: 'reducing_balance', annual_rate: '',
  start_date: new Date().toISOString().slice(0, 10), due_day_of_month: 1, term_months: '12', grace_period_days: 0, notes: '',
})

/**
 * Calculates Monthly EMI for display purposes.
 */
function calculateEMI(principal, rate, months, type) {
  const p = Number(principal);
  const r = (Number(rate) / 100) / 12;
  const n = Number(months);
  if (!p || n <= 0) return 0;

  if (type === 'simple') {
    // EMI = (Principal + Total Interest) / Months
    const totalInterest = p * (Number(rate) / 100) * (n / 12);
    return (p + totalInterest) / n;
  }

  // Reducing Balance formula
  if (!r) return p / n;
  return (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export default function BankLoans() {
  const { t } = useTranslation()
  const api = useApi()

  const [loans, setLoans] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState(null)          // the loan being viewed
  const [roadmap, setRoadmap] = useState(null)
  const [roadmapLoading, setRoadmapLoading] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const [reminders, setReminders] = useState([])

  const loadReminders = () => {
    api.get('/reminders/').then(data => {
      const map = new Map();
      const result = [];
      const loanRegex = /Payment to (.*) is due (\d+) day\(s\) overdue/;
      const invoiceRegex = /\((.*)\) is (\d+) day\(s\) overdue/;
      data.forEach(r => {
        const loanMatch = r.text.match(loanRegex);
        const invMatch = r.text.match(invoiceRegex);
        if (loanMatch || invMatch) {
          const entity = loanMatch ? loanMatch[1] : `Invoice (${invMatch[1]})`;
          const days = parseInt(loanMatch ? loanMatch[2] : invMatch[2], 10);
          const existing = map.get(entity);
          if (!existing || days > existing.days) map.set(entity, { id: r.id, days, record: r });
        } else { result.push(r); }
      });
      setReminders([...result, ...Array.from(map.values()).map(v => v.record)]);
    }).catch(() => {})
  }

  const dismissReminder = (id) => {
    setReminders((prev) => prev.filter((r) => r.id !== id))
    api.patch(`/reminders/${id}/done`, {}).catch(loadReminders)
  }

  const load = () => {
    setListLoading(true)
    api.get('/bank-loans/').then(setLoans).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }
  useEffect(() => {
    load()
    loadReminders()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setForm(emptyForm()); setError(''); setOpen(true) }

  const save = async () => {
    setError(''); setSaving(true)
    try {
      if (!form.lender_name.trim()) throw new Error(t('bankLoans.lenderRequired'))
      if (!form.principal || Number(form.principal) <= 0) throw new Error(t('bankLoans.principalRequired'))
      if (!form.start_date) throw new Error(t('bankLoans.startDateRequired'))
      await api.post('/bank-loans/', {
        lender_name: form.lender_name,
        principal: Number(form.principal),
        interest_type: form.interest_type,
        annual_rate: Number(form.annual_rate) || 0,
        start_date: new Date(form.start_date).toISOString(),
        due_day_of_month: Number(form.due_day_of_month) || 1,
        term_months: form.term_months ? Number(form.term_months) : null,
        grace_period_days: Number(form.grace_period_days) || 0,
        notes: form.notes,
      })
      setOpen(false)
      load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const openDetail = async (loan) => {
    setDetail(loan)
    setRoadmap(null)
    setPayAmount('')
    setError('')
  }

  const loadRoadmap = async () => {
    setRoadmapLoading(true)
    try {
      const data = await api.get(`/bank-loans/${detail.id}/roadmap`)
      setRoadmap(data)
    } catch (e) { setError(e.message) }
    finally { setRoadmapLoading(false) }
  }

  const logPayment = async () => {
    if (!payAmount || Number(payAmount) <= 0) return
    setPaying(true); setError('')
    try {
      await api.post(`/bank-loans/${detail.id}/payments`, { amount: Number(payAmount) })
      const refreshed = await api.get(`/bank-loans/${detail.id}`)
      setDetail(refreshed)
      setPayAmount('')
      setRoadmap(null)
      load()
    } catch (e) { setError(e.message) }
    finally { setPaying(false) }
  }

  const setStatus = async (status) => {
    try {
      await api.put(`/bank-loans/${detail.id}`, { status })
      const refreshed = await api.get(`/bank-loans/${detail.id}`)
      setDetail(refreshed)
      load()
    } catch (e) { setError(e.message) }
  }

  const remove = async (loan) => {
    if (!confirm(t('bankLoans.confirmDelete'))) return
    try { await api.del(`/bank-loans/${loan.id}`); load() } catch (e) { setError(e.message) }
  }

  const columns = [
    { key: 'lender_name', header: t('bankLoans.lender'), render: (r) => (
      <div>
        <div style={{ fontWeight: 600 }}>{r.lender_name}</div>
        {r.days_overdue > 0 && (
          <span className="badge badge-unpaid" style={{ fontSize: 10, marginTop: 4 }}>
             {r.days_overdue} {t('deadlines.daysOverdue')}
          </span>
        )}
      </div>
    )},
    { key: 'principal', header: t('bankLoans.principal'), render: (r) => money(r.principal) },
    { key: 'balance', header: t('bankLoans.currentBalance'), render: (r) => (
      <div>
        <div style={{ fontWeight: 700 }}>{money(r.total_balance)}</div>
        {r.accrued_interest > 0 && (
          <div style={{ fontSize: 11, color: 'var(--danger)' }}>
            Inc. {money(r.accrued_interest)} interest
          </div>
        )}
      </div>
    )},
    { key: 'interest_type', header: t('bankLoans.interestType'), render: (r) => r.interest_type === 'simple' ? t('bankLoans.simple') : t('bankLoans.reducingBalance') },
    { key: 'annual_rate', header: t('bankLoans.annualRate'), render: (r) => `${r.annual_rate}%` },
    { key: 'status', header: t('documents.status'), render: (r) => <span className={`badge badge-${r.status === 'active' ? 'sent' : r.status === 'closed' ? 'paid' : 'unpaid'}`}>{t(`bankLoans.status.${r.status}`)}</span> },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: t('common.viewEdit'), icon: '👁', onClick: () => openDetail(r) },
          { label: t('common.delete'), icon: '✕', onClick: () => remove(r), danger: true, hidden: r.payments?.length > 0 },
        ]} />
      ),
    },
  ]

  const totalOutstanding = loans.filter((l) => l.status === 'active').reduce((s, l) => s + (l.total_balance || 0), 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('bankLoans.title')}</h1>
        <button className="btn btn-primary" onClick={openNew}>+ {t('bankLoans.newLoan')}</button>
      </div>

      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      {error && !detail && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card-grid" style={{ marginBottom: 20 }}>
        <div className="card metric-card">
          <div className="label">{t('bankLoans.totalOutstanding')}</div>
          <div className="value">{money(totalOutstanding)}</div>
        </div>
        <div className="card metric-card">
          <div className="label">{t('bankLoans.activeLoans')}</div>
          <div className="value">{loans.filter((l) => l.status === 'active').length}</div>
        </div>
      </div>

      <Table
        columns={columns}
        rows={loans}
        loading={listLoading}
        loadingText={t('common.loadingEllipsis')}
        emptyText={t('bankLoans.noLoans')}
        onRowClick={openDetail}
      />

      {open && (
        <Modal
          title={t('bankLoans.newLoan')}
          onClose={() => setOpen(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? t('common.loadingEllipsis') : t('common.save')}</button>
          </>)}
        >
          {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
          <div className="form-row"><label>{t('bankLoans.lender')} *</label>
            <input value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} /></div>
          <div className="form-row"><label>{t('bankLoans.principal')} *</label>
            <input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
          <div className="form-row"><label>{t('bankLoans.interestType')}</label>
            <select value={form.interest_type} onChange={(e) => setForm({ ...form, interest_type: e.target.value })}>
              <option value="simple">{t('bankLoans.simple')}</option>
              <option value="reducing_balance">{t('bankLoans.reducingBalance')}</option>
            </select></div>
          <div className="form-row"><label>{t('bankLoans.annualRate')}</label>
            <input type="number" value={form.annual_rate} onChange={(e) => setForm({ ...form, annual_rate: e.target.value })} /></div>

          {form.principal && form.annual_rate && form.term_months && (
            <div className="card" style={{ marginBottom: 16, background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Estimated Monthly EMI</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>
                {money(calculateEMI(form.principal, form.annual_rate, form.term_months, form.interest_type))}
              </div>
            </div>
          )}

          <div className="form-row"><label>{t('bankLoans.startDate')} *</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="form-row"><label>{t('bankLoans.dueDay')}</label>
            <input type="number" min={1} max={28} value={form.due_day_of_month} onChange={(e) => setForm({ ...form, due_day_of_month: e.target.value })} /></div>
          <div className="form-row"><label>{t('bankLoans.termMonths')} ({t('common.optional')})</label>
            <input type="number" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} /></div>
          <div className="form-row"><label>{t('bankLoans.gracePeriod')}</label>
            <input type="number" value={form.grace_period_days} onChange={(e) => setForm({ ...form, grace_period_days: e.target.value })} /></div>
          <div className="form-row"><label>{t('common.notes')}</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </Modal>
      )}

      {detail && (
        <Modal
          title={`${detail.lender_name} — ${money(detail.total_balance)} ${t('bankLoans.outstanding')}`}
          onClose={() => setDetail(null)}
          footer={(<button className="btn btn-outline" onClick={() => setDetail(null)}>{t('common.close')}</button>)}
        >
          {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('bankLoans.principal')}</div>
              <div style={{ fontWeight: 600 }}>{money(detail.outstanding_principal)}</div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Accrued Interest</div>
              <div style={{ fontWeight: 600, color: 'var(--danger)' }}>{money(detail.accrued_interest)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Total Original: {money(detail.principal)} · {detail.annual_rate}% {t('bankLoans.annualRate').toLowerCase()} ·{' '}
              {detail.interest_type === 'simple' ? t('bankLoans.simple') : t('bankLoans.reducingBalance')}
            </div>
          </div>

          {detail.status === 'active' && detail.total_balance > 0 && (
            <div className="form-row" style={{ alignItems: 'flex-end', display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>{t('bankLoans.logPayment')}</label>
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={logPayment} disabled={paying}>
                {paying ? t('common.loadingEllipsis') : t('common.save')}
              </button>
            </div>
          )}

          {detail.status === 'active' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-outline" onClick={() => setStatus('closed')}>{t('bankLoans.markClosed')}</button>
              <button className="btn btn-outline" onClick={() => setStatus('defaulted')}>{t('bankLoans.markDefaulted')}</button>
            </div>
          )}

          <div className="invoice-editor-section-label">{t('bankLoans.paymentHistory')}</div>
          {(detail.payments || []).length === 0 ? (
            <div className="doc-sheet-muted" style={{ marginBottom: 16 }}>{t('bankLoans.noPayments')}</div>
          ) : (
            <table className="doc-sheet-items" style={{ marginBottom: 16 }}>
              <thead><tr>
                <th>{t('common.date')}</th><th>{t('common.amount')}</th>
                <th>{t('bankLoans.interest')}</th><th>{t('bankLoans.principalPortion')}</th><th>{t('bankLoans.balanceAfter')}</th>
              </tr></thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                    <td>{money(p.amount)}</td>
                    <td>{money(p.interest_portion)}</td>
                    <td>{money(p.principal_portion)}</td>
                    <td>{money(p.balance_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {detail.status === 'active' && detail.total_balance > 0 && (
            <>
              <div className="invoice-editor-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {t('bankLoans.roadmap')}
                <button className="btn btn-outline" onClick={loadRoadmap} disabled={roadmapLoading}>
                  {roadmapLoading ? t('common.loadingEllipsis') : t('bankLoans.viewRoadmap')}
                </button>
              </div>
              {roadmap && roadmap.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={roadmap.map((r) => ({ period: r.period, balance: r.balance }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                      <Tooltip formatter={(v) => money(v)} />
                      <Line type="monotone" dataKey="balance" stroke="var(--accent)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}
