import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';
import JSZip from 'jszip';
import { BackupSettings, BackupMetadata } from './types';

const METADATA_FILE = 'backup-metadata.json';

export class BackupService {
	private app: App;
	private settings: BackupSettings;

	constructor(app: App, settings: BackupSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: BackupSettings): void {
		this.settings = settings;
	}

	/**
	 * Create a backup of a specific folder as a zip file
	 */
	async backupFolder(folderPath: string, accessCount: number, tierLabel: string): Promise<boolean> {
		if (!this.settings.outputPath) {
			new Notice('Backup output path not configured');
			return false;
		}

		try {
			// Get all files in the folder
			const files = await this.getFilesInFolder(folderPath);
			if (files.length === 0) {
				console.log(`Story Time Backup: No files to backup in ${folderPath}`);
				return false;
			}

			// Create zip
			const zip = new JSZip();
			let totalSize = 0;

			for (const file of files) {
				const content = await this.app.vault.read(file);
				const relativePath = file.path.substring(folderPath.length + 1);
				zip.file(relativePath, content);
				totalSize += content.length;
			}

			// Generate zip filename with timestamp
			const timestamp = this.formatTimestamp(Date.now());
			const safeFolderName = folderPath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
			const zipFileName = `${safeFolderName}_${timestamp}.zip`;

			// Create metadata
			const metadata: BackupMetadata = {
				folderPath,
				backupTime: Date.now(),
				fileCount: files.length,
				sizeBytes: totalSize,
				accessCount,
				tier: tierLabel,
			};

			// Add metadata to zip
			zip.file(METADATA_FILE, JSON.stringify(metadata, null, 2));

			// Generate zip blob
			const zipBlob = await zip.generateAsync({
				type: 'arraybuffer',
				compression: 'DEFLATE',
				compressionOptions: { level: 6 }
			});

			// Save to output path
			await this.saveBackupFile(zipFileName, zipBlob);

			// Clean up old backups if needed
			await this.cleanupOldBackups(folderPath);

			new Notice(`Backed up ${files.length} files from ${folderPath}`);
			console.log(`Story Time Backup: Successfully backed up ${folderPath} (${files.length} files, ${this.formatSize(totalSize)})`);

			return true;
		} catch (error) {
			console.error(`Story Time Backup: Failed to backup ${folderPath}`, error);
			new Notice(`Backup failed for ${folderPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
			return false;
		}
	}

	/**
	 * Get all markdown and other files in a folder recursively
	 */
	private async getFilesInFolder(folderPath: string): Promise<TFile[]> {
		const files: TFile[] = [];
		const folder = this.app.vault.getAbstractFileByPath(folderPath);

		if (!folder || !(folder instanceof TFolder)) {
			return files;
		}

		const processFolder = (f: TFolder) => {
			for (const child of f.children) {
				if (child instanceof TFile) {
					files.push(child);
				} else if (child instanceof TFolder) {
					processFolder(child);
				}
			}
		};

		processFolder(folder);
		return files;
	}

	/**
	 * Save the zip file to the configured output path
	 */
	private async saveBackupFile(fileName: string, data: ArrayBuffer): Promise<void> {
		const outputPath = this.settings.outputPath;

		// Check if output path is within vault or external
		if (this.isPathInVault(outputPath)) {
			// Save within vault
			const fullPath = normalizePath(`${outputPath}/${fileName}`);
			await this.ensureFolder(outputPath);

			const existing = this.app.vault.getAbstractFileByPath(fullPath);
			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, data);
			} else {
				await this.app.vault.createBinary(fullPath, data);
			}
		} else {
			// Save to external path using File System Access API or Node.js fs
			await this.saveToExternalPath(outputPath, fileName, data);
		}
	}

	/**
	 * Check if path is within the vault
	 */
	private isPathInVault(path: string): boolean {
		// If path doesn't start with /, it's relative to vault
		// If path contains : (Windows) or starts with /, it's absolute
		return !path.includes(':') && !path.startsWith('/');
	}

	/**
	 * Save to external file system path
	 */
	private async saveToExternalPath(basePath: string, fileName: string, data: ArrayBuffer): Promise<void> {
		// Use Obsidian's adapter for file system access
		const adapter = this.app.vault.adapter;
		const fullPath = `${basePath}/${fileName}`;

		// Ensure directory exists
		try {
			await adapter.mkdir(basePath);
		} catch (e) {
			// Directory might already exist
		}

		// Write file using the adapter's writeBinary if available
		// Note: This works for paths within the vault's accessible scope
		// For truly external paths, we need to use a different approach

		if ('writeBinary' in adapter) {
			await (adapter as any).writeBinary(fullPath, data);
		} else {
			// Fallback: Save within vault in a backups folder
			const vaultPath = normalizePath(`backups/${fileName}`);
			await this.ensureFolder('backups');
			await this.app.vault.createBinary(vaultPath, data);
			new Notice(`Note: Saved to vault/backups folder. External path not accessible.`);
		}
	}

	/**
	 * Ensure a folder exists in the vault
	 */
	private async ensureFolder(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath);
		const folder = this.app.vault.getAbstractFileByPath(normalized);

		if (!folder) {
			await this.app.vault.createFolder(normalized);
		}
	}

	/**
	 * Clean up old backups beyond the retention limit
	 */
	private async cleanupOldBackups(folderPath: string): Promise<void> {
		const maxToKeep = this.settings.maxBackupsToKeep;
		if (maxToKeep <= 0) return;

		const safeFolderName = folderPath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
		const pattern = new RegExp(`^${safeFolderName}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.zip$`);

		try {
			const outputPath = this.settings.outputPath;
			let backupFiles: { name: string; mtime: number }[] = [];

			if (this.isPathInVault(outputPath)) {
				const folder = this.app.vault.getAbstractFileByPath(outputPath);
				if (folder instanceof TFolder) {
					for (const child of folder.children) {
						if (child instanceof TFile && pattern.test(child.name)) {
							backupFiles.push({
								name: child.path,
								mtime: child.stat.mtime
							});
						}
					}
				}
			}

			// Sort by modification time, newest first
			backupFiles.sort((a, b) => b.mtime - a.mtime);

			// Delete old backups beyond the limit
			const toDelete = backupFiles.slice(maxToKeep);
			for (const file of toDelete) {
				const tfile = this.app.vault.getAbstractFileByPath(file.name);
				if (tfile instanceof TFile) {
					await this.app.vault.delete(tfile);
					console.log(`Story Time Backup: Deleted old backup ${file.name}`);
				}
			}
		} catch (error) {
			console.error('Story Time Backup: Error cleaning up old backups', error);
		}
	}

	/**
	 * Format timestamp for filename
	 */
	private formatTimestamp(ts: number): string {
		const d = new Date(ts);
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
	}

	/**
	 * Format file size for display
	 */
	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	/**
	 * Get list of existing backups for a folder
	 */
	async getBackupsForFolder(folderPath: string): Promise<BackupMetadata[]> {
		const backups: BackupMetadata[] = [];
		const safeFolderName = folderPath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
		const pattern = new RegExp(`^${safeFolderName}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.zip$`);

		try {
			const outputPath = this.settings.outputPath;
			if (this.isPathInVault(outputPath)) {
				const folder = this.app.vault.getAbstractFileByPath(outputPath);
				if (folder instanceof TFolder) {
					for (const child of folder.children) {
						if (child instanceof TFile && pattern.test(child.name)) {
							// Read metadata from zip
							try {
								const content = await this.app.vault.readBinary(child);
								const zip = await JSZip.loadAsync(content);
								const metadataFile = zip.file(METADATA_FILE);
								if (metadataFile) {
									const metadataStr = await metadataFile.async('string');
									backups.push(JSON.parse(metadataStr));
								}
							} catch (e) {
								console.log(`Could not read metadata from ${child.name}`);
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('Story Time Backup: Error listing backups', error);
		}

		return backups.sort((a, b) => b.backupTime - a.backupTime);
	}

	/**
	 * Restore a backup to the vault
	 */
	async restoreBackup(backupFilePath: string, restoreToPath?: string): Promise<boolean> {
		try {
			const file = this.app.vault.getAbstractFileByPath(backupFilePath);
			if (!(file instanceof TFile)) {
				new Notice('Backup file not found');
				return false;
			}

			const content = await this.app.vault.readBinary(file);
			const zip = await JSZip.loadAsync(content);

			// Read metadata to get original folder path
			const metadataFile = zip.file(METADATA_FILE);
			let originalPath = '';
			if (metadataFile) {
				const metadataStr = await metadataFile.async('string');
				const metadata: BackupMetadata = JSON.parse(metadataStr);
				originalPath = metadata.folderPath;
			}

			const targetPath = restoreToPath || originalPath;
			if (!targetPath) {
				new Notice('Could not determine restore path');
				return false;
			}

			// Extract files
			let restoredCount = 0;
			for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
				if (relativePath === METADATA_FILE) continue;
				if (zipEntry.dir) continue;

				const content = await zipEntry.async('string');
				const fullPath = normalizePath(`${targetPath}/${relativePath}`);

				// Ensure parent folder exists
				const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'));
				if (parentPath) {
					await this.ensureFolder(parentPath);
				}

				// Create or update file
				const existing = this.app.vault.getAbstractFileByPath(fullPath);
				if (existing instanceof TFile) {
					await this.app.vault.modify(existing, content);
				} else {
					await this.app.vault.create(fullPath, content);
				}
				restoredCount++;
			}

			new Notice(`Restored ${restoredCount} files to ${targetPath}`);
			return true;
		} catch (error) {
			console.error('Story Time Backup: Restore failed', error);
			new Notice(`Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
			return false;
		}
	}
}
