/**
 * Minimal ESC/POS command builder for mini thermal receipt printers
 * (the cheap 58mm/80mm Bluetooth printers common with POS-58/POS-80
 * hardware). No dependencies — builds a raw Uint8Array of printer
 * commands that gets sent straight to the printer over Web Bluetooth.
 *
 * Reference: standard ESC/POS command set, supported by the near-universal
 * "generic ESC/POS" firmware these printers ship with.
 */

const ESC = 0x1b
const GS = 0x1d

// Most of these printers only understand plain ASCII/CP437 over the wire.
// We transliterate anything outside that range (accented Latin, curly
// quotes, etc.) rather than sending bytes the printer will render as
// garbage — thermal firmware rarely supports UTF-8.
function toPrinterBytes(str) {
  const cleaned = (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after decomposition
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x00-\x7E\n]/g, '?') // anything still non-ASCII becomes '?'
  const bytes = []
  for (let i = 0; i < cleaned.length; i++) bytes.push(cleaned.charCodeAt(i))
  return bytes
}

export class EscPosBuilder {
  constructor(charsPerLine = 32) {
    this.bytes = []
    this.charsPerLine = charsPerLine // 32 for 58mm at font A, 48 for 80mm
    this.raw([ESC, 0x40]) // ESC @ — initialize printer
  }

  raw(arr) {
    this.bytes.push(...arr)
    return this
  }

  text(str = '') {
    this.raw(toPrinterBytes(str))
    return this
  }

  line(str = '') {
    this.text(str)
    this.raw([0x0a])
    return this
  }

  feed(n = 1) {
    for (let i = 0; i < n; i++) this.raw([0x0a])
    return this
  }

  align(mode) {
    // 0 = left, 1 = center, 2 = right
    const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0
    this.raw([ESC, 0x61, n])
    return this
  }

  bold(on) {
    this.raw([ESC, 0x45, on ? 1 : 0])
    return this
  }

  doubleSize(on) {
    // GS ! n — 0x11 = double width + double height, 0x00 = normal
    this.raw([GS, 0x21, on ? 0x11 : 0x00])
    return this
  }

  underline(on) {
    this.raw([ESC, 0x2d, on ? 1 : 0])
    return this
  }

  hr(char = '-') {
    this.line(char.repeat(this.charsPerLine))
    return this
  }

  /** Two-column row: label on the left, value right-aligned. Wraps the
   * label onto its own line first if there isn't room to fit both. */
  row(left = '', right = '') {
    const width = this.charsPerLine
    const l = String(left)
    const r = String(right)
    if (l.length + r.length + 1 > width) {
      this.line(l)
      this.line(r.padStart(width, ' '))
    } else {
      const gap = width - l.length - r.length
      this.line(l + ' '.repeat(Math.max(1, gap)) + r)
    }
    return this
  }

  cut() {
    this.feed(3)
    this.raw([GS, 0x56, 0x42, 0x00]) // GS V B 0 — partial cut (falls back to full cut if unsupported)
    return this
  }

  toBytes() {
    return new Uint8Array(this.bytes)
  }
}

/**
 * Build the full byte sequence for a sales receipt.
 * @param {object} receipt - { receipt_no, sales: [{item_name, quantity, unit_price, total}], total, customer_name, payment_mode, created_at }
 * @param {object} company - { name, address, phone }
 * @param {number} charsPerLine - 32 (58mm) or 48 (80mm)
 */
export function buildReceiptEscPos(receipt, company = {}, charsPerLine = 32) {
  const b = new EscPosBuilder(charsPerLine)
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

  b.align('center').bold(true).doubleSize(true)
  b.line(company.name || 'Moneytracer')
  b.doubleSize(false).bold(false)
  if (company.address) b.line(company.address)
  if (company.phone) b.line(`Tel: ${company.phone}`)
  b.hr('=')

  b.align('left')
  b.line(`Receipt: ${receipt.receipt_no || ''}`)
  b.line(`Date: ${receipt.created_at ? new Date(receipt.created_at).toLocaleString() : new Date().toLocaleString()}`)
  if (receipt.customer_name) b.line(`Customer: ${receipt.customer_name}`)
  if (receipt.payment_mode) b.line(`Payment: ${String(receipt.payment_mode).replace('_', ' ')}`)
  b.hr()

  for (const s of receipt.sales || []) {
    b.line(`${s.item_name}`)
    const qty = s.quantity
    const unit = s.unit_price != null ? s.unit_price : (s.total && qty ? s.total / qty : 0)
    b.row(`  ${qty} x ${money(unit)}`, money(s.total))
  }
  b.hr()

  b.bold(true)
  b.row('TOTAL', `TZS ${money(receipt.total)}`)
  b.bold(false)
  b.feed(1)

  b.align('center')
  b.line('Thank you for your business!')
  if (receipt.receipt_no) b.line(`Verify: ${receipt.receipt_no}`)
  b.cut()

  return b.toBytes()
}
