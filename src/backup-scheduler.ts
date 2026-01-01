import { App, Notice } from 'obsidian';
import { AccessTracker } from './access-tracker';
import { BackupService } from './backup-service';
import { BackupSettings, BackupTier } from './types';

const CHECK_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes
const HOURS_PER_DAY = 24;

export class BackupScheduler {
	private app: App;
	private accessTracker: AccessTracker;
	private backupService: BackupService;
	private settings: BackupSettings;
	private checkInterval: number | null = null;
	private isRunning: boolean = false;

	constructor(
		app: App,
		accessTracker: AccessTracker,
		backupService: BackupService,
		settings: BackupSettings
	) {
		this.app = app;
		this.accessTracker = accessTracker;
		this.backupService = backupService;
		this.settings = settings;
	}

	updateSettings(settings: BackupSettings): void {
		this.settings = settings;
		this.backupService.updateSettings(settings);

		// Restart scheduler if settings change
		if (settings.enabled && !this.isRunning) {
			this.start();
		} else if (!settings.enabled && this.isRunning) {
			this.stop();
		}
	}

	/**
	 * Start the backup scheduler
	 */
	start(): void {
		if (this.isRunning) return;
		if (!this.settings.enabled) return;

		console.log('Story Time Backup: Scheduler started');
		this.isRunning = true;

		// Do an immediate check
		this.checkAndBackup();

		// Schedule regular checks
		this.checkInterval = window.setInterval(() => {
			this.checkAndBackup();
		}, CHECK_INTERVAL);
	}

	/**
	 * Stop the backup scheduler
	 */
	stop(): void {
		if (this.checkInterval) {
			window.clearInterval(this.checkInterval);
			this.checkInterval = null;
		}
		this.isRunning = false;
		console.log('Story Time Backup: Scheduler stopped');
	}

	/**
	 * Check all monitored folders and backup if needed
	 */
	private async checkAndBackup(): Promise<void> {
		if (!this.settings.enabled || !this.settings.outputPath) {
			return;
		}

		const foldersToCheck = this.settings.foldersToBackup.length > 0
			? this.settings.foldersToBackup
			: this.getAllVaultFolders();

		for (const folderPath of foldersToCheck) {
			await this.checkFolderBackup(folderPath);
		}
	}

	/**
	 * Check if a specific folder needs backup based on access frequency
	 */
	private async checkFolderBackup(folderPath: string): Promise<void> {
		const accessCount = this.accessTracker.getAccessCount(folderPath);
		const tier = this.getTierForAccessCount(accessCount);

		if (!tier) {
			// Below minimum threshold, no backup needed
			return;
		}

		const lastBackup = this.settings.lastBackupTimes[folderPath] || 0;
		const timeSinceLastBackup = Date.now() - lastBackup;
		const backupIntervalMs = this.getBackupIntervalMs(tier.backupsPerDay);

		if (timeSinceLastBackup >= backupIntervalMs) {
			console.log(`Story Time Backup: Backing up ${folderPath} (${accessCount} accesses, tier: ${tier.label})`);

			const success = await this.backupService.backupFolder(
				folderPath,
				accessCount,
				tier.label
			);

			if (success) {
				// Update last backup time
				this.settings.lastBackupTimes[folderPath] = Date.now();
				// Note: The main plugin should save settings after this
			}
		}
	}

	/**
	 * Get the appropriate tier for an access count
	 */
	private getTierForAccessCount(accessCount: number): BackupTier | null {
		// Tiers should be sorted by minAccesses descending
		const sortedTiers = [...this.settings.tiers].sort(
			(a, b) => b.minAccesses - a.minAccesses
		);

		for (const tier of sortedTiers) {
			if (accessCount >= tier.minAccesses) {
				return tier;
			}
		}

		return null; // Below all thresholds
	}

	/**
	 * Calculate backup interval in ms based on backups per day
	 */
	private getBackupIntervalMs(backupsPerDay: number): number {
		if (backupsPerDay <= 0) return Infinity;
		const hoursPerBackup = HOURS_PER_DAY / backupsPerDay;
		return hoursPerBackup * 60 * 60 * 1000;
	}

	/**
	 * Get all top-level folders in the vault
	 */
	private getAllVaultFolders(): string[] {
		const folders: string[] = [];
		const root = this.app.vault.getRoot();

		for (const child of root.children) {
			if ('children' in child) {
				folders.push(child.path);
			}
		}

		return folders;
	}

	/**
	 * Manually trigger backup for a folder (ignoring schedule)
	 */
	async manualBackup(folderPath: string): Promise<boolean> {
		const accessCount = this.accessTracker.getAccessCount(folderPath);
		const tier = this.getTierForAccessCount(accessCount);
		const tierLabel = tier?.label || 'Manual';

		new Notice(`Starting manual backup of ${folderPath}...`);

		const success = await this.backupService.backupFolder(
			folderPath,
			accessCount,
			tierLabel
		);

		if (success) {
			this.settings.lastBackupTimes[folderPath] = Date.now();
		}

		return success;
	}

	/**
	 * Get backup status for all monitored folders
	 */
	getBackupStatus(): FolderBackupStatus[] {
		const statuses: FolderBackupStatus[] = [];
		const foldersToCheck = this.settings.foldersToBackup.length > 0
			? this.settings.foldersToBackup
			: this.getAllVaultFolders();

		for (const folderPath of foldersToCheck) {
			const accessCount = this.accessTracker.getAccessCount(folderPath);
			const tier = this.getTierForAccessCount(accessCount);
			const lastBackup = this.settings.lastBackupTimes[folderPath] || 0;

			let nextBackup: number | null = null;
			if (tier) {
				const interval = this.getBackupIntervalMs(tier.backupsPerDay);
				nextBackup = lastBackup + interval;
			}

			statuses.push({
				folderPath,
				accessCount,
				tier: tier?.label || 'Below threshold',
				backupsPerDay: tier?.backupsPerDay || 0,
				lastBackup,
				nextBackup,
			});
		}

		return statuses.sort((a, b) => b.accessCount - a.accessCount);
	}

	/**
	 * Check if scheduler is currently running
	 */
	isSchedulerRunning(): boolean {
		return this.isRunning;
	}
}

export interface FolderBackupStatus {
	folderPath: string;
	accessCount: number;
	tier: string;
	backupsPerDay: number;
	lastBackup: number;
	nextBackup: number | null;
}
