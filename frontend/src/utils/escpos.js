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

  /**
   * ESC/POS printers offer two built-in fonts: Font A (~12x24px, the
   * default, ~32 chars/line on 58mm) and Font B (~9x17px, noticeably
   * smaller, ~42 chars/line on 58mm). Using Font B for the whole receipt
   * is what actually lets more text (like the site URL) fit on a line —
   * CSS font-size only affects the on-screen preview, not the physical
   * printer, which has its own fixed character cells per font.
   */
  font(mode) {
    // 0 = Font A, 1 = Font B
    this.raw([ESC, 0x4d, mode === 'B' || mode === 1 ? 1 : 0])
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

  /**
   * Native ESC/POS QR code printing (GS ( k), supported by the near-
   * universal "generic ESC/POS" firmware on these printers. Printed by
   * the printer's own QR generator -- no image conversion needed, and it
   * comes out crisp even on cheap 203dpi heads, unlike a rasterized QR
   * image at receipt width.
   */
  qrCode(data, moduleSize = 6) {
    const bytes = toPrinterBytes(data)
    const len = bytes.length + 3
    const pL = len & 0xff
    const pH = (len >> 8) & 0xff

    // Model 2 (the common default)
    this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
    // Module size
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize])
    // Error correction level (48 = L)
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30])
    // Store the data
    this.raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...bytes])
    // Print it
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
    return this
  }

  /**
   * Raster image printing (GS v 0) for the logo — printers don't decode
   * PNG/JPEG themselves, so this expects a pre-converted 1-bit monochrome
   * bitmap: { width, height, packedBytes } as produced by
   * imageElementToMonochromeBitmap() in thermalPrinter.js. Silently no-ops
   * if bitmap is null (e.g. no logo configured, or conversion failed) so a
   * missing logo never breaks the rest of the receipt.
   */
  image(bitmap) {
    if (!bitmap) return this
    const { width, height, packedBytes } = bitmap
    const widthBytes = Math.ceil(width / 8)
    this.raw([GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff])
    this.raw(Array.from(packedBytes))
    this.raw([0x0a])
    return this
  }

  toBytes() {
    return new Uint8Array(this.bytes)
  }
}

/**
 * Build the full byte sequence for a sales receipt.
 * @param {object} receipt - { receipt_no, sales, total, customer_name, payment_mode, created_at }
 * @param {object} company - { name, address, phone, tin, vrn, owner_full_name }
 * @param {number} charsPerLine - 32 (58mm) or 48 (80mm)
 * @param {object} extra - { logoBitmap, customerPhone, customerTin, qrData, landingUrl }
 */
export function buildReceiptEscPos(receipt, company = {}, charsPerLine = 42, extra = {}) {
  const b = new EscPosBuilder(charsPerLine)
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
  const { logoBitmap, customerPhone, customerTin, qrData, landingUrl } = extra
  // Font B (smaller) for the whole receipt -- harmonizes sizing and is
  // what actually lets more characters fit per line on 58mm paper, unlike
  // a CSS font-size change which only affects the on-screen preview.
  b.font(1)
  // Printed compactly (no https:// or trailing slash) so it comfortably
  // fits one line even on 58mm -- the full URL is still shown on-screen
  // and used as-is for the QR code data, just not spelled out in text here.
  const compactUrl = landingUrl ? landingUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : ''

  b.align('center')
  if (logoBitmap) b.image(logoBitmap)
  b.bold(true)
  b.line(company.name || 'Moneytracer')
  b.bold(false)
  if (compactUrl) b.line(compactUrl)
  if (company.street_address || company.address) b.line(company.street_address || company.address)
  if (company.phone) b.line(`Tel: ${company.phone}`)
  if (company.tin) b.line(`TIN: ${company.tin}`)
  if (company.vrn) b.line(`VRN: ${company.vrn}`)
  if (company.owner_full_name) b.line(company.owner_full_name)
  b.hr('=')

  b.align('left')
  b.line(`Receipt: ${receipt.receipt_no || ''}`)
  b.line(`Date: ${receipt.created_at ? new Date(receipt.created_at).toLocaleString() : new Date().toLocaleString()}`)
  if (receipt.customer_name) b.line(`Customer: ${receipt.customer_name}`)
  if (customerPhone) b.line(`Client Phone: ${customerPhone}`)
  if (customerTin) b.line(`Client TIN: ${customerTin}`)
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
  if (qrData) {
    b.feed(1)
    b.qrCode(qrData)
    b.feed(1)
  }
  b.bold(true)
  b.line('END OF RECEIPT')
  b.bold(false)
  b.cut()

  return b.toBytes()
}
