import * as assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { validateAttachmentType } from "./attachment-type.validation";

test("validates supported text attachments and canonicalizes Markdown MIME", () => {
  assert.equal(
    validateAttachmentType(
      "release-notes.md",
      "text/plain; charset=utf-8",
      Buffer.from("# Release notes\n\nVerified text."),
    ),
    "text/markdown",
  );
});

test("rejects active or unsupported file extensions even when MIME is spoofed", () => {
  assert.throws(
    () =>
      validateAttachmentType(
        "payload.html",
        "text/plain",
        Buffer.from("<script>alert(1)</script>"),
      ),
    BadRequestException,
  );
});

test("requires the PDF signature and matching declared MIME type", () => {
  assert.equal(
    validateAttachmentType(
      "manual.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7\nfile"),
    ),
    "application/pdf",
  );
  assert.throws(
    () =>
      validateAttachmentType(
        "manual.pdf",
        "application/pdf",
        Buffer.from("not a PDF"),
      ),
    BadRequestException,
  );
  assert.throws(
    () =>
      validateAttachmentType(
        "manual.pdf",
        "application/zip",
        Buffer.from("%PDF-1.7"),
      ),
    BadRequestException,
  );
});

test("requires ZIP signature and strict UTF-8 for supported text types", () => {
  assert.equal(
    validateAttachmentType(
      "artifact.zip",
      "application/zip",
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
    ),
    "application/zip",
  );
  assert.throws(
    () =>
      validateAttachmentType(
        "artifact.zip",
        "application/zip",
        Buffer.from("plain text"),
      ),
    BadRequestException,
  );
  assert.throws(
    () =>
      validateAttachmentType(
        "release.txt",
        "text/plain",
        Buffer.from([0xff, 0xfe, 0x00]),
      ),
    BadRequestException,
  );
});

test("parses JSON attachments before accepting them", () => {
  assert.equal(
    validateAttachmentType(
      "manifest.json",
      "application/json",
      Buffer.from('{"version":"1.2.3"}'),
    ),
    "application/json",
  );
  assert.throws(
    () =>
      validateAttachmentType(
        "manifest.json",
        "application/json",
        Buffer.from("{invalid}"),
      ),
    BadRequestException,
  );
});
