import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createConnection } from "node:net";

export interface AttachmentStorage {
  put(bytes: Buffer): Promise<{ storageKey: string; checksumSha256: string }>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export interface AttachmentScanner {
  scan(bytes: Buffer): Promise<"CLEAN" | "INFECTED" | "FAILED">;
}

@Injectable()
export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly root = resolve(
    process.env.RDPS_UPLOAD_DIR || join(process.cwd(), ".rdps-uploads"),
  );

  async put(bytes: Buffer) {
    await mkdir(this.root, { recursive: true });
    const storageKey = randomUUID();
    await writeFile(this.path(storageKey), bytes, { flag: "wx", mode: 0o600 });
    return {
      storageKey,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  get(storageKey: string) {
    return readFile(this.path(storageKey));
  }

  async delete(storageKey: string) {
    await rm(this.path(storageKey), { force: true });
  }

  private path(storageKey: string) {
    if (
      basename(storageKey) !== storageKey ||
      !/^[0-9a-f-]{36}$/i.test(storageKey)
    )
      throw new Error("Invalid attachment storage key");
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}/`) && !path.startsWith(`${this.root}\\`))
      throw new Error("Invalid attachment storage key");
    return path;
  }
}

/** Development-only scanner: detects the standard EICAR test signature, not arbitrary malware. */
@Injectable()
export class EicarDevelopmentScanner implements AttachmentScanner {
  async scan(bytes: Buffer): Promise<"CLEAN" | "INFECTED" | "FAILED"> {
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    return bytes.includes(eicar) ? "INFECTED" : "CLEAN";
  }
}

export type ClamAvOptions = {
  host?: string;
  port?: number;
  timeoutMs?: number;
};

@Injectable()
export class ClamAvAttachmentScanner implements AttachmentScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(options: ClamAvOptions = {}) {
    this.host = options.host ?? process.env.CLAMAV_HOST ?? "";
    this.port = options.port ?? Number(process.env.CLAMAV_PORT || 3310);
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.CLAMAV_TIMEOUT_MS || 5000);
  }

  scan(bytes: Buffer): Promise<"CLEAN" | "INFECTED" | "FAILED"> {
    if (
      !this.host ||
      !Number.isInteger(this.port) ||
      this.port < 1 ||
      this.port > 65535
    ) {
      return Promise.reject(
        new ServiceUnavailableException("Attachment scanner unavailable"),
      );
    }
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let response = "";
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(
          new ServiceUnavailableException("Attachment scanner unavailable"),
        );
      };
      socket.setTimeout(this.timeoutMs, fail);
      socket.on("error", fail);
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
          const chunk = bytes.subarray(
            offset,
            Math.min(offset + 1024 * 1024, bytes.length),
          );
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
        if (response.includes(" FOUND")) {
          settled = true;
          socket.destroy();
          resolve("INFECTED");
        } else if (response.includes(" OK")) {
          settled = true;
          socket.destroy();
          resolve("CLEAN");
        } else if (response.length > 4096) {
          fail();
        }
      });
      socket.on("end", () => {
        if (!settled) fail();
      });
    });
  }
}

export function createAttachmentScanner(
  environment = process.env.NODE_ENV,
): AttachmentScanner {
  return environment === "development" || environment === "test"
    ? new EicarDevelopmentScanner()
    : new ClamAvAttachmentScanner();
}
