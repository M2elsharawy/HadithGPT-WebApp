import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, longtext } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Audio Files table - stores metadata about uploaded audio files
 */
export const audioFiles = mysqlTable("audioFiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 255 }).notNull(), // S3 storage key
  fileUrl: text("fileUrl").notNull(), // S3 storage URL
  mimeType: varchar("mimeType", { length: 50 }).notNull(),
  fileSize: int("fileSize").notNull(), // in bytes
  duration: decimal("duration", { precision: 10, scale: 2 }), // in seconds
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AudioFile = typeof audioFiles.$inferSelect;
export type InsertAudioFile = typeof audioFiles.$inferInsert;

/**
 * Processing Jobs table - stores results of audio analysis and processing
 */
export const processingJobs = mysqlTable("processingJobs", {
  id: int("id").autoincrement().primaryKey(),
  audioFileId: int("audioFileId").notNull(),
  userId: int("userId").notNull(),
  jobType: varchar("jobType", { length: 50 }).notNull(), // e.g., 'transcription', 'analysis'
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  transcription: longtext("transcription"), // Speech-to-Text result
  analysis: longtext("analysis"), // AI analysis result (JSON)
  waveformData: longtext("waveformData"), // Waveform visualization data (JSON)
  spectrogramData: longtext("spectrogramData"), // Spectrogram visualization data (JSON)
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type InsertProcessingJob = typeof processingJobs.$inferInsert;

/**
 * Relations
 */
export const audioFilesRelations = relations(audioFiles, ({ many, one }) => ({
  user: one(users, {
    fields: [audioFiles.userId],
    references: [users.id],
  }),
  processingJobs: many(processingJobs),
}));

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  audioFile: one(audioFiles, {
    fields: [processingJobs.audioFileId],
    references: [audioFiles.id],
  }),
  user: one(users, {
    fields: [processingJobs.userId],
    references: [users.id],
  }),
}));