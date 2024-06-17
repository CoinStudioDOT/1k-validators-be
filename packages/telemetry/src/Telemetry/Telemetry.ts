import WebSocket from "ws";

import { Config, Constants, logger, queries, Util, metrics } from "@1kv/common";
import { registerTelemetryWs } from "./TelemetryWS";

export default class TelemetryClient {
  private _chains: string[];
  private config: Config.ConfigSchema;
  private _host: string;
  private _socket: WebSocket;
  // map of name -> boolean
  private beingReported: Map<string, boolean> = new Map();

  // Nodes that may be disconnected but aren't necessarily offline
  private _disconnectedNodes: Map<string, number> = new Map();

  // map of name -> the time of being offline
  private _offlineNodes: Map<string, number> = new Map();

  private enable = true;

  private _memNodes = {};

  private _isConnected = false;
  get isConnected(): boolean {
    return this._isConnected;
  }

  set isConnected(isConnected: boolean) {
    this._isConnected = isConnected;
    metrics.setTelemetryConnectivity(isConnected);
  }

  constructor(config: Config.ConfigSchema) {
    this.config = config;
    this._host =
      this.config.telemetry.host || Constants.DEFAULT_TELEMETRY_ENDPONT;

    this.enable = config.telemetry.enable;

    if (!this.enable) {
      logger.warn("Telemetry Client not enabled.", {
        label: "Telemetry",
      });
    }

    this._chains = this.config?.telemetry?.chains;
    this._memNodes = {};
  }

  public initializeWebSocket() {
    try {
      this._socket = new WebSocket(this._host);
    } catch (e) {
      logger.error(`Error initializing telemetry websocket: ${e}`, {
        label: "Telemetry",
      });
    }
  }

  get host(): string {
    return this._host;
  }

  get chains(): string[] {
    return this._chains;
  }

  get disconnectedNodes(): Map<string, number> {
    return this._disconnectedNodes;
  }

  get offlineNodes(): Map<string, number> {
    return this._offlineNodes;
  }

  get memNodes(): any {
    return this._memNodes;
  }

  get socket(): WebSocket {
    return this._socket;
  }

  async start(retries = 0): Promise<void> {
    const maxRetries = 5;
    if (!this.enable) {
      logger.warn("Telemetry Client not enabled.", { label: "Telemetry" });
      return;
    }

    if (retries >= maxRetries) {
      logger.error("Maximum retry attempts reached, giving up", {
        label: "Telemetry",
      });
      return;
    }

    try {
      await registerTelemetryWs(this);
      await Util.initIIT(this.config?.telemetry?.ipinfoToken);
    } catch (error) {
      logger.error(`Telemetry connection error: ${error}`, {
        label: "Telemetry",
      });
      const retryDelay = Math.pow(2, retries) * 1000; // Exponential backoff
      await Util.sleep(retryDelay);
      await this.start(retries + 1);
    }
  }

  public async reconnect(retries = 0): Promise<void> {
    const maxRetries = 5; // Maximum number of retry attempts
    const retryDelayBase = 2000; // Base delay time in ms (2 seconds)

    if (retries >= maxRetries) {
      logger.error("Maximum retry attempts reached, giving up", {
        label: "Telemetry",
      });
      return;
    }

    const retryDelay = retryDelayBase * Math.pow(2, retries); // Exponential backoff
    logger.info(`Retrying connection in ${retryDelay}ms`, {
      label: "Telemetry",
    });
    await Util.sleep(retryDelay);

    try {
      await this.start(0);
    } catch (e) {
      logger.error(`Telemetry error on retry: ${e}`, { label: "Telemetry" });
      await this.reconnect(retries + 1);
    }
  }

  public async disconnect() {
    if (this.socket) {
      this.socket.close();
    }
  }

  public async checkHealth(): Promise<boolean> {
    // Check if the WebSocket connection is open
    const isHealthy = this.socket && this.socket.readyState === WebSocket.OPEN;

    if (!isHealthy) {
      logger.warn("Telemetry service is unhealthy.", { label: "Telemetry" });
    }

    return isHealthy;
  }

  public async checkOffline() {
    for (const [name, disconnectedAt] of this.disconnectedNodes.entries()) {
      if (Date.now() - disconnectedAt > Constants.FIVE_MINUTES) {
        this.disconnectedNodes.delete(name);
        logger.info(`${name} has been disconnected for more than 5 minutes`, {
          label: "Telemetry",
        });
        await queries.reportOffline(name);
        this.offlineNodes.set(name, disconnectedAt);
      }
    }
  }
}
