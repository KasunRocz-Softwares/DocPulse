import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../dist/cjs/index.js", import.meta.url),
  new URL("../dist/index.cjs", import.meta.url),
);
