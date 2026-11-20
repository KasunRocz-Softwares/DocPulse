import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AiSummaryProvider,
  AiSummaryProviderInput,
  AiSummaryProviderOutput,
} from "./ai-summary-provider";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SUMMARY_LENGTH = 5_000;

@Injectable()
export class HttpAiSummaryProvider implements AiSummaryProvider {
  readonly providerName = "openai-compatible";
  private readonly logger = new Logger(HttpAiSummaryProvider.name);

  constructor(private readonly config: ConfigService) {}

  async generate(
    input: AiSummaryProviderInput,
  ): Promise<AiSummaryProviderOutput> {
    const endpoint = this.config.get<string>("AI_SUMMARY_PROVIDER_URL")?.trim();
    const model = this.config.get<string>("AI_SUMMARY_MODEL")?.trim();
    const apiKey = this.config
      .get<string>("AI_SUMMARY_PROVIDER_API_KEY")
      ?.trim();
    if (!endpoint || !model) {
      throw new ServiceUnavailableException(
        "AI summaries are not configured: set AI_SUMMARY_PROVIDER_URL and AI_SUMMARY_MODEL",
      );
    }
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
    } catch {
      throw new ServiceUnavailableException(
        "AI summary provider URL is invalid",
      );
    }
    if (endpointUrl.protocol !== "https:") {
      throw new ServiceUnavailableException(
        "AI summary provider URL must use HTTPS",
      );
    }

    const timeoutMs = this.timeoutMs();
    let response: Response;
    try {
      response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Write a concise customer-facing release summary using only the supplied public change descriptions. Do not invent details. Return only the summary text.",
            },
            { role: "user", content: JSON.stringify(input) },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      this.logger.warn("AI summary provider request failed");
      throw new ServiceUnavailableException(
        "AI summary provider is unavailable or timed out",
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `AI summary provider returned HTTP ${response.status}`,
      );
    }

    let raw: string;
    try {
      raw = await readBoundedResponseBody(response, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new ServiceUnavailableException(
          "AI summary provider response exceeded the size limit",
        );
      }
      throw new ServiceUnavailableException(
        "AI summary provider returned an unreadable response",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new ServiceUnavailableException(
        "AI summary provider returned invalid JSON",
      );
    }
    const record = asRecord(payload);
    const choices = Array.isArray(record?.choices) ? record.choices : [];
    const choice = asRecord(choices[0]);
    const message = asRecord(choice?.message);
    const summary =
      typeof message?.content === "string" ? message.content.trim() : "";
    if (!summary || summary.length > MAX_SUMMARY_LENGTH) {
      throw new ServiceUnavailableException(
        "AI summary provider returned an invalid summary",
      );
    }
    const responseModel =
      typeof record?.model === "string" && record.model.trim()
        ? record.model.trim().slice(0, 120)
        : model.slice(0, 120);
    return { summary, model: responseModel };
  }

  private timeoutMs(): number {
    const configured = Number(
      this.config.get<string>("AI_SUMMARY_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS,
    );
    if (!Number.isFinite(configured) || configured <= 0)
      return DEFAULT_TIMEOUT_MS;
    return Math.min(Math.max(Math.floor(configured), 1_000), MAX_TIMEOUT_MS);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

class ResponseTooLargeError extends Error {}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new ResponseTooLargeError();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
