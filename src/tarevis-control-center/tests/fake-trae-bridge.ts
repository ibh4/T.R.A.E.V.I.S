import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

export type FakeBridgeReadiness = "online" | "degraded" | "offline";

export class FakeTraeBridge {
  private readonly server: Server;
  private port = 0;
  readiness: FakeBridgeReadiness = "online";
  readonly requestIds: string[] = [];

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Fake Bridge did not expose a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    const closed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
    this.server.closeAllConnections();
    await closed;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET" && request.url === "/ready") {
      if (this.readiness === "offline") {
        request.socket.destroy();
        return;
      }
      const ready = this.readiness === "online";
      this.sendJson(response, ready ? 200 : 503, {
        success: ready,
        ready,
        reason: ready ? undefined : "TRAE window unavailable",
      });
      return;
    }

    if (request.method === "POST" && request.url === "/send") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        requestId: string;
        text: string;
      };
      this.requestIds.push(body.requestId);

      if (body.text.includes("[fake:timeout]")) return;

      await new Promise((resolve) => setTimeout(resolve, 180));
      if (body.text.includes("[fake:long-error]")) {
        this.sendJson(response, 503, {
          success: false,
          requestId: body.requestId,
          sent: false,
          strategy: "fake",
          message: "not sent",
          response: { status: "skipped", reason: "not sent" },
          sentAt: new Date().toISOString(),
          error: {
            code: "FAKE_BRIDGE_ERROR",
            message: "FAKE_BRIDGE_LONG_ERROR_".repeat(220),
          },
        });
        return;
      }

      if (body.text.includes("[fake:fail]")) {
        this.sendJson(response, 503, {
          success: false,
          requestId: body.requestId,
          sent: false,
          strategy: "fake",
          message: "TRAE disconnected before delivery",
          response: { status: "skipped", reason: "not sent" },
          sentAt: new Date().toISOString(),
          error: { code: "TRAE_UNAVAILABLE", message: "TRAE disconnected before delivery" },
        });
        return;
      }

      const responseUnavailable = body.text.includes("[fake:unavailable]");
      this.sendJson(response, 200, {
        success: true,
        requestId: body.requestId,
        sent: true,
        strategy: "fake",
        message: "prompt sent",
        response: responseUnavailable
          ? { status: "unavailable", reason: "reply pane unavailable" }
          : { status: "read", text: "Fake TRAE 已返回可读回复。" },
        sentAt: new Date().toISOString(),
      });
      return;
    }

    this.sendJson(response, 404, { success: false });
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}
