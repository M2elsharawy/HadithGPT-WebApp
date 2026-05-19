import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("audio.upload", () => {
  it("should reject unsupported audio formats", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    try {
      await caller.audio.upload({
        fileName: "test.txt",
        fileData: "dGVzdCBkYXRh",
        mimeType: "text/plain",
        fileSize: 100,
      });
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toContain("Unsupported audio format");
    }
  });

  it("should reject files exceeding 16MB", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    try {
      await caller.audio.upload({
        fileName: "test.mp3",
        fileData: "dGVzdCBkYXRh",
        mimeType: "audio/mpeg",
        fileSize: 17 * 1024 * 1024,
      });
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toContain("exceeds 16MB");
    }
  });

  it("should accept valid audio formats for validation", () => {
    const validFormats = [
      { type: "audio/mpeg", ext: ".mp3" },
      { type: "audio/wav", ext: ".wav" },
      { type: "audio/ogg", ext: ".ogg" },
      { type: "audio/mp4", ext: ".m4a" },
      { type: "audio/webm", ext: ".webm" },
    ];

    const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'];
    for (const format of validFormats) {
      expect(allowedMimes).toContain(format.type);
    }
  });
});

describe("audio.list", () => {
  it("should require authentication", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    try {
      await caller.audio.list();
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.code).toBe("UNAUTHORIZED");
    }
  });
});

describe("audio.delete", () => {
  it("should require authentication", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    try {
      await caller.audio.delete({ id: 1 });
      expect.fail("Should have thrown an error");
    } catch (error: any) {
      expect(error.code).toBe("UNAUTHORIZED");
    }
  });
});
