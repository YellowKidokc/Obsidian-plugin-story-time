export interface StoryTimeSettings {
	// Context settings
	wordsBefore: number;
	wordsAfter: number;

	// Folder settings
	selectedFolders: string[];
	folderOrder: string[];

	// AI settings
	aiProvider: 'openai' | 'anthropic' | 'none';
	openaiApiKey: string;
	anthropicApiKey: string;
	aiModel: string;

	// Output settings
	outputFolder: string;
	includeSourceLinks: boolean;

	// Backup settings
	backup: BackupSettings;
}

// Backup tier configuration - maps access frequency to backup count per day
export interface BackupTier {
	minAccesses: number;  // Minimum accesses in 24h to qualify for this tier
	backupsPerDay: number; // How many times to backup per day (max 4)
	label: string;  // Human-readable label
}

export interface BackupSettings {
	enabled: boolean;
	outputPath: string;  // Where to save backup zips
	foldersToBackup: string[];  // Which folders to monitor and backup
	tiers: BackupTier[];  // Configurable backup tiers
	maxBackupsToKeep: number;  // Retention - how many backups to keep per folder
	lastBackupTimes: Record<string, number>;  // folderPath -> last backup timestamp
}

// Tracks file/folder access patterns
export interface AccessRecord {
	path: string;
	folderPath: string;
	accessCount: number;
	lastAccessed: number;  // timestamp
	accessHistory: number[];  // timestamps of accesses in last 24h
}

export interface AccessData {
	records: Record<string, AccessRecord>;  // path -> AccessRecord
	lastCleanup: number;  // Last time we cleaned old access history
}

export interface BackupMetadata {
	folderPath: string;
	backupTime: number;
	fileCount: number;
	sizeBytes: number;
	accessCount: number;  // Access count at time of backup
	tier: string;
}

// Default backup tiers - configurable by user
export const DEFAULT_BACKUP_TIERS: BackupTier[] = [
	{ minAccesses: 100, backupsPerDay: 4, label: 'Very High (100+ accesses)' },
	{ minAccesses: 50, backupsPerDay: 3, label: 'High (50-99 accesses)' },
	{ minAccesses: 20, backupsPerDay: 2, label: 'Medium (20-49 accesses)' },
	{ minAccesses: 5, backupsPerDay: 1, label: 'Low (5-19 accesses)' },
	// Below 5 accesses = no automatic backup
];

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
	enabled: false,
	outputPath: '',
	foldersToBackup: [],
	tiers: DEFAULT_BACKUP_TIERS,
	maxBackupsToKeep: 10,
	lastBackupTimes: {},
};

export const DEFAULT_SETTINGS: StoryTimeSettings = {
	wordsBefore: 20,
	wordsAfter: 35,
	selectedFolders: [],
	folderOrder: [],
	aiProvider: 'none',
	openaiApiKey: '',
	anthropicApiKey: '',
	aiModel: 'gpt-4',
	outputFolder: '',
	includeSourceLinks: true,
	backup: DEFAULT_BACKUP_SETTINGS,
};

export interface ConceptMention {
	filePath: string;
	fileName: string;
	folderPath: string;
	lineNumber: number;
	fullParagraph: string;
	extractedContext: string;
	conceptLink: string;
	position: number; // Position in file for ordering
}

export interface StoryChapter {
	folderName: string;
	filePath: string;
	fileName: string;
	mentions: ConceptMention[];
	order: number;
}

export interface GeneratedStory {
	concept: string;
	chapters: StoryChapter[];
	rawContent: string;
	refinedContent?: string;
}
