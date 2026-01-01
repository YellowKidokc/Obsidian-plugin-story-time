import { App, TFile, Events, normalizePath } from 'obsidian';
import { AccessData, AccessRecord } from './types';

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Clean up old access records every hour
const ACCESS_DATA_FILE = '.obsidian/plugins/story-time/access-data.json';

export class AccessTracker extends Events {
	private app: App;
	private accessData: AccessData;
	private cleanupInterval: number | null = null;
	private saveDebounceTimeout: number | null = null;

	constructor(app: App) {
		super();
		this.app = app;
		this.accessData = {
			records: {},
			lastCleanup: Date.now(),
		};
	}

	async initialize(): Promise<void> {
		// Load persisted access data
		await this.loadAccessData();

		// Register event listeners for file access
		this.registerFileEvents();

		// Start cleanup interval
		this.startCleanupInterval();

		// Do initial cleanup of stale data
		this.cleanupOldAccesses();
	}

	private registerFileEvents(): void {
		// Track when files are opened
		this.app.workspace.on('file-open', (file: TFile | null) => {
			if (file) {
				this.recordAccess(file.path);
			}
		});

		// Track when files are modified
		this.app.vault.on('modify', (file: TFile) => {
			this.recordAccess(file.path);
		});
	}

	private recordAccess(filePath: string): void {
		const now = Date.now();
		const folderPath = this.getFolderPath(filePath);

		if (!this.accessData.records[folderPath]) {
			this.accessData.records[folderPath] = {
				path: folderPath,
				folderPath: folderPath,
				accessCount: 0,
				lastAccessed: now,
				accessHistory: [],
			};
		}

		const record = this.accessData.records[folderPath];
		record.accessHistory.push(now);
		record.lastAccessed = now;

		// Recalculate access count (accesses in last 24h)
		this.updateAccessCount(record);

		// Emit event for listeners (backup scheduler will listen)
		this.trigger('access-recorded', folderPath, record.accessCount);

		// Debounced save
		this.debouncedSave();
	}

	private getFolderPath(filePath: string): string {
		const parts = filePath.split('/');
		if (parts.length > 1) {
			parts.pop(); // Remove filename
			return parts.join('/');
		}
		return '/'; // Root folder
	}

	private updateAccessCount(record: AccessRecord): void {
		const now = Date.now();
		const cutoff = now - TWENTY_FOUR_HOURS;

		// Filter to only accesses in the last 24 hours
		record.accessHistory = record.accessHistory.filter(ts => ts > cutoff);
		record.accessCount = record.accessHistory.length;
	}

	private cleanupOldAccesses(): void {
		const now = Date.now();

		for (const path in this.accessData.records) {
			const record = this.accessData.records[path];
			this.updateAccessCount(record);

			// Remove records with no recent accesses
			if (record.accessCount === 0 && (now - record.lastAccessed) > TWENTY_FOUR_HOURS * 7) {
				delete this.accessData.records[path];
			}
		}

		this.accessData.lastCleanup = now;
		this.debouncedSave();
	}

	private startCleanupInterval(): void {
		this.cleanupInterval = window.setInterval(() => {
			this.cleanupOldAccesses();
		}, CLEANUP_INTERVAL);
	}

	private debouncedSave(): void {
		if (this.saveDebounceTimeout) {
			window.clearTimeout(this.saveDebounceTimeout);
		}
		this.saveDebounceTimeout = window.setTimeout(() => {
			this.saveAccessData();
		}, 5000); // Save after 5 seconds of inactivity
	}

	private async loadAccessData(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const filePath = normalizePath(ACCESS_DATA_FILE);

			if (await adapter.exists(filePath)) {
				const data = await adapter.read(filePath);
				this.accessData = JSON.parse(data);
			}
		} catch (e) {
			console.log('Story Time: No existing access data found, starting fresh');
		}
	}

	private async saveAccessData(): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const filePath = normalizePath(ACCESS_DATA_FILE);

			// Ensure directory exists
			const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
			if (!(await adapter.exists(dirPath))) {
				await adapter.mkdir(dirPath);
			}

			await adapter.write(filePath, JSON.stringify(this.accessData, null, 2));
		} catch (e) {
			console.error('Story Time: Failed to save access data', e);
		}
	}

	// Public API

	/**
	 * Get access count for a folder in the last 24 hours
	 */
	getAccessCount(folderPath: string): number {
		const record = this.accessData.records[folderPath];
		if (!record) return 0;

		// Make sure count is fresh
		this.updateAccessCount(record);
		return record.accessCount;
	}

	/**
	 * Get all folder access records, sorted by access count descending
	 */
	getAllFolderStats(): AccessRecord[] {
		const records = Object.values(this.accessData.records);

		// Update counts before returning
		records.forEach(r => this.updateAccessCount(r));

		return records.sort((a, b) => b.accessCount - a.accessCount);
	}

	/**
	 * Get folders that meet a minimum access threshold
	 */
	getFoldersAboveThreshold(minAccesses: number): AccessRecord[] {
		return this.getAllFolderStats().filter(r => r.accessCount >= minAccesses);
	}

	/**
	 * Manually trigger a save (useful before plugin unload)
	 */
	async forceSave(): Promise<void> {
		if (this.saveDebounceTimeout) {
			window.clearTimeout(this.saveDebounceTimeout);
			this.saveDebounceTimeout = null;
		}
		await this.saveAccessData();
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			window.clearInterval(this.cleanupInterval);
		}
		if (this.saveDebounceTimeout) {
			window.clearTimeout(this.saveDebounceTimeout);
		}
		this.forceSave();
	}
}
