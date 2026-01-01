import {
	App,
	Plugin,
	Notice,
	TFile,
	Menu,
	Editor,
	MarkdownView
} from 'obsidian';
import { StoryTimeSettings, DEFAULT_SETTINGS, DEFAULT_BACKUP_SETTINGS } from './types';
import { StoryTimeSettingTab } from './settings';
import { StoryGenerator } from './story-generator';
import { AIRefiner } from './ai-refiner';
import { AccessTracker } from './access-tracker';
import { BackupService } from './backup-service';
import { BackupScheduler } from './backup-scheduler';
import {
	ConceptInputModal,
	FolderSelectModal,
	StoryPreviewModal,
	BackupFolderSelectModal
} from './modals';

export default class StoryTimePlugin extends Plugin {
	settings: StoryTimeSettings;
	generator: StoryGenerator;
	refiner: AIRefiner;
	accessTracker: AccessTracker;
	backupService: BackupService;
	backupScheduler: BackupScheduler;

	async onload() {
		await this.loadSettings();

		this.generator = new StoryGenerator(this.app, this.settings);
		this.refiner = new AIRefiner(this.settings);

		// Initialize backup system
		await this.initializeBackupSystem();

		// Add settings tab
		this.addSettingTab(new StoryTimeSettingTab(this.app, this));

		// Add command to create story journey
		this.addCommand({
			id: 'create-story-journey',
			name: 'Create Story Journey',
			callback: () => this.createStoryJourney()
		});

		// Add command to create journey from selected text
		this.addCommand({
			id: 'create-journey-from-selection',
			name: 'Create Journey from Selected Link',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (selection) {
					// Extract concept from wiki-link if present
					const match = selection.match(/\[\[([^\]|]+)/);
					const concept = match ? match[1] : selection.trim();
					this.createStoryJourney(concept);
				} else {
					new Notice('Please select a concept or wiki-link first');
				}
			}
		});

		// Add context menu for wiki-links
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (selection && selection.includes('[[')) {
					menu.addItem((item) => {
						item
							.setTitle('Create Story Journey')
							.setIcon('book-open')
							.onClick(() => {
								const match = selection.match(/\[\[([^\]|]+)/);
								const concept = match ? match[1] : selection.trim();
								this.createStoryJourney(concept);
							});
					});
				}
			})
		);

		// Add ribbon icon
		this.addRibbonIcon('book-open', 'Story Time', () => {
			this.createStoryJourney();
		});

		console.log('Story Time plugin loaded');
	}

	onunload() {
		// Clean up backup system
		this.backupScheduler?.stop();
		this.accessTracker?.destroy();
		console.log('Story Time plugin unloaded');
	}

	async loadSettings() {
		const loadedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

		// Ensure backup settings exist (for upgrades from older versions)
		if (!this.settings.backup) {
			this.settings.backup = { ...DEFAULT_BACKUP_SETTINGS };
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.generator?.updateSettings(this.settings);
		this.refiner?.updateSettings(this.settings);
		this.backupScheduler?.updateSettings(this.settings.backup);
	}

	/**
	 * Initialize the adaptive backup system
	 */
	private async initializeBackupSystem(): Promise<void> {
		// Create access tracker
		this.accessTracker = new AccessTracker(this.app);
		await this.accessTracker.initialize();

		// Create backup service
		this.backupService = new BackupService(this.app, this.settings.backup);

		// Create backup scheduler
		this.backupScheduler = new BackupScheduler(
			this.app,
			this.accessTracker,
			this.backupService,
			this.settings.backup
		);

		// Start scheduler if enabled
		if (this.settings.backup.enabled) {
			this.backupScheduler.start();
		}

		// Add command for manual backup
		this.addCommand({
			id: 'backup-folder',
			name: 'Backup Folder Now',
			callback: () => this.showBackupFolderDialog()
		});

		// Add command to show backup status
		this.addCommand({
			id: 'backup-status',
			name: 'Show Backup Status',
			callback: () => this.showBackupStatus()
		});

		console.log('Story Time: Backup system initialized');
	}

	/**
	 * Show dialog to select folder for manual backup
	 */
	private showBackupFolderDialog(): void {
		if (!this.settings.backup.outputPath) {
			new Notice('Please configure a backup output location in settings first.');
			return;
		}

		new BackupFolderSelectModal(
			this.app,
			async (selectedFolders) => {
				for (const folder of selectedFolders) {
					await this.backupScheduler.manualBackup(folder);
				}
			}
		).open();
	}

	/**
	 * Show backup status for all monitored folders
	 */
	private showBackupStatus(): void {
		const status = this.backupScheduler.getBackupStatus();

		if (status.length === 0) {
			new Notice('No folders are being monitored for backup.');
			return;
		}

		let message = 'Backup Status:\n\n';
		for (const folder of status) {
			const lastBackup = folder.lastBackup
				? new Date(folder.lastBackup).toLocaleString()
				: 'Never';
			message += `${folder.folderPath || '(Root)'}: ${folder.accessCount} accesses (24h)\n`;
			message += `  Tier: ${folder.tier}\n`;
			message += `  Last backup: ${lastBackup}\n\n`;
		}

		new Notice(message, 10000);
	}

	/**
	 * Main entry point for creating a story journey
	 */
	async createStoryJourney(prefilledConcept?: string) {
		if (prefilledConcept) {
			await this.processConceptJourney(prefilledConcept);
		} else {
			new ConceptInputModal(this.app, async (concept) => {
				await this.processConceptJourney(concept);
			}).open();
		}
	}

	/**
	 * Process the journey creation for a given concept
	 */
	private async processConceptJourney(concept: string) {
		new Notice(`Searching for "${concept}" across your vault...`);

		try {
			// Generate the story
			const story = await this.generator.generateStory(concept);

			if (story.chapters.length === 0) {
				new Notice(`No mentions of [[${concept}]] found in selected folders.`);
				return;
			}

			const totalMentions = story.chapters.reduce(
				(sum, ch) => sum + ch.mentions.length,
				0
			);
			new Notice(`Found ${totalMentions} mentions in ${story.chapters.length} files!`);

			// Show preview modal
			new StoryPreviewModal(
				this.app,
				story,
				this.settings,
				this.generator,
				this.refiner
			).open();

		} catch (error) {
			console.error('Story Time error:', error);
			new Notice(`Error creating journey: ${error.message}`);
		}
	}
}
