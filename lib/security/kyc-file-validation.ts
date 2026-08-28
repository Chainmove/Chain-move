import { createHash } from "crypto"

export const KYC_MAX_FILE_SIZE = 10 * 1024 * 1024

export const KYC_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
])

export const KYC_ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".pdf"])

// Bounds shared by every caller (KYC documents and vehicle images) that decode
// approved image formats. These limits guard against decompression-bomb style
// inputs where a tiny file declares an enormous pixel grid.
export const MAX_IMAGE_DIMENSION_PX = 12000
export const MAX_IMAGE_PIXELS = 50_000_000

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

const SIGNATURES: { mime: string; extension: string[]; bytes: Buffer; offset: number }[] = [
  {
    mime: "image/jpeg",
    extension: [".jpg", ".jpeg"],
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    offset: 0,
  },
  {
    mime: "image/png",
    extension: [".png"],
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    offset: 0,
  },
  {
    mime: "image/webp",
    extension: [".webp"],
    bytes: Buffer.from("RIFF"),
    offset: 0,
  },
  {
    mime: "application/pdf",
    extension: [".pdf"],
    bytes: Buffer.from("%PDF"),
    offset: 0,
  },
]

function detectMimeType(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.mime === "image/webp") {
      if (buffer.length >= 12 && buffer.subarray(0, 4).equals(sig.bytes) && buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) {
        return sig.mime
      }
      continue
    }
    if (buffer.subarray(sig.offset, sig.offset + sig.bytes.length).equals(sig.bytes)) {
      return sig.mime
    }
  }
  return null
}

function detectExtension(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.mime === "image/webp") {
      if (buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from("RIFF")) && buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) {
        return ".webp"
      }
      continue
    }
    if (buffer.subarray(sig.offset, sig.offset + sig.bytes.length).equals(sig.bytes)) {
      return sig.extension[0]
    }
  }
  return null
}

type ImageDimensions = { width: number; height: number }

function getJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null

  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]

    // Markers without a length-prefixed payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }

    const length = buffer.readUInt16BE(offset + 2)
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)

    if (isSOF) {
      if (offset + 9 > buffer.length) return null
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      if (!width || !height) return null
      return { width, height }
    }

    if (marker === 0xda || length < 2) return null
    offset += 2 + length
  }
  return null
}

function getPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height) return null
  return { width, height }
}

function getWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 20) return null
  const chunkFourCC = buffer.subarray(12, 16).toString("ascii")

  if (chunkFourCC === "VP8 ") {
    if (buffer.length < 30) return null
    if (!(buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a)) return null
    const width = buffer.readUInt16LE(26) & 0x3fff
    const height = buffer.readUInt16LE(28) & 0x3fff
    if (!width || !height) return null
    return { width, height }
  }

  if (chunkFourCC === "VP8L") {
    if (buffer.length < 25 || buffer[20] !== 0x2f) return null
    const bits = buffer.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { width, height }
  }

  if (chunkFourCC === "VP8X") {
    if (buffer.length < 30) return null
    const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1
    const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1
    return { width, height }
  }

  return null
}

function getImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  switch (mimeType) {
    case "image/jpeg":
      return getJpegDimensions(buffer)
    case "image/png":
      return getPngDimensions(buffer)
    case "image/webp":
      return getWebpDimensions(buffer)
    default:
      return null
  }
}

export type FileValidationResult = {
  valid: boolean
  errors: string[]
  detectedMimeType: string | null
  detectedExtension: string | null
  checksumSha256: string
}

export function validateKycFile(
  buffer: Buffer,
  declaredMimeType: string,
  declaredFilename: string,
): FileValidationResult {
  const errors: string[] = []
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex")

  if (buffer.length === 0) {
    return { valid: false, errors: ["File is empty."], detectedMimeType: null, detectedExtension: null, checksumSha256 }
  }

  if (buffer.length > KYC_MAX_FILE_SIZE) {
    errors.push(`File exceeds maximum size of ${KYC_MAX_FILE_SIZE} bytes.`)
  }

  if (!KYC_ALLOWED_MIME_TYPES.has(declaredMimeType)) {
    errors.push(`Declared MIME type "${declaredMimeType}" is not allowed.`)
  }

  const declaredExt = declaredFilename.includes(".")
    ? "." + declaredFilename.split(".").pop()?.toLowerCase()
    : null
  if (declaredExt && !KYC_ALLOWED_EXTENSIONS.has(declaredExt)) {
    errors.push(`File extension "${declaredExt}" is not allowed.`)
  }

  const detectedMimeType = detectMimeType(buffer)
  const detectedExtension = detectExtension(buffer)

  if (!detectedMimeType) {
    errors.push("Unable to detect file type from content. File may be corrupted or unsupported.")
  } else if (detectedMimeType !== declaredMimeType) {
    errors.push(
      `Declared type "${declaredMimeType}" does not match detected type "${detectedMimeType}". File signature mismatch.`,
    )
  }

  if (detectedExtension && declaredExt && detectedExtension !== declaredExt) {
    errors.push(
      `Declared extension "${declaredExt}" does not match detected type "${detectedExtension}".`,
    )
  }

  if (detectedMimeType && IMAGE_MIME_TYPES.has(detectedMimeType)) {
    const dimensions = getImageDimensions(buffer, detectedMimeType)
    if (!dimensions) {
      errors.push("Unable to determine image dimensions. File may be malformed, truncated, or corrupted.")
    } else if (
      dimensions.width > MAX_IMAGE_DIMENSION_PX ||
      dimensions.height > MAX_IMAGE_DIMENSION_PX ||
      dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
    ) {
      errors.push(
        `Image dimensions ${dimensions.width}x${dimensions.height} exceed the maximum allowed ${MAX_IMAGE_DIMENSION_PX}px per side or ${MAX_IMAGE_PIXELS} total pixels.`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    detectedMimeType,
    detectedExtension,
    checksumSha256,
  }
}
