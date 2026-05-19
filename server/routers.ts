import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { createAudioFile, getUserAudioFiles, deleteAudioFile, createProcessingJob, getAudioFileJobs, updateProcessingJob } from "./db";
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Audio Files Router
  audio: router({
    // Upload audio file - Server-side handling to avoid Buffer is not defined error
    upload: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1),
        fileData: z.string(), // Base64 encoded file data
        mimeType: z.string(),
        fileSize: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Validate file type
        const allowedMimes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'];
        if (!allowedMimes.includes(input.mimeType)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Unsupported audio format. Allowed: mp3, wav, ogg, m4a, webm',
          });
        }

        // Validate file size (max 16MB)
        const MAX_FILE_SIZE = 16 * 1024 * 1024;
        if (input.fileSize > MAX_FILE_SIZE) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'File size exceeds 16MB limit',
          });
        }

        try {
          // Convert base64 to buffer
          const buffer = Buffer.from(input.fileData, 'base64');

          // Sanitize filename to ASCII-only for S3 compatibility
          const sanitizedFileName = input.fileName
            .replace(/[^\w\s.-]/g, '_') // Replace non-word chars with underscore
            .replace(/\s+/g, '_') // Replace spaces with underscore
            .substring(0, 100); // Limit length

          // Upload to S3
          const fileKey = `audio/${ctx.user.id}/${Date.now()}-${sanitizedFileName}`;
          const { url } = await storagePut(fileKey, buffer, input.mimeType);

          // Save to database (keep original filename for display)
          const audioFileId = await createAudioFile({
            userId: ctx.user.id,
            fileName: input.fileName,
            fileKey,
            fileUrl: url,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
          });

          // Create initial processing job
          await createProcessingJob({
            audioFileId: audioFileId,
            userId: ctx.user.id,
            jobType: 'transcription',
            status: 'pending',
          });

          return {
            id: audioFileId,
            fileName: input.fileName, // Return original filename for display
            fileUrl: url,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
          };
        } catch (error) {
          console.error('Upload error:', error);
          if (error instanceof TRPCError) {
            throw error;
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to upload audio file',
          });
        }
      }),

    // Get user's audio files
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserAudioFiles(ctx.user.id);
    }),

    // Delete audio file
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await deleteAudioFile(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // Processing Jobs Router
  processing: router({
    // Get jobs for an audio file
    getJobs: protectedProcedure
      .input(z.object({ audioFileId: z.number() }))
      .query(async ({ input }) => {
        return getAudioFileJobs(input.audioFileId);
      }),

    // Update job status and results
    updateJob: protectedProcedure
      .input(z.object({
        jobId: z.number(),
        status: z.enum(['pending', 'processing', 'completed', 'failed']),
        transcription: z.string().optional(),
        analysis: z.string().optional(),
        waveformData: z.string().optional(),
        spectrogramData: z.string().optional(),
        errorMessage: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const updates: Record<string, unknown> = {
          status: input.status,
        };

        if (input.transcription) updates.transcription = input.transcription;
        if (input.analysis) updates.analysis = input.analysis;
        if (input.waveformData) updates.waveformData = input.waveformData;
        if (input.spectrogramData) updates.spectrogramData = input.spectrogramData;
        if (input.errorMessage) updates.errorMessage = input.errorMessage;
        if (input.status === 'completed') updates.completedAt = new Date();

        await updateProcessingJob(input.jobId, updates);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
