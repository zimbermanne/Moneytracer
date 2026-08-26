import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { buildDebtorStatementEscPos } from '../utils/escpos.js'
import {
  isBluetoothSupported, connectPrinter, printBytes, getConnectedPrinterName, disconnectPrinter,
} from '../utils/thermalPrinter.js'

const PAPER_WIDTH_KEY = 'moneytracer_receipt_paper_width' // shared with ThermalReceipt/ThermalStatement — one printer setting per user

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Narrow, receipt-formatted print view of a single Debtor's item-level
 * statement — item name, quantity, date recorded, unit price, and running
 * total_owed/amount_paid/balance. Distinct from ThermalStatement (used for
 * Customers/invoices): a Debtor has no invoiced/received ledger, just a
 * flat list of items bought on credit (DebtorItem) plus a manually-tracked
 * total_owed. total_owed does not necessarily equal the sum of the printed
 * items (see Debtor model docstring) — both are shown, never one derived
 * from the other, so the printed balance always matches what's owed.
 *
 * debtor shape: { name, phone, note, total_owed, amount_paid, created_at,
 *   items: [{ description, quantity, unit_price, created_at }] }
 * company shape: the full Account object — name, street_address, phone, tin, vrn.
 */
export default function DebtorStatement({ debtor, company, onClose }) {
  const [paperWidth, setPaperWidth] = useState(() => localStorage.getItem(PAPER_WIDTH_KEY) || '58')
  const [btBusy, setBtBusy] = useState(false)
  const [btPrinterName, setBtPrinterName] = useState(getConnectedPrinterName())
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    localStorage.setItem(PAPER_WIDTH_KEY, paperWidth)
  }, [paperWidth])

  const handleSystemPrint = () => {
    window.print()
  }

  const handleBluetoothPrint = async () => {
    setError(''); setNotice(''); setBtBusy(true)
    try {
      if (!btPrinterName) {
        const conn = await connectPrinter()
        setBtPrinterName(conn.name)
      }
      const charsPerLine = paperWidth === '80' ? 64 : 42 // Font B char counts, not Font A's 48/32
      const bytes = buildDebtorStatementEscPos(debtor, company, charsPerLine)
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

  const items = debtor.items || []
  const itemsTotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
  const balance = (debtor.total_owed || 0) - (debtor.amount_paid || 0)
  // Multi-country app — always show the tenant's own currency (set from
  // their account's country), not a fixed "TZS".
  const currency = company?.currency || 'TZS'

  return (
    <Modal title={`Debtor Statement — ${debtor.name || ''}`} onClose={onClose} isDirty={false} footer={(
      <>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        {isBluetoothSupported() && (
          <button className="btn btn-outline" onClick={handleBluetoothPrint} disabled={btBusy}>
            {btBusy ? 'Sending…' : btPrinterName ? `🖨 Print to ${btPrinterName}` : '🔵 Print via Bluetooth'}
          </button>
        )}
        <button className="btn btn-primary" onClick={handleSystemPrint}>🖨 Print</button>
      </>
    )}>
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

      {!isBluetoothSupported() && (
        <div className="receipt-hint">
          Direct Bluetooth printing isn't available in this browser. Use "Print" instead — it works with any
          thermal printer already installed as a system printer (via USB, Wi-Fi, or its Bluetooth driver).
        </div>
      )}
      {notice && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 8 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}

      <div className={`receipt-print-area receipt-width-${paperWidth}`}>
        <div className="receipt-center receipt-bold receipt-large">{company?.name || 'Moneytracer'}</div>
        {(company?.street_address || company?.address) && (
          <div className="receipt-center">{company.street_address || company.address}</div>
        )}
        {company?.phone && <div className="receipt-center">Tel: {company.phone}</div>}
        {company?.tin && <div className="receipt-center">TIN: {company.tin}</div>}
        {company?.vrn && <div className="receipt-center">VRN: {company.vrn}</div>}
        <div className="receipt-hr" />
        <div className="receipt-center receipt-bold receipt-large">DEBTOR STATEMENT</div>

        <div style={{ marginTop: 4 }}>Client: {debtor.name}</div>
        {debtor.phone && <div>Phone: {debtor.phone}</div>}
        <div>Since: {debtor.created_at ? new Date(debtor.created_at).toLocaleDateString() : ''}</div>
        <div>Printed: {new Date().toLocaleString()}</div>
        <div className="receipt-hr" />

        {items.length > 0 && <div className="receipt-bold">ITEMS BOUGHT ON CREDIT</div>}
        {items.length > 0 ? items.map((it, i) => (
          <div key={i} className="receipt-line" style={{ marginBottom: 6 }}>
            <div>
              {i + 1}. {it.description}
              {it.created_at ? ` (${new Date(it.created_at).toLocaleDateString()})` : ''}
            </div>
            <div className="receipt-small" style={{ paddingInlineStart: 12 }}>
              Qty: {it.quantity}&nbsp;&nbsp;&nbsp;Price: {currency} {money(it.unit_price)}
            </div>
            <div className="receipt-row receipt-small" style={{ paddingInlineStart: 12 }}>
              <span>Subtotal</span>
              <span>{currency} {money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</span>
            </div>
          </div>
        )) : (
          <div className="receipt-center">No items on record for this debt.</div>
        )}
        {items.length > 0 && (
          <>
            <div className="receipt-hr" />
            <div className="receipt-row receipt-bold">
              <span>Items Total</span>
              <span>{currency} {money(itemsTotal)}</span>
            </div>
          </>
        )}
        <div className="receipt-hr" />

        <div className="receipt-bold">ACCOUNT SUMMARY</div>
        <div className="receipt-row">
          <span>Total Owed</span>
          <span>{currency} {money(debtor.total_owed)}</span>
        </div>
        <div className="receipt-row">
          <span>Amount Paid</span>
          <span>{currency} {money(debtor.amount_paid)}</span>
        </div>
        <div className="receipt-hr" />

        <div className="receipt-row receipt-bold receipt-large">
          <span>{balance < 0 ? 'OVERPAID BY' : 'BALANCE DUE'}</span>
          <span>{currency} {money(Math.abs(balance))}</span>
        </div>

        {debtor.note && <div style={{ marginTop: 8 }}>Note: {debtor.note}</div>}

        <div className="receipt-center" style={{ marginTop: 10 }}>Thank you for your business!</div>
        <div className="receipt-center receipt-bold" style={{ marginTop: 6 }}>END OF STATEMENT</div>

        <div className="receipt-hr" style={{ borderStyle: 'dashed', marginTop: 12 }} />
        <div className="receipt-center receipt-small" style={{ marginTop: 4, fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1.5 }}>
          &#9888; CAUTION THIS IS NOT EFD RECEIPT.
        </div>
      </div>
    </Modal>
  )
}
