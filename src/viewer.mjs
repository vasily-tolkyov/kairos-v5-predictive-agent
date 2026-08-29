import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const express = require("express");
const { Server: SocketIoServer } = require("socket.io");
const { WorldView } = require("prismarine-viewer/viewer/lib/worldView");
const { setupRoutes } = require("prismarine-viewer/lib/common");

export function translateMinecraftViewerPositionV1(position, yOffset) {
  return Object.freeze({ x: Number(position.x), y: Number(position.y) + yOffset, z: Number(position.z) });
}

export function translateMinecraftViewerChunkJsonV1(chunkJson, yOffset) {
  if (yOffset === 0) return chunkJson;
  const parsed = typeof chunkJson === "string" ? JSON.parse(chunkJson) : structuredClone(chunkJson);
  if (!Number.isFinite(parsed.minY)) throw new Error("minecraft-viewer-chunk-min-y-unavailable");
  parsed.minY += yOffset;
  return typeof chunkJson === "string" ? JSON.stringify(parsed) : parsed;
}

function visualizationEmitter(socket, yOffset) {
  return Object.freeze({
    on: (...args) => socket.on(...args),
    emit: (eventName, payload) => {
      if (eventName === "loadChunk") {
        return socket.emit(eventName, { ...payload, chunk: translateMinecraftViewerChunkJsonV1(payload.chunk, yOffset) });
      }
      if (eventName === "entity" && payload?.pos) {
        return socket.emit(eventName, { ...payload, pos: translateMinecraftViewerPositionV1(payload.pos, yOffset) });
      }
      if (eventName === "blockUpdate" && payload?.pos) {
        return socket.emit(eventName, { ...payload, pos: translateMinecraftViewerPositionV1(payload.pos, yOffset) });
      }
      return socket.emit(eventName, payload);
    },
  });
}

/**
 * Read-only Prismarine renderer for the task-owned Mineflayer entity.
 * Unlike prismarine-viewer's convenience wrapper, this surface binds an
 * explicit loopback host and deliberately has no block-click/action handler.
 */
export async function startLoopbackMineflayerViewerV1(bot, input = {}) {
  const host = input.host ?? "127.0.0.1";
  const requestedPort = input.port ?? 3000;
  const viewDistance = input.viewDistance ?? 6;
  const firstPerson = input.firstPerson ?? true;
  const prefix = input.prefix ?? "";
  if (host !== "127.0.0.1") throw new Error("minecraft-viewer-host-must-be-loopback");
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    throw new RangeError("invalid-minecraft-viewer-port");
  }
  if (!Number.isInteger(viewDistance) || viewDistance < 2 || viewDistance > 12) {
    throw new RangeError("invalid-minecraft-viewer-distance");
  }

  const app = express();
  const http = createServer(app);
  const io = new SocketIoServer(http, { path: `${prefix}/socket.io` });
  setupRoutes(app, prefix);
  const sockets = new Set();
  const primitives = new Map();
  let connectionCount = 0;
  let readyConnectionCount = 0;
  let lastReadySnapshot = null;

  app.get(`${prefix}/kairos-viewer-status.json`, (_request, response) => {
    response.json({
      version: "KairosLoopbackViewerStatusV1",
      serverReady: true,
      connectionCount,
      readyConnectionCount,
      lastReadySnapshot,
    });
  });

  bot.viewer = new EventEmitter();
  bot.viewer.erase = (id) => {
    primitives.delete(id);
    for (const socket of sockets) socket.emit("primitive", { id });
  };
  bot.viewer.drawLine = (id, points, color = 0xff0000) => {
    const primitive = { type: "line", id, points, color };
    primitives.set(id, primitive);
    for (const socket of sockets) socket.emit("primitive", primitive);
  };

  io.on("connection", async (socket) => {
    connectionCount += 1;
    sockets.add(socket);
    socket.emit("version", bot.version);
    let worldView = null;
    let publishPosition = null;
    for (const primitive of primitives.values()) socket.emit("primitive", primitive);
    socket.on("disconnect", () => {
      if (publishPosition !== null) bot.removeListener("move", publishPosition);
      if (worldView !== null) worldView.removeListenersFromBot(bot);
      sockets.delete(socket);
      if (socket.data.kairosViewerReady === true) readyConnectionCount -= 1;
    });
    try {
      const spawnColumn = await bot.world.getColumnAt(bot.entity.position);
      if (!spawnColumn) throw new Error("minecraft-viewer-spawn-column-unavailable");
      const sourceMinY = Number(spawnColumn.minY ?? 0);
      if (!Number.isFinite(sourceMinY)) throw new Error("minecraft-viewer-source-min-y-invalid");
      const visualizationYOffset = sourceMinY < 0 ? -sourceMinY : 0;
      const visualEmitter = visualizationEmitter(socket, visualizationYOffset);
      worldView = new WorldView(bot.world, viewDistance, bot.entity.position, visualEmitter);
      publishPosition = () => {
      const packet = { pos: translateMinecraftViewerPositionV1(bot.entity.position, visualizationYOffset), yaw: bot.entity.yaw, addMesh: true };
      if (firstPerson) packet.pitch = bot.entity.pitch;
      socket.emit("position", packet);
      worldView.updatePosition(bot.entity.position);
    };
    bot.on("move", publishPosition);
    worldView.listenToBot(bot);
      await worldView.init(bot.entity.position);
      if (!sockets.has(socket)) return;
      const loadedChunkCount = Object.keys(worldView.loadedChunks).length;
      if (loadedChunkCount < 1) throw new Error("minecraft-viewer-no-loaded-terrain-chunks");
      // A stationary bot emits no initial `move` event.  Without this explicit
      // first packet the browser camera stays at its default origin while
      // entities arrive independently, producing the misleading blue-sky view.
      publishPosition();
      readyConnectionCount += 1;
      socket.data.kairosViewerReady = true;
      lastReadySnapshot = Object.freeze({ loadedChunkCount, firstPositionPublished: true, sourceMinY, visualizationYOffset });
      socket.emit("kairosViewerReady", lastReadySnapshot);
    } catch (error) {
      socket.emit("kairosViewerFault", { reasonCode: String(error?.message ?? error) });
      socket.disconnect(true);
    }
  });

  await new Promise((resolve, reject) => {
    const failed = (error) => reject(error);
    http.once("error", failed);
    http.listen(requestedPort, host, () => {
      http.off("error", failed);
      resolve();
    });
  });
  const address = http.address();
  if (address === null || typeof address === "string" || address.address !== host) {
    io.close();
    throw new Error("minecraft-viewer-loopback-bind-verification-failed");
  }
  const close = async () => {
    for (const socket of sockets) socket.disconnect(true);
    await new Promise((resolve) => io.close(() => resolve()));
    if (http.listening) await new Promise((resolve) => http.close(() => resolve()));
  };
  bot.viewer.close = close;
  return Object.freeze({
    version: "KairosLoopbackMineflayerViewerV1",
    host,
    port: address.port,
    url: `http://${host}:${address.port}${prefix}/`,
    get connectionCount() { return connectionCount; },
    get readyConnectionCount() { return readyConnectionCount; },
    get lastReadySnapshot() { return lastReadySnapshot; },
    close,
  });
}
