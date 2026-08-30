import { describe, it, expect } from "vitest"
import {
  validateKycFile,
  KYC_MAX_FILE_SIZE,
  MAX_IMAGE_DIMENSION_PX,
  MAX_IMAGE_PIXELS,
} from "@/lib/security/kyc-file-validation"

function jpegHeader(width = 100, height = 100): Buffer {
  const soi = Buffer.from([0xff, 0xd8])
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ])
  const sof0 = Buffer.alloc(19)
  sof0[0] = 0xff
  sof0[1] = 0xc0
  sof0.writeUInt16BE(17, 2)
  sof0[4] = 8
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  sof0[9] = 3
  const eoi = Buffer.from([0xff, 0xd9])
  return Buffer.concat([soi, app0, sof0, eoi])
}

function pngHeader(width = 100, height = 100): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(13, 0)
  const chunkType = Buffer.from("IHDR")
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8
  data[9] = 6
  const crc = Buffer.alloc(4)
  return Buffer.concat([sig, length, chunkType, data, crc])
}

function webpHeader(width = 100, height = 100): Buffer {
  const payload = Buffer.alloc(10)
  payload[3] = 0x9d
  payload[4] = 0x01
  payload[5] = 0x2a
  payload.writeUInt16LE(width & 0x3fff, 6)
  payload.writeUInt16LE(height & 0x3fff, 8)
  const chunkHeader = Buffer.alloc(8)
  chunkHeader.write("VP8 ", 0)
  chunkHeader.writeUInt32LE(payload.length, 4)
  const webpChunk = Buffer.concat([chunkHeader, payload])
  const riffHeader = Buffer.alloc(12)
  riffHeader.write("RIFF", 0)
  riffHeader.writeUInt32LE(4 + webpChunk.length, 4)
  riffHeader.write("WEBP", 8)
  return Buffer.concat([riffHeader, webpChunk])
}

function pdfHeader(): Buffer {
  return Buffer.from("%PDF-1.4 test content")
}

describe("validateKycFile", () => {
  describe("valid file signatures", () => {
    it("accepts valid JPEG", () => {
      const buffer = jpegHeader()
      const result = validateKycFile(buffer, "image/jpeg", "photo.jpg")
      expect(result.valid).toBe(true)
      expect(result.detectedMimeType).toBe("image/jpeg")
      expect(result.checksumSha256).toBeTruthy()
    })

    it("accepts valid PNG", () => {
      const buffer = pngHeader()
      const result = validateKycFile(buffer, "image/png", "document.png")
      expect(result.valid).toBe(true)
      expect(result.detectedMimeType).toBe("image/png")
    })

    it("accepts valid WebP", () => {
      const buffer = webpHeader()
      const result = validateKycFile(buffer, "image/webp", "image.webp")
      expect(result.valid).toBe(true)
      expect(result.detectedMimeType).toBe("image/webp")
    })

    it("accepts valid PDF", () => {
      const buffer = pdfHeader()
      const result = validateKycFile(buffer, "application/pdf", "document.pdf")
      expect(result.valid).toBe(true)
      expect(result.detectedMimeType).toBe("application/pdf")
    })
  })

  describe("invalid file signatures", () => {
    it("rejects mismatched MIME type", () => {
      const buffer = jpegHeader()
      const result = validateKycFile(buffer, "image/png", "photo.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("does not match detected type"))).toBe(true)
    })

    it("rejects empty file", () => {
      const result = validateKycFile(Buffer.alloc(0), "image/jpeg", "empty.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("empty")
    })

    it("rejects unrecognized file type", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00])
      const result = validateKycFile(buffer, "image/jpeg", "unknown.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("Unable to detect"))).toBe(true)
    })

    it("rejects disallowed extension", () => {
      const buffer = jpegHeader()
      const result = validateKycFile(buffer, "image/jpeg", "script.exe")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("extension"))).toBe(true)
    })

    it("rejects disallowed MIME type", () => {
      const buffer = Buffer.from("not-a-file")
      const result = validateKycFile(buffer, "text/html", "page.html")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("not allowed"))).toBe(true)
    })

    it("rejects extension mismatch", () => {
      const buffer = jpegHeader()
      const result = validateKycFile(buffer, "image/jpeg", "photo.png")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("extension"))).toBe(true)
    })
  })

  describe("file size validation", () => {
    it("rejects oversized file", () => {
      const buffer = Buffer.alloc(KYC_MAX_FILE_SIZE + 1)
      jpegHeader().copy(buffer)
      const result = validateKycFile(buffer, "image/jpeg", "big.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("size"))).toBe(true)
    })

    it("accepts file at max size", () => {
      const buffer = Buffer.alloc(KYC_MAX_FILE_SIZE)
      jpegHeader().copy(buffer)
      const result = validateKycFile(buffer, "image/jpeg", "max.jpg")
      expect(result.valid).toBe(true)
    })
  })

  describe("image dimension bounds", () => {
    it("rejects a truncated JPEG with no decodable dimensions", () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff])
      const result = validateKycFile(buffer, "image/jpeg", "truncated.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("Unable to determine image dimensions"))).toBe(true)
    })

    it("rejects an image wider than the maximum allowed dimension", () => {
      const buffer = jpegHeader(MAX_IMAGE_DIMENSION_PX + 1, 100)
      const result = validateKycFile(buffer, "image/jpeg", "wide.jpg")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("exceed the maximum allowed"))).toBe(true)
    })

    it("rejects a decompression-bomb image whose pixel count exceeds the cap even though each side is within bounds", () => {
      const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1000
      const buffer = pngHeader(side, side)
      const result = validateKycFile(buffer, "image/png", "bomb.png")
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("exceed the maximum allowed"))).toBe(true)
    })

    it("accepts a WebP image within bounds", () => {
      const buffer = webpHeader(200, 150)
      const result = validateKycFile(buffer, "image/webp", "photo.webp")
      expect(result.valid).toBe(true)
    })

    it("does not require image dimensions for PDF files", () => {
      const result = validateKycFile(pdfHeader(), "application/pdf", "document.pdf")
      expect(result.valid).toBe(true)
    })
  })

  describe("checksum", () => {
    it("returns consistent checksum for same content", () => {
      const buffer = pngHeader()
      const r1 = validateKycFile(buffer, "image/png", "a.png")
      const r2 = validateKycFile(buffer, "image/png", "b.png")
      expect(r1.checksumSha256).toBe(r2.checksumSha256)
    })

    it("returns different checksum for different content", () => {
      const r1 = validateKycFile(pngHeader(), "image/png", "a.png")
      const r2 = validateKycFile(jpegHeader(), "image/jpeg", "a.jpg")
      expect(r1.checksumSha256).not.toBe(r2.checksumSha256)
    })
  })
})
