import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConnectorManager } from "../manager.js";
import type { SourceConfig } from "../../types/config.js";

// Import SQLite connector to ensure it's registered
import "../sqlite/index.js";

describe("ConnectorManager init_command", () => {
  let workDir: string;
  let manager: ConnectorManager | null = null;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "dbhub-init-command-"));
  });

  afterEach(async () => {
    if (manager) {
      await manager.disconnect();
      manager = null;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  function touchCommand(markerPath: string): string {
    return `node -e "require('fs').writeFileSync(process.argv[1], '')" ${JSON.stringify(markerPath)}`;
  }

  it("runs init_command before connecting an eager source", async () => {
    const marker = join(workDir, "eager-marker");
    manager = new ConnectorManager();
    const source: SourceConfig = {
      id: "eager",
      type: "sqlite",
      database: ":memory:",
      init_command: touchCommand(marker),
    };

    await manager.connectWithSources([source]);

    expect(existsSync(marker)).toBe(true);
    expect(manager.getConnector("eager")).toBeDefined();
  });

  it("defers init_command of a lazy source until first use", async () => {
    const marker = join(workDir, "lazy-marker");
    manager = new ConnectorManager();
    const source: SourceConfig = {
      id: "lazy",
      type: "sqlite",
      database: ":memory:",
      lazy: true,
      init_command: touchCommand(marker),
    };

    await manager.connectWithSources([source]);
    expect(existsSync(marker)).toBe(false);

    await manager.ensureConnected("lazy");
    expect(existsSync(marker)).toBe(true);
  });

  it("can provision the target the DSN points at", async () => {
    // The sqlite file's parent directory does not exist yet; only init_command creates it,
    // so a successful connection proves the command ran before the connection attempt.
    const dbDir = join(workDir, "provisioned");
    const dbFile = join(dbDir, "test.db");
    manager = new ConnectorManager();
    const source: SourceConfig = {
      id: "provisioned",
      type: "sqlite",
      dsn: `sqlite://${dbFile}`,
      init_command: `node -e "require('fs').mkdirSync(process.argv[1], { recursive: true })" ${JSON.stringify(dbDir)}`,
    };

    await manager.connectWithSources([source]);

    expect(existsSync(dbFile)).toBe(true);
  });

  it("fails the connection when init_command fails", async () => {
    manager = new ConnectorManager();
    const source: SourceConfig = {
      id: "failing",
      type: "sqlite",
      database: ":memory:",
      init_command: 'node -e "process.exit(1)"',
    };

    await expect(manager.connectWithSources([source])).rejects.toThrow(
      "Source 'failing': init_command failed"
    );
  });
});
