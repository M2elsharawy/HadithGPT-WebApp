import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, audioFiles, processingJobs, InsertAudioFile, InsertProcessingJob } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Audio Files Helpers
 */
export async function createAudioFile(file: InsertAudioFile): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(audioFiles).values(file);
  // Extract insertId from the result
  const insertId = (result as any)?.[0]?.insertId || (result as any)?.insertId;
  if (!insertId) {
    throw new Error("Failed to get inserted audio file ID");
  }
  return insertId;
}

export async function getAudioFileById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(audioFiles).where(eq(audioFiles.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserAudioFiles(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(audioFiles)
    .where(eq(audioFiles.userId, userId))
    .orderBy(desc(audioFiles.uploadedAt));
}

export async function deleteAudioFile(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Verify ownership
  const file = await getAudioFileById(id);
  if (!file || file.userId !== userId) {
    throw new Error("Unauthorized or file not found");
  }
  
  await db.delete(audioFiles).where(eq(audioFiles.id, id));
}

/**
 * Processing Jobs Helpers
 */
export async function createProcessingJob(job: InsertProcessingJob): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(processingJobs).values(job);
  const insertId = (result as any)?.[0]?.insertId || (result as any)?.insertId;
  if (!insertId) {
    throw new Error("Failed to get inserted processing job ID");
  }
  return insertId;
}

export async function getProcessingJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(processingJobs).where(eq(processingJobs.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAudioFileJobs(audioFileId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(processingJobs)
    .where(eq(processingJobs.audioFileId, audioFileId))
    .orderBy(desc(processingJobs.createdAt));
}

export async function updateProcessingJob(id: number, updates: Partial<InsertProcessingJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(processingJobs).set(updates).where(eq(processingJobs.id, id));
}
