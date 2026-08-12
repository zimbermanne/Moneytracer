import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { buildReceiptEscPos } from '../utils/escpos.js'
import { isBluetoothSupported, connectPrinter, printBytes, getConnectedPrinterName, disconnectPrinter } from '../utils/thermalPrinter.js'

const PAPER_WIDTH_KEY = 'moneytracer_receipt_paper_width' // '58' or '80'

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * Shows a narrow, receipt-formatted preview of a completed sale with two
 * ways to print it on a mini thermal printer:
 *  - "Print" uses the browser's normal print dialog, sized to the receipt
 *    paper width. Works with any thermal printer installed as a regular
 *    system printer (the common setup for USB/Wi-Fi/most Bluetooth
 *    printers once their driver is installed) — no special permissions
 *    needed, works on every platform.
 *  - "Print via Bluetooth" talks directly to the printer over Web
 *    Bluetooth using raw ESC/POS commands — useful for printers with no
 *    driver installed. Chrome/Edge desktop and Android only.
 *
 * receipt shape: { receipt_no, sales: [{item_name, quantity, unit_price, total}],
 *                   total, customer_name, payment_mode, created_at }
 * company shape: { name, address, phone }
 */
export default function ThermalReceipt({ receipt, company, onClose }) {
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
      const charsPerLine = paperWidth === '80' ? 48 : 32
      const bytes = buildReceiptEscPos(receipt, company, charsPerLine)
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

  return (
    <Modal title={`Receipt — ${receipt.receipt_no || ''}`} onClose={onClose} isDirty={false} footer={(
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
        {company?.address && <div className="receipt-center">{company.address}</div>}
        {company?.phone && <div className="receipt-center">Tel: {company.phone}</div>}
        <div className="receipt-hr" />

        <div>Receipt: {receipt.receipt_no}</div>
        <div>Date: {receipt.created_at ? new Date(receipt.created_at).toLocaleString() : new Date().toLocaleString()}</div>
        {receipt.customer_name && <div>Customer: {receipt.customer_name}</div>}
        {receipt.payment_mode && <div>Payment: {String(receipt.payment_mode).replace('_', ' ')}</div>}
        <div className="receipt-hr" />

        {(receipt.sales || []).map((s, i) => (
          <div key={s.id ?? i} className="receipt-line">
            <div>{s.item_name}</div>
            <div className="receipt-row">
              <span>{s.quantity} x {money(s.unit_price != null ? s.unit_price : (s.total / (s.quantity || 1)))}</span>
              <span>{money(s.total)}</span>
            </div>
          </div>
        ))}
        <div className="receipt-hr" />

        <div className="receipt-row receipt-bold receipt-large">
          <span>TOTAL</span>
          <span>TZS {money(receipt.total)}</span>
        </div>

        <div className="receipt-center" style={{ marginTop: 10 }}>Thank you for your business!</div>
        {receipt.receipt_no && <div className="receipt-center">Verify: {receipt.receipt_no}</div>}
      </div>
    </Modal>
  )
}
