import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // ── Simple in-memory rate limiter: 10 requests/IP/minute ────────────────
  const _rateCounts = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT  = 10;
  const RATE_WINDOW = 60_000;

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = _rateCounts.get(ip);
    if (!entry || now > entry.resetAt) {
      _rateCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
      return true;
    }
    if (entry.count >= RATE_LIMIT) return false;
    entry.count++;
    return true;
  }

  // ── /api/transcribe — استخراج النص (بدون auth) ─────────────────────────
  app.post("/api/transcribe", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
    try {
      // Rate limiting
      const clientIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        ?? req.socket.remoteAddress
        ?? "unknown";
      if (!checkRateLimit(clientIp)) {
        res.status(429).json({ error: "Too many requests — حاول بعد دقيقة" });
        return;
      }

      // Origin check — block cross-origin abuse of the API key
      const origin = req.headers["origin"] ?? "";
      const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
      if (
        allowedOrigins.length > 0 &&
        origin !== "" &&
        !allowedOrigins.includes(origin)
      ) {
        res.status(403).json({ error: "Origin not allowed" });
        return;
      }

      // Sanitize Content-Type — extract only the multipart/form-data boundary,
      // never forward arbitrary header values to the upstream API
      const rawContentType = Array.isArray(req.headers["content-type"])
        ? req.headers["content-type"][0]
        : req.headers["content-type"] ?? "";
      const boundaryMatch = rawContentType.match(/boundary=([^\s;]+)/i);
      if (!rawContentType.toLowerCase().startsWith("multipart/form-data") || !boundaryMatch) {
        res.status(400).json({ error: "Unsupported content type" });
        return;
      }
      const safeContentType = `multipart/form-data; boundary=${boundaryMatch[1]}`;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(503).json({ error: "OPENAI_API_KEY not configured" });
        return;
      }
      // Node.js 18+ لديه fetch مدمج — لا حاجة لـ node-fetch
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": safeContentType,
        },
        body: req.body as Buffer,
      });
      const data = await response.json();
      res.json(data);
    } catch (e) {
      console.error("[/api/transcribe]", e);
      res.status(500).json({ error: "Transcription failed" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);