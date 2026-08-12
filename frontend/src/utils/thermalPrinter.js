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
    throw new Error('This browser does not support Bluetooth printing. Use Chrome or Edge on desktop or Android, or print via a system-installed printer instead.')
  }

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: KNOWN_PRINTER_SERVICES,
  })

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
