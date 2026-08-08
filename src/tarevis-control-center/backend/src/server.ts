import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { readConfig, type AppConfig } from "./config.js";
import { CompositionRoot } from "./core/composition-root.js";
import { createHttpHandler } from "./core/http-api.js";
import { RelayAgent } from "./relay/relay-agent.js";

export interface ControlCenterServer {
  root: CompositionRoot;
  server: Server;
  readonly relayAgent?: RelayAgent;
  start(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export function createControlCenterServer(config: AppConfig): ControlCenterServer {
  const root = new CompositionRoot(config);
  const server = createServer(createHttpHandler(root));
  let relayAgent: RelayAgent | undefined;
  server.on("upgrade", (request, socket, head) => {
    if (!root.realtimeHub.handleUpgrade(request, socket, head)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  return {
    root,
    server,
    get relayAgent() {
      return relayAgent;
    },
    start: () => new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(config.port, config.host, () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Server did not expose a TCP address"));
          return;
        }
        if (config.relay?.enabled) {
          relayAgent = new RelayAgent({
            config: config.relay,
            localHttpBaseUrl: localHttpBaseUrl(address.address, address.port),
            localWebSocketUrl: localWebSocketUrl(address.address, address.port),
            logger: root.logger,
          });
          relayAgent.start();
        }
        resolve({ host: config.host, port: address.port });
      });
    }),
    close: async () => {
      await relayAgent?.stop();
      await root.close();
      await root.realtimeHub.close();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function localHttpBaseUrl(host: string, port: number): string {
  return `http://${formatHost(host)}:${port}`;
}

function localWebSocketUrl(host: string, port: number): string {
  return `ws://${formatHost(host)}:${port}/ws`;
}

function formatHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return host === "::" ? "[::1]" : "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function main(): Promise<void> {
  const config = readConfig();
  const app = createControlCenterServer(config);
  const address = await app.start();
  app.root.logger.info("server.started", {
    host: address.host,
    port: address.port,
    mode: config.mode,
    traeAdapterMode: app.root.traeAdapterMode,
    traeAvailable: Boolean(app.root.trae),
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.root.logger.info("server.stopping", { signal });
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.root.logger.error("server.shutdown_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error("[control-center] startup failed", error);
    process.exitCode = 1;
  });
}
