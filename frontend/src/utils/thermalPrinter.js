/**
 * Connects to a mini thermal receipt printer over Web Bluetooth and sends
 * raw ESC/POS bytes to it. Covers the cheap "POS-58"/"POS-80" style BLE
 * printers common with small-shop POS setups — most run a generic ESC/POS
 * firmware exposing one writable characteristic on a proprietary printer
 * service.
 *
 * Browser support: Chrome/Edge on desktop and Android. NOT supported in
 * Safari (desktop or iOS) or Firefox — callers should check
 * isBluetoothSupported() and fall back to the system-print path.
 */

// Service/characteristic UUIDs seen across common ESC/POS BLE printer
// firmwares. We don't know in advance which one a given printer uses, so
// we advertise all of them as optionalServices and pick whichever service
// the paired device actually exposes at connect time.
const KNOWN_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // common generic printer service
  '0000ff00-0000-1000-8000-00805f9b34fb', // widely used on cheap BLE printers
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip transparent UART, used by many ESC/POS boards
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style serial-over-BLE module
]

// Keeps the connected device/characteristic in memory for the tab session
// so repeat prints don't need to re-pair. Web Bluetooth intentionally
// doesn't allow silent auto-reconnect on page load without a user gesture,
// so this only persists within the current session, not across reloads.
let cachedDevice = null
let cachedCharacteristic = null

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

async function findWritableCharacteristic(server) {
  const services = await server.getPrimaryServices()
  for (const service of services) {
    const characteristics = await service.getCharacteristics()
    for (const ch of characteristics) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        return ch
      }
    }
  }
  return null
}

/**
 * Opens the browser's device picker and connects to whichever printer the
 * user selects. Must be called from a user gesture (e.g. a click handler).
 */
export async function connectPrinter() {
  if (!isBluetoothSupported()) {
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
    throw new Error(
      isIOS
        ? "iPhones/iPads can't do Bluetooth printing — iOS Safari (and every browser on iOS, since they all use the same engine) doesn't support the Web Bluetooth feature this needs. Use the regular \"Print\" button instead, which works with an AirPrint-capable printer or the system print dialog."
        : 'This browser doesn\'t support Bluetooth printing. Use Chrome or Edge (desktop or Android), or print via a system-installed printer instead.'
    )
  }

  let device
  try {
    device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_PRINTER_SERVICES,
    })
  } catch (e) {
    // On Android, Chrome's BLE scan silently returns zero devices (so the
    // picker looks "empty" and the user just cancels it) if the phone's
    // system-level Location permission isn't granted to Chrome — BLE
    // scanning is gated behind that permission at the OS level, not
    // anything this app controls. That's the single most common reason
    // this fails on Android in practice, so surface it directly instead
    // of a generic "cancelled" message.
    if (e && e.name === 'NotFoundError') {
      throw new Error(
        'No printer was selected. If your printer didn\'t show up in the list: on Android, check that Chrome has Location permission enabled (Settings → Apps → Chrome → Permissions → Location) — Android requires it for Bluetooth device scanning to work at all. Also make sure the printer is powered on and not already connected to another phone.'
      )
    }
    throw e
  }

  const server = await device.gatt.connect()
  const characteristic = await findWritableCharacteristic(server)
  if (!characteristic) {
    throw new Error(`Connected to "${device.name || 'printer'}" but couldn't find a writable print channel on it. It may not be an ESC/POS compatible printer.`)
  }

  device.addEventListener('gattserverdisconnected', () => {
    if (cachedDevice === device) {
      cachedDevice = null
      cachedCharacteristic = null
    }
  })

  cachedDevice = device
  cachedCharacteristic = characteristic
  return { name: device.name || 'Thermal Printer' }
}

export function getConnectedPrinterName() {
  return cachedDevice?.gatt?.connected ? (cachedDevice.name || 'Thermal Printer') : null
}

export function disconnectPrinter() {
  if (cachedDevice?.gatt?.connected) cachedDevice.gatt.disconnect()
  cachedDevice = null
  cachedCharacteristic = null
}

/**
 * Sends raw ESC/POS bytes to the connected printer, chunked to a safe BLE
 * write size (many printers/adapters choke on writes over ~180-200 bytes
 * in one GATT operation regardless of the negotiated MTU).
 */
export async function printBytes(bytes) {
  if (!cachedDevice?.gatt?.connected || !cachedCharacteristic) {
    const conn = await connectPrinter()
    if (!cachedCharacteristic) throw new Error(`Could not open a print channel to ${conn.name}.`)
  }

  const CHUNK_SIZE = 180
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + CHUNK_SIZE)
    if (cachedCharacteristic.properties.writeWithoutResponse) {
      await cachedCharacteristic.writeValueWithoutResponse(chunk)
    } else {
      await cachedCharacteristic.writeValue(chunk)
    }
    // Small delay between chunks — cheap thermal printers have tiny input
    // buffers and drop bytes if flooded faster than they can print.
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Converts an <img> element into the 1-bit monochrome bitmap shape that
 * EscPosBuilder.image() expects: { width, height, packedBytes }. Thermal
 * printers only understand raw black/white raster data (GS v 0), not
 * PNG/JPEG, so this does the decode-and-threshold step in a canvas before
 * handing bytes to the printer.
 *
 * Resizes to maxWidth (defaults to a safe 384px = 58mm printers at 8
 * dots/mm) preserving aspect ratio, since printing at native resolution
 * from a source logo could be far wider than the paper.
 *
 * Returns null (rather than throwing) on any failure — a missing or
 * broken logo should never block printing the rest of the receipt.
 */
export async function imageElementToMonochromeBitmap(imgUrl, maxWidth = 384) {
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = imgUrl
    })

    const scale = Math.min(1, maxWidth / img.naturalWidth)
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    // ESC/POS raster width must be a multiple of 8 (one bit per pixel,
    // packed 8-to-a-byte) — pad rather than crop so nothing gets cut off.
    const paddedWidth = Math.ceil(width / 8) * 8

    const canvas = document.createElement('canvas')
    canvas.width = paddedWidth
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, paddedWidth, height)
    ctx.drawImage(img, 0, 0, width, height)

    const { data } = ctx.getImageData(0, 0, paddedWidth, height)
    const widthBytes = paddedWidth / 8
    const packedBytes = new Uint8Array(widthBytes * height)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < paddedWidth; x++) {
        const i = (y * paddedWidth + x) * 4
        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        const isDark = luminance < 160 // simple threshold; good enough for a logo
        if (isDark) {
          const byteIndex = y * widthBytes + (x >> 3)
          packedBytes[byteIndex] |= (0x80 >> (x % 8))
        }
      }
    }

    return { width: paddedWidth, height, packedBytes }
  } catch {
    return null
  }
}
