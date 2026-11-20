import { BadRequestException } from "@nestjs/common";

interface AttachmentTypeRule {
  contentType: string;
  acceptedContentTypes: ReadonlySet<string>;
  matches: (buffer: Buffer) => boolean;
}

function isText(buffer: Buffer): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(decoded);
  } catch {
    return false;
  }
}

const text = (contentType: string): AttachmentTypeRule => ({
  contentType,
  acceptedContentTypes: new Set([contentType]),
  matches: isText,
});

const rules: Record<string, AttachmentTypeRule> = {
  ".txt": text("text/plain"),
  ".log": text("text/plain"),
  ".md": {
    ...text("text/markdown"),
    acceptedContentTypes: new Set(["text/markdown", "text/plain"]),
  },
  ".csv": {
    ...text("text/csv"),
    acceptedContentTypes: new Set(["text/csv", "application/csv"]),
  },
  ".json": {
    contentType: "application/json",
    acceptedContentTypes: new Set(["application/json", "text/json"]),
    matches: (buffer) => {
      if (!isText(buffer)) return false;
      try {
        JSON.parse(buffer.toString("utf8"));
        return true;
      } catch {
        return false;
      }
    },
  },
  ".yaml": {
    contentType: "application/yaml",
    acceptedContentTypes: new Set([
      "application/yaml",
      "text/yaml",
      "text/plain",
    ]),
    matches: isText,
  },
  ".yml": {
    contentType: "application/yaml",
    acceptedContentTypes: new Set([
      "application/yaml",
      "text/yaml",
      "text/plain",
    ]),
    matches: isText,
  },
  ".pdf": {
    contentType: "application/pdf",
    acceptedContentTypes: new Set(["application/pdf"]),
    matches: (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  ".zip": {
    contentType: "application/zip",
    acceptedContentTypes: new Set([
      "application/zip",
      "application/x-zip-compressed",
    ]),
    matches: (buffer) =>
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
        (buffer[2] === 0x05 && buffer[3] === 0x06) ||
        (buffer[2] === 0x07 && buffer[3] === 0x08)),
  },
  ".tar": {
    contentType: "application/x-tar",
    acceptedContentTypes: new Set(["application/x-tar", "application/tar"]),
    matches: (buffer) =>
      buffer.length >= 262 &&
      buffer.subarray(257, 262).toString("ascii") === "ustar",
  },
  ".gz": {
    contentType: "application/gzip",
    acceptedContentTypes: new Set(["application/gzip", "application/x-gzip"]),
    matches: (buffer) => buffer[0] === 0x1f && buffer[1] === 0x8b,
  },
  ".tgz": {
    contentType: "application/gzip",
    acceptedContentTypes: new Set(["application/gzip", "application/x-gzip"]),
    matches: (buffer) => buffer[0] === 0x1f && buffer[1] === 0x8b,
  },
  ".png": {
    contentType: "image/png",
    acceptedContentTypes: new Set(["image/png"]),
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  ".jpg": {
    contentType: "image/jpeg",
    acceptedContentTypes: new Set(["image/jpeg"]),
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  ".jpeg": {
    contentType: "image/jpeg",
    acceptedContentTypes: new Set(["image/jpeg"]),
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  ".gif": {
    contentType: "image/gif",
    acceptedContentTypes: new Set(["image/gif"]),
    matches: (buffer) =>
      buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a",
  },
  ".webp": {
    contentType: "image/webp",
    acceptedContentTypes: new Set(["image/webp"]),
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
};

export function validateAttachmentType(
  fileName: string,
  declaredContentType: string,
  buffer: Buffer,
): string {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const rule = rules[extension];
  const contentType = declaredContentType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (
    !rule ||
    !contentType ||
    !rule.acceptedContentTypes.has(contentType) ||
    !buffer.length ||
    !rule.matches(buffer)
  )
    throw new BadRequestException(
      "Attachment file type is unsupported or does not match its content",
    );

  return rule.contentType;
}
