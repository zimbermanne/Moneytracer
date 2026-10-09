import { useState } from 'react'
import Modal from './Modal.jsx'
import { useApi } from '../hooks/useApi.js'
import { buildReconciliationStatementEscPos } from '../utils/escpos.js'
import {
  isBluetoothSupported, connectPrinter, printBytes, getConnectedPrinterName, disconnectPrinter,
} from '../utils/thermalPrinter.js'

const PAPER_WIDTH_KEY = 'moneytracer_receipt_paper_width' // shared with ThermalReceipt/ThermalStatement

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function shortDate(d) {
  return d ? new Date(d).toLocaleDateString() : ''
}

const MATCH_LABELS = { phone: 'Phone', tin: 'TIN', 'phone+tin': 'Phone + TIN' }

/**
 * Lets the user look up a party by phone or TIN, pulls every Debtor row and
 * every Creditor row tied to that party (GET /ledgers/reconcile), and shows
 * a single merged, chronological statement with a running net balance —
 * so a customer who is also a supplier (or was, at different times) gets
 * one statement instead of two disconnected ledgers.
 *
 * Includes single-click Contra Offset functionality (POST /ledgers/reconcile/offset)
 * to net out overlapping debtor and creditor debts in equal measure.
 */
export default function ReconciliationStatement({ company, initialPhone = '', initialTin = '', onClose }) {
  const api = useApi()
  const [phone, setPhone] = useState(initialPhone)
  const [tin, setTin] = useState(initialTin)
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(false)
  const [offsetting, setOffsetting] = useState(false)
  const [error, setError] = useState('')

  const [paperWidth, setPaperWidth] = useState(() => localStorage.getItem(PAPER_WIDTH_KEY) || '58')
  const [btBusy, setBtBusy] = useState(false)
  const [btPrinterName, setBtPrinterName] = useState(getConnectedPrinterName())
  const [notice, setNotice] = useState('')

  const search = async () => {
    if (!phone.trim() && !tin.trim()) {
      setError('Enter a phone number or TIN to reconcile on.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (phone.trim()) params.set('phone', phone.trim())
      if (tin.trim()) params.set('tin', tin.trim())
      const result = await api.get(`/ledgers/reconcile?${params.toString()}`)
      setStatement(result)
    } catch (e) {
      setStatement(null)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleOffset = async () => {
    if (!statement) return
    const maxOffset = Math.min(
      statement.entries.filter((e) => e.kind === 'debit').reduce((s, e) => s + (e.amount - e.paid), 0),
      statement.entries.filter((e) => e.kind === 'credit').reduce((s, e) => s + (e.amount - e.paid), 0)
    )
    if (maxOffset <= 0) {
      setError('No overlapping balance available between Debtor and Creditor accounts to offset.')
      return
    }

    if (!confirm(`Offset TZS ${money(maxOffset)} between Debtor and Creditor balances for ${statement.party_name}?`)) {
      return
    }

    setOffsetting(true)
    setError('')
    setNotice('')
    try {
      const res = await api.post('/ledgers/reconcile/offset', {
        phone: statement.phone || phone,
        tin: statement.tin_number || tin,
      })
      setNotice(res.message || `Successfully offset TZS ${money(res.offset_amount)}.`)
      // Refresh statement
      search()
    } catch (e) {
      setError(e.message)
    } finally {
      setOffsetting(false)
    }
  }

  const handleSystemPrint = () => window.print()

  const handleBluetoothPrint = async () => {
    setError(''); setNotice(''); setBtBusy(true)
    try {
      if (!btPrinterName) {
        const conn = await connectPrinter()
        setBtPrinterName(conn.name)
      }
      const charsPerLine = paperWidth === '80' ? 64 : 42
      const bytes = buildReconciliationStatementEscPos(statement, company, charsPerLine)
      await printBytes(bytes)
      setNotice('Sent to printer.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBtBusy(false)
    }
  }

  const handleDisconnect = () => {
    disconnectPrinter()
    setBtPrinterName(null)
    setNotice('Printer disconnected.')
  }

  // ---- Step 1: search form (no match found yet) ----
  if (!statement) {
    return (
      <Modal
        title="Reconcile Account"
        onClose={onClose}
        footer={(<>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={search} disabled={loading}>
            {loading ? 'Searching…' : 'Find Account'}
          </button>
        </>)}
      >
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          A party can be both a debtor and a creditor. Enter their phone number
          and/or TIN to pull every debtor and creditor record tied to them and
          merge it into one reconciled statement.
        </div>
        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="form-row"><label>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +255 7XX XXX XXX" /></div>
        <div className="form-row"><label>TIN</label><input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="Tax ID number" /></div>
      </Modal>
    )
  }

  // ---- Step 2: found — show statement with summary card & contra offset action ----
  const net = statement.net_balance || 0
  const unpaidDebtor = statement.entries.filter((e) => e.kind === 'debit').reduce((s, e) => s + (e.amount - e.paid), 0)
  const unpaidCreditor = statement.entries.filter((e) => e.kind === 'credit').reduce((s, e) => s + (e.amount - e.paid), 0)
  const maxOffset = Math.min(unpaidDebtor, unpaidCreditor)

  return (
    <Modal title={`Reconciliation — ${statement.party_name}`} onClose={onClose} isDirty={false} footer={(
      <>
        <button className="btn btn-outline" onClick={() => setStatement(null)}>← New Search</button>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        {isBluetoothSupported() && (
          <button className="btn btn-outline" onClick={handleBluetoothPrint} disabled={btBusy}>
            {btBusy ? 'Sending…' : btPrinterName ? `🖨 Print to ${btPrinterName}` : '🔵 Print via Bluetooth'}
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSystemPrint}>🖨 Print</button>
      </>
    )}>
      <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{statement.party_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Phone: {statement.phone || '—'} | TIN: {statement.tin_number || '—'}
            </div>
          </div>
          <span className={`badge badge-${net === 0 ? 'paid' : net > 0 ? 'unpaid' : 'partial'}`}>
            {net === 0 ? 'SETTLED' : net > 0 ? 'THEY OWE US' : 'WE OWE THEM'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: 12, background: 'var(--surface-sunken)', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Receivable (Debtor)</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{money(statement.total_debit)} TZS</div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Payable (Creditor)</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{money(statement.total_credit)} TZS</div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Net Position</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: net > 0 ? 'var(--success)' : net < 0 ? 'var(--danger)' : 'var(--text-dark)' }}>
              {money(Math.abs(net))} TZS {net > 0 ? '(Dr)' : net < 0 ? '(Cr)' : ''}
            </div>
          </div>
        </div>

        {maxOffset > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Overlapping balance available to offset: <strong>TZS {money(maxOffset)}</strong>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleOffset} disabled={offsetting}>
              {offsetting ? 'Offsetting…' : '⚡ Contra Offset Net Balance'}
            </button>
          </div>
        )}
      </div>

      <div className="receipt-controls">
        <label>Paper width</label>
        <div className="receipt-width-toggle">
          <button type="button" className={paperWidth === '58' ? 'active' : ''} onClick={() => setPaperWidth('58')}>58mm</button>
          <button type="button" className={paperWidth === '80' ? 'active' : ''} onClick={() => setPaperWidth('80')}>80mm</button>
        </div>
        {btPrinterName && (
          <button type="button" className="receipt-disconnect-link" onClick={handleDisconnect}>
            Disconnect {btPrinterName}
          </button>
        )}
      </div>

      {notice && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 8, fontWeight: 600 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      <div className={`receipt-print-area receipt-width-${paperWidth}`}>
        <div className="receipt-center receipt-bold receipt-large">{company?.name || 'Moneytracer'}</div>
        {(company?.street_address || company?.address) && (
          <div className="receipt-center">{company.street_address || company.address}</div>
        )}
        {company?.phone && <div className="receipt-center">Tel: {company.phone}</div>}
        <div className="receipt-hr" />
        <div className="receipt-center receipt-bold">RECONCILIATION STATEMENT</div>

        <div style={{ marginTop: 4 }}>Party: {statement.party_name}</div>
        {statement.phone && <div>Phone: {statement.phone}</div>}
        {statement.tin_number && <div>TIN: {statement.tin_number}</div>}
        <div>Matched on: {MATCH_LABELS[statement.matched_on] || statement.matched_on}</div>
        <div>Printed: {new Date().toLocaleString()}</div>
        <div className="receipt-hr" />

        {statement.entries.length > 0 ? statement.entries.map((e, i) => (
          <div key={i} className="receipt-line">
            <div>
              {e.doc_no} — {shortDate(e.date)}{e.reference ? ` — ${e.reference}` : ''}
            </div>
            <div className="receipt-row receipt-small">
              <span>{e.kind === 'debit' ? 'Debit (owed to us)' : 'Credit (we owe)'} {money(e.amount)}</span>
              <span>Bal {money(e.balance)}</span>
            </div>
          </div>
        )) : (
          <div className="receipt-center">No transactions on record.</div>
        )}
        <div className="receipt-hr" />

        <div className="receipt-row">
          <span>Total Debit (owed to us)</span>
          <span>{company?.currency || 'TZS'} {money(statement.total_debit)}</span>
        </div>
        <div className="receipt-row">
          <span>Total Credit (we owe)</span>
          <span>{company?.currency || 'TZS'} {money(statement.total_credit)}</span>
        </div>
        <div className="receipt-hr" />
        <div className="receipt-row receipt-bold receipt-large">
          {net === 0 ? (
            <span>FULLY RECONCILED</span>
          ) : net > 0 ? (
            <>
              <span>PARTY OWES US</span>
              <span>{company?.currency || 'TZS'} {money(net)}</span>
            </>
          ) : (
            <>
              <span>WE OWE PARTY</span>
              <span>{company?.currency || 'TZS'} {money(Math.abs(net))}</span>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
