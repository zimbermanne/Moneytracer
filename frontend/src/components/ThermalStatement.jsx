import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { buildStatementEscPos } from '../utils/escpos.js'
import {
  isBluetoothSupported, connectPrinter, printBytes, getConnectedPrinterName, disconnectPrinter,
} from '../utils/thermalPrinter.js'

const PAPER_WIDTH_KEY = 'moneytracer_receipt_paper_width' // shared with ThermalReceipt — one printer setting per user

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Narrow, receipt-formatted preview of a customer's statement of accounts,
 * with the same two print paths as ThermalReceipt: the browser's system
 * print dialog (any driver-installed printer), or direct Web Bluetooth
 * ESC/POS printing (Chrome/Edge desktop + Android only).
 *
 * statement shape: { customer_name, date_from, date_to, opening_balance,
 *   invoiced_amount, amount_received, balance_due,
 *   entries: [{ date, description, reference, invoiced, received, balance }] }
 * company shape: the full Account object — name, street_address, phone, tin, vrn.
 */
export default function ThermalStatement({ statement, company, onClose }) {
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
      const bytes = buildStatementEscPos(statement, company, charsPerLine)
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

  const entries = statement.entries || []

  return (
    <Modal title={`Statement — ${statement.customer_name || ''}`} onClose={onClose} isDirty={false} footer={(
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
        <div className="receipt-center receipt-bold">STATEMENT OF ACCOUNT</div>

        <div style={{ marginTop: 4 }}>Customer: {statement.customer_name}</div>
        {(statement.date_from || statement.date_to) && (
          <div>
            Period: {statement.date_from ? new Date(statement.date_from).toLocaleDateString() : ''}
            {' – '}
            {statement.date_to ? new Date(statement.date_to).toLocaleDateString() : ''}
          </div>
        )}
        <div>Printed: {new Date().toLocaleString()}</div>
        <div className="receipt-hr" />

        <div className="receipt-row">
          <span>Opening Balance</span>
          <span>{company?.currency || 'TZS'} {money(statement.opening_balance)}</span>
        </div>
        <div className="receipt-hr" />

        {entries.length > 0 ? entries.map((e, i) => (
          <div key={i} className="receipt-line">
            <div>
              {new Date(e.date).toLocaleDateString()} — {e.description}{e.reference ? ` (${e.reference})` : ''}
            </div>
            <div className="receipt-row receipt-small">
              <span>{e.invoiced ? `Inv ${money(e.invoiced)}` : ''} {e.received ? `Recv ${money(e.received)}` : ''}</span>
              <span>Bal {money(e.balance)}</span>
            </div>
          </div>
        )) : (
          <div className="receipt-center">No activity in this period.</div>
        )}
        <div className="receipt-hr" />

        <div className="receipt-row">
          <span>Total Invoiced</span>
          <span>TZS {money(statement.invoiced_amount)}</span>
        </div>
        <div className="receipt-row">
          <span>Total Received</span>
          <span>TZS {money(statement.amount_received)}</span>
        </div>
        <div className="receipt-hr" />

        <div className="receipt-row receipt-bold receipt-large">
          <span>BALANCE DUE</span>
          <span>TZS {money(statement.balance_due)}</span>
        </div>

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
