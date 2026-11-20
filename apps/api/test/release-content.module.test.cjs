const assert = require("node:assert/strict");
const { test } = require("node:test");
const { MODULE_METADATA } = require("@nestjs/common/constants");
const {
  ClamAvAttachmentScanner,
} = require("../src/release-content/release-content.adapters");
const {
  ReleaseContentModule,
} = require("../src/release-content/release-content.module");

test("ClamAV scanner with runtime options is created through the scanner factory, not class injection", () => {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    ReleaseContentModule,
  );
  assert.equal(providers.includes(ClamAvAttachmentScanner), false);
});
