import { useState } from 'react'
import Modal from './Modal.jsx'
import Table from './Table.jsx'
import { useApi } from '../hooks/useApi.js'
import { apiUrl } from '../api-config.js'
import { downloadFile } from '../utils/download.js'
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
 * Dedicated Account Reconciliation & Contra Offset Window.
 *
 * Pulls every Debtor row and every Creditor row tied to a single party (GET /ledgers/reconcile),
 * displays a unified accounting ledger with net position, enables single-click
 * Contra Offset netting (POST /ledgers/reconcile/offset) to clear overlapping debt, and
 * exports a formal A4 PDF Reconciliation Statement (GET /ledgers/reconcile/pdf).
 */
export default function ReconciliationStatement({ company, initialPhone = '', initialTin = '', onClose }) {
  const api = useApi()
  const [phone, setPhone] = useState(initialPhone)
  const [tin, setTin] = useState(initialTin)
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(false)
  const [offsetting, setOffsetting] = useState(false)
  const [showThermalPreview, setShowThermalPreview] = useState(false)
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
    const unpaidDebtor = statement.entries.filter((e) => e.kind === 'debit').reduce((s, e) => s + (e.amount - e.paid), 0)
    const unpaidCreditor = statement.entries.filter((e) => e.kind === 'credit').reduce((s, e) => s + (e.amount - e.paid), 0)
    const maxOffset = Math.min(unpaidDebtor, unpaidCreditor)

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
      search()
    } catch (e) {
      setError(e.message)
    } finally {
      setOffsetting(false)
    }
  }

  const handleExportPdf = () => {
    if (!statement) return
    const params = new URLSearchParams()
    if (statement.phone || phone) params.set('phone', statement.phone || phone)
    if (statement.tin_number || tin) params.set('tin', statement.tin_number || tin)
    const filename = `ReconciliationStatement-${statement.party_name.replace(/\s+/g, '-')}.pdf`
    downloadFile(apiUrl(`/api/ledgers/reconcile/pdf?${params.toString()}`), filename)
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

  // ---- Step 1: Search Form Modal ----
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
          A counterparty can be both a customer (Debtor) and a supplier (Creditor).
          Enter their phone number or TIN to pull their unified ledger statement.
        </div>
        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="form-row">
          <label>Phone Number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. +255 7XX XXX XXX" />
        </div>
        <div className="form-row">
          <label>TIN Number</label>
          <input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="Tax ID Number" />
        </div>
      </Modal>
    )
  }

  // ---- Step 2: Dedicated Reconciliation Window ----
  const net = statement.net_balance || 0
  const unpaidDebtor = statement.entries.filter((e) => e.kind === 'debit').reduce((s, e) => s + (e.amount - e.paid), 0)
  const unpaidCreditor = statement.entries.filter((e) => e.kind === 'credit').reduce((s, e) => s + (e.amount - e.paid), 0)
  const maxOffset = Math.min(unpaidDebtor, unpaidCreditor)

  const columns = [
    { key: 'date', header: 'Date', render: (r) => shortDate(r.date) },
    { key: 'doc_no', header: 'Ref #', render: (r) => <strong>{r.doc_no}</strong> },
    {
      key: 'kind',
      header: 'Type',
      render: (r) => (
        <span className={`badge badge-${r.kind === 'debit' ? 'unpaid' : 'partial'}`}>
          {r.kind === 'debit' ? 'Debtor (Receivable)' : 'Creditor (Payable)'}
        </span>
      ),
    },
    { key: 'reference', header: 'Notes / Reference', render: (r) => r.reference || '—' },
    { key: 'amount', header: 'Total Owed', render: (r) => `TZS ${money(r.amount)}` },
    { key: 'paid', header: 'Paid', render: (r) => `TZS ${money(r.paid)}` },
    {
      key: 'balance',
      header: 'Net Running Balance',
      render: (r) => (
        <strong style={{ color: r.balance > 0 ? 'var(--success)' : r.balance < 0 ? 'var(--danger)' : 'inherit' }}>
          TZS {money(Math.abs(r.balance))} {r.balance > 0 ? '(Dr)' : r.balance < 0 ? '(Cr)' : ''}
        </strong>
      ),
    },
  ]

  return (
    <Modal
      title={`Reconciliation Statement — ${statement.party_name}`}
      onClose={onClose}
      wide={true}
      footer={(
        <>
          <button className="btn btn-outline" onClick={() => setStatement(null)}>← New Search</button>
          <button className="btn btn-outline" onClick={() => setShowThermalPreview(!showThermalPreview)}>
            {showThermalPreview ? '📋 Hide Thermal Receipt' : '🖨 Thermal Receipt'}
          </button>
          {isBluetoothSupported() && (
            <button className="btn btn-outline" onClick={handleBluetoothPrint} disabled={btBusy}>
              {btBusy ? 'Sending…' : btPrinterName ? `🖨 Print to ${btPrinterName}` : '🔵 Bluetooth Print'}
            </button>
          )}
          <button className="btn btn-primary" onClick={handleExportPdf}>⬇ Export PDF Statement</button>
          <button className="btn btn-outline" onClick={handleSystemPrint}>🖨 Print</button>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </>
      )}
    >
      {notice && <div style={{ color: 'var(--success)', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Summary Header Card */}
      <div className="card" style={{ padding: 18, marginBottom: 20, background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{statement.party_name}</h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Phone: {statement.phone || '—'} | TIN: {statement.tin_number || '—'} | Matched on: {MATCH_LABELS[statement.matched_on] || statement.matched_on}
            </div>
          </div>
          <span className={`badge badge-${net === 0 ? 'paid' : net > 0 ? 'unpaid' : 'partial'}`} style={{ fontSize: 13, padding: '6px 12px' }}>
            {net === 0 ? 'SETTLED / RECONCILED' : net > 0 ? 'THEY OWE US' : 'WE OWE THEM'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, padding: 14, background: 'var(--surface-sunken)', borderRadius: 10 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Total Receivable (Debtor)</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-dark)', marginTop: 2 }}>TZS {money(statement.total_debit)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Total Payable (Creditor)</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-dark)', marginTop: 2 }}>TZS {money(statement.total_credit)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Net Position</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: net > 0 ? 'var(--success)' : net < 0 ? 'var(--danger)' : 'var(--text-dark)', marginTop: 2 }}>
              TZS {money(Math.abs(net))} {net > 0 ? '(Dr)' : net < 0 ? '(Cr)' : ''}
            </div>
          </div>
        </div>

        {maxOffset > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Overlapping Debt Available for Contra Offset</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                You can offset <strong>TZS {money(maxOffset)}</strong> directly between Debtor and Creditor balances in equal measure.
              </div>
            </div>
            <button className="btn btn-primary" onClick={handleOffset} disabled={offsetting}>
              {offsetting ? 'Offsetting…' : '⚡ Contra Offset Net Balance'}
            </button>
          </div>
        )}
      </div>

      {/* Unified Chronological Ledger Table */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Unified Ledger Entries</h3>
        <Table
          columns={columns}
          rows={statement.entries || []}
          emptyText="No transactions on record for this account."
        />
      </div>

      {/* Optional Thermal Printer Preview Section */}
      {showThermalPreview && (
        <div style={{ marginTop: 20, paddingTop: 18, borderTop: '2px dashed var(--border)' }}>
          <h4 style={{ margin: '0 0 10px' }}>Thermal Receipt Print Preview</h4>
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
        </div>
      )}
    </Modal>
  )
}
