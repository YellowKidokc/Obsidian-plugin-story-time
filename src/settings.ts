import { App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type StoryTimePlugin from './main';
import { StoryTimeSettings, BackupTier, DEFAULT_BACKUP_TIERS } from './types';

export class StoryTimeSettingTab extends PluginSettingTab {
	plugin: StoryTimePlugin;

	constructor(app: App, plugin: StoryTimePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h1', { text: 'Story Time Settings' });

		// Context Settings Section
		containerEl.createEl('h2', { text: 'Context Extraction' });
		containerEl.createEl('p', {
			text: 'Control how much text is captured around each concept mention.',
			cls: 'setting-item-description'
		});

		// Words Before Slider
		new Setting(containerEl)
			.setName('Words before')
			.setDesc(`Capture this many words before the concept link: ${this.plugin.settings.wordsBefore}`)
			.addSlider(slider => slider
				.setLimits(5, 100, 5)
				.setValue(this.plugin.settings.wordsBefore)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.wordsBefore = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to update description
				}));

		// Words After Slider
		new Setting(containerEl)
			.setName('Words after')
			.setDesc(`Capture this many words after the concept link: ${this.plugin.settings.wordsAfter}`)
			.addSlider(slider => slider
				.setLimits(5, 150, 5)
				.setValue(this.plugin.settings.wordsAfter)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.wordsAfter = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		// Folder Settings Section
		containerEl.createEl('h2', { text: 'Source Folders' });
		containerEl.createEl('p', {
			text: 'Select which folders to scan for concept mentions. Leave empty to scan entire vault.',
			cls: 'setting-item-description'
		});

		// Get all folders in vault
		const folders = this.getAllFolders();

		// Folder multi-select
		const folderContainer = containerEl.createDiv({ cls: 'story-time-folder-list' });

		folders.forEach(folder => {
			const isSelected = this.plugin.settings.selectedFolders.includes(folder);
			new Setting(folderContainer)
				.setName(folder || '(Root)')
				.addToggle(toggle => toggle
					.setValue(isSelected)
					.onChange(async (value) => {
						if (value) {
							if (!this.plugin.settings.selectedFolders.includes(folder)) {
								this.plugin.settings.selectedFolders.push(folder);
								this.plugin.settings.folderOrder.push(folder);
							}
						} else {
							this.plugin.settings.selectedFolders =
								this.plugin.settings.selectedFolders.filter(f => f !== folder);
							this.plugin.settings.folderOrder =
								this.plugin.settings.folderOrder.filter(f => f !== folder);
						}
						await this.plugin.saveSettings();
					}));
		});

		// Folder Order Section (if folders selected)
		if (this.plugin.settings.selectedFolders.length > 1) {
			containerEl.createEl('h3', { text: 'Folder Order' });
			containerEl.createEl('p', {
				text: 'Drag to reorder folders (determines chapter order in story):',
				cls: 'setting-item-description'
			});

			const orderContainer = containerEl.createDiv({ cls: 'story-time-folder-order' });
			this.plugin.settings.folderOrder.forEach((folder, index) => {
				if (this.plugin.settings.selectedFolders.includes(folder)) {
					new Setting(orderContainer)
						.setName(`${index + 1}. ${folder}`)
						.addButton(btn => btn
							.setIcon('arrow-up')
							.setTooltip('Move up')
							.onClick(async () => {
								if (index > 0) {
									const arr = this.plugin.settings.folderOrder;
									[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
									await this.plugin.saveSettings();
									this.display();
								}
							}))
						.addButton(btn => btn
							.setIcon('arrow-down')
							.setTooltip('Move down')
							.onClick(async () => {
								const arr = this.plugin.settings.folderOrder;
								if (index < arr.length - 1) {
									[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
									await this.plugin.saveSettings();
									this.display();
								}
							}));
				}
			});
		}

		// AI Settings Section
		containerEl.createEl('h2', { text: 'AI Refinement' });
		containerEl.createEl('p', {
			text: 'Optional: Use AI to create smooth transitions and make the story more cohesive.',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Choose which AI service to use for story refinement')
			.addDropdown(dropdown => dropdown
				.addOption('none', 'None (manual only)')
				.addOption('openai', 'OpenAI (GPT-4)')
				.addOption('anthropic', 'Anthropic (Claude)')
				.setValue(this.plugin.settings.aiProvider)
				.onChange(async (value: 'openai' | 'anthropic' | 'none') => {
					this.plugin.settings.aiProvider = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.aiProvider === 'openai') {
			new Setting(containerEl)
				.setName('OpenAI API Key')
				.setDesc('Your OpenAI API key')
				.addText(text => text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Model')
				.setDesc('Which OpenAI model to use')
				.addDropdown(dropdown => dropdown
					.addOption('gpt-4', 'GPT-4')
					.addOption('gpt-4-turbo', 'GPT-4 Turbo')
					.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
					.setValue(this.plugin.settings.aiModel)
					.onChange(async (value) => {
						this.plugin.settings.aiModel = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiProvider === 'anthropic') {
			new Setting(containerEl)
				.setName('Anthropic API Key')
				.setDesc('Your Anthropic API key')
				.addText(text => text
					.setPlaceholder('sk-ant-...')
					.setValue(this.plugin.settings.anthropicApiKey)
					.onChange(async (value) => {
						this.plugin.settings.anthropicApiKey = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Model')
				.setDesc('Which Claude model to use')
				.addDropdown(dropdown => dropdown
					.addOption('claude-3-opus-20240229', 'Claude 3 Opus')
					.addOption('claude-3-sonnet-20240229', 'Claude 3 Sonnet')
					.addOption('claude-3-haiku-20240307', 'Claude 3 Haiku')
					.setValue(this.plugin.settings.aiModel)
					.onChange(async (value) => {
						this.plugin.settings.aiModel = value;
						await this.plugin.saveSettings();
					}));
		}

		// Output Settings Section
		containerEl.createEl('h2', { text: 'Output' });

		new Setting(containerEl)
			.setName('Output folder')
			.setDesc('Where to save generated story files (leave empty for vault root)')
			.addText(text => text
				.setPlaceholder('Stories/Journeys')
				.setValue(this.plugin.settings.outputFolder)
				.onChange(async (value) => {
					this.plugin.settings.outputFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include source links')
			.setDesc('Add links back to original files in the generated story')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeSourceLinks)
				.onChange(async (value) => {
					this.plugin.settings.includeSourceLinks = value;
					await this.plugin.saveSettings();
				}));

		// Adaptive Backup Settings Section
		this.displayBackupSettings(containerEl);
	}

	private displayBackupSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: 'Adaptive Backup System' });
		containerEl.createEl('p', {
			text: 'Automatically back up folders based on how frequently you access them. Folders with high activity get backed up more often.',
			cls: 'setting-item-description'
		});

		// Enable/Disable backup system
		new Setting(containerEl)
			.setName('Enable adaptive backup')
			.setDesc('Automatically create zip backups based on folder access frequency')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.backup.enabled)
				.onChange(async (value) => {
					this.plugin.settings.backup.enabled = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide dependent settings
				}));

		if (!this.plugin.settings.backup.enabled) {
			return; // Don't show other settings if disabled
		}

		// Backup output path
		new Setting(containerEl)
			.setName('Backup output location')
			.setDesc('Where to save backup zip files. Use a path within your vault (e.g., "Backups") or an absolute path for external storage.')
			.addText(text => text
				.setPlaceholder('Backups')
				.setValue(this.plugin.settings.backup.outputPath)
				.onChange(async (value) => {
					this.plugin.settings.backup.outputPath = value;
					await this.plugin.saveSettings();
				}));

		// Folders to backup
		containerEl.createEl('h3', { text: 'Folders to Monitor' });
		containerEl.createEl('p', {
			text: 'Select which folders to monitor and backup. Leave empty to monitor all folders.',
			cls: 'setting-item-description'
		});

		const folders = this.getAllFolders();
		const backupFolderContainer = containerEl.createDiv({ cls: 'story-time-backup-folder-list' });

		folders.forEach(folder => {
			const isSelected = this.plugin.settings.backup.foldersToBackup.includes(folder);
			new Setting(backupFolderContainer)
				.setName(folder || '(Root)')
				.addToggle(toggle => toggle
					.setValue(isSelected)
					.onChange(async (value) => {
						if (value) {
							if (!this.plugin.settings.backup.foldersToBackup.includes(folder)) {
								this.plugin.settings.backup.foldersToBackup.push(folder);
							}
						} else {
							this.plugin.settings.backup.foldersToBackup =
								this.plugin.settings.backup.foldersToBackup.filter(f => f !== folder);
						}
						await this.plugin.saveSettings();
					}));
		});

		// Backup Tiers Configuration
		containerEl.createEl('h3', { text: 'Backup Frequency Tiers' });
		containerEl.createEl('p', {
			text: 'Configure how often folders are backed up based on access frequency (accesses in last 24 hours).',
			cls: 'setting-item-description'
		});

		const tiersContainer = containerEl.createDiv({ cls: 'story-time-backup-tiers' });

		this.plugin.settings.backup.tiers.forEach((tier, index) => {
			const tierSetting = new Setting(tiersContainer)
				.setName(`Tier ${index + 1}: ${tier.label}`)
				.setDesc(`${tier.minAccesses}+ accesses → ${tier.backupsPerDay}x per day`);

			// Min accesses slider
			tierSetting.addSlider(slider => slider
				.setLimits(1, 200, 5)
				.setValue(tier.minAccesses)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.backup.tiers[index].minAccesses = value;
					this.plugin.settings.backup.tiers[index].label = this.generateTierLabel(value);
					await this.plugin.saveSettings();
					// Don't refresh to avoid jarring UX during slider drag
				}));

			// Backups per day slider
			tierSetting.addSlider(slider => slider
				.setLimits(1, 4, 1)
				.setValue(tier.backupsPerDay)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.backup.tiers[index].backupsPerDay = value;
					await this.plugin.saveSettings();
				}));

			// Remove tier button
			if (this.plugin.settings.backup.tiers.length > 1) {
				tierSetting.addButton(btn => btn
					.setIcon('trash')
					.setTooltip('Remove tier')
					.onClick(async () => {
						this.plugin.settings.backup.tiers.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}));
			}
		});

		// Add tier button
		new Setting(tiersContainer)
			.addButton(btn => btn
				.setButtonText('Add Tier')
				.onClick(async () => {
					this.plugin.settings.backup.tiers.push({
						minAccesses: 10,
						backupsPerDay: 1,
						label: 'Custom (10+ accesses)'
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		// Reset tiers to default
		new Setting(tiersContainer)
			.addButton(btn => btn
				.setButtonText('Reset to Defaults')
				.onClick(async () => {
					this.plugin.settings.backup.tiers = [...DEFAULT_BACKUP_TIERS];
					await this.plugin.saveSettings();
					this.display();
				}));

		// Max backups to keep
		new Setting(containerEl)
			.setName('Maximum backups to keep')
			.setDesc(`Keep this many backup files per folder: ${this.plugin.settings.backup.maxBackupsToKeep}`)
			.addSlider(slider => slider
				.setLimits(1, 50, 1)
				.setValue(this.plugin.settings.backup.maxBackupsToKeep)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.backup.maxBackupsToKeep = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		// Backup status display
		if (this.plugin.backupScheduler) {
			containerEl.createEl('h3', { text: 'Current Backup Status' });

			const status = this.plugin.backupScheduler.getBackupStatus();
			const statusContainer = containerEl.createDiv({ cls: 'story-time-backup-status' });

			if (status.length === 0) {
				statusContainer.createEl('p', {
					text: 'No folders are currently being monitored.',
					cls: 'setting-item-description'
				});
			} else {
				const table = statusContainer.createEl('table', { cls: 'story-time-status-table' });
				const header = table.createEl('tr');
				header.createEl('th', { text: 'Folder' });
				header.createEl('th', { text: 'Accesses (24h)' });
				header.createEl('th', { text: 'Tier' });
				header.createEl('th', { text: 'Last Backup' });
				header.createEl('th', { text: 'Actions' });

				for (const folder of status) {
					const row = table.createEl('tr');
					row.createEl('td', { text: folder.folderPath || '(Root)' });
					row.createEl('td', { text: folder.accessCount.toString() });
					row.createEl('td', { text: folder.tier });
					row.createEl('td', {
						text: folder.lastBackup ? this.formatDate(folder.lastBackup) : 'Never'
					});

					const actionsCell = row.createEl('td');
					const backupBtn = actionsCell.createEl('button', { text: 'Backup Now' });
					backupBtn.onclick = async () => {
						await this.plugin.backupScheduler?.manualBackup(folder.folderPath);
						this.display();
					};
				}
			}
		}
	}

	private generateTierLabel(minAccesses: number): string {
		if (minAccesses >= 100) return `Very High (${minAccesses}+ accesses)`;
		if (minAccesses >= 50) return `High (${minAccesses}+ accesses)`;
		if (minAccesses >= 20) return `Medium (${minAccesses}+ accesses)`;
		return `Low (${minAccesses}+ accesses)`;
	}

	private formatDate(timestamp: number): string {
		const d = new Date(timestamp);
		return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
	}

	private getAllFolders(): string[] {
		const folders: string[] = [];
		const rootFolder = this.app.vault.getRoot();

		const traverse = (folder: TFolder, path: string) => {
			if (path) folders.push(path);
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					traverse(child, child.path);
				}
			}
		};

		traverse(rootFolder, '');
		return folders.sort();
	}
}
