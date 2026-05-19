CREATE TABLE `audioFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileKey` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`mimeType` varchar(50) NOT NULL,
	`fileSize` int NOT NULL,
	`duration` decimal(10,2),
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `audioFiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processingJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`audioFileId` int NOT NULL,
	`userId` int NOT NULL,
	`jobType` varchar(50) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`transcription` longtext,
	`analysis` longtext,
	`waveformData` longtext,
	`spectrogramData` longtext,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processingJobs_id` PRIMARY KEY(`id`)
);
