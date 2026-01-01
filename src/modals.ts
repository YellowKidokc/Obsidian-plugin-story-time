import {
	App,
	Modal,
	Setting,
	ButtonComponent,
	Notice,
	TFolder,
	TextComponent
} from 'obsidian';
import { StoryTimeSettings, GeneratedStory, StoryChapter } from './types';
import { StoryGenerator } from './story-generator';
import { AIRefiner } from './ai-refiner';

/**
 * Modal for entering the concept to track
 */
export class ConceptInputModal extends Modal {
	private concept: string = '';
	private onSubmit: (concept: string) => void;

	constructor(app: App, onSubmit: (concept: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('story-time-modal');

		contentEl.createEl('h2', { text: 'Create Story Journey' });
		contentEl.createEl('p', {
			text: 'Enter the concept you want to track across your documents.',
			cls: 'story-time-description'
		});

		new Setting(contentEl)
			.setName('Concept')
			.setDesc('The wiki-link name to search for (e.g., "consciousness")')
			.addText(text => text
				.setPlaceholder('consciousness')
				.onChange(value => {
					this.concept = value;
				}));

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create Journey')
				.setCta()
				.onClick(() => {
					if (this.concept.trim()) {
						this.close();
						this.onSubmit(this.concept.trim());
					} else {
						new Notice('Please enter a concept name');
					}
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for folder selection with reordering
 */
export class FolderSelectModal extends Modal {
	private settings: StoryTimeSettings;
	private selectedFolders: string[] = [];
	private folderOrder: string[] = [];
	private onSubmit: (folders: string[], order: string[]) => void;

	constructor(
		app: App,
		settings: StoryTimeSettings,
		onSubmit: (folders: string[], order: string[]) => void
	) {
		super(app);
		this.settings = settings;
		this.selectedFolders = [...settings.selectedFolders];
		this.folderOrder = [...settings.folderOrder];
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('story-time-modal');

		contentEl.createEl('h2', { text: 'Select Source Folders' });
		contentEl.createEl('p', {
			text: 'Choose which folders to include in the story journey.',
			cls: 'story-time-description'
		});

		const folders = this.getAllFolders();
		const folderContainer = contentEl.createDiv({ cls: 'story-time-folder-select' });

		folders.forEach(folder => {
			const isSelected = this.selectedFolders.includes(folder);
			new Setting(folderContainer)
				.setName(folder || '(Root)')
				.addToggle(toggle => toggle
					.setValue(isSelected)
					.onChange(value => {
						if (value) {
							if (!this.selectedFolders.includes(folder)) {
								this.selectedFolders.push(folder);
								this.folderOrder.push(folder);
							}
						} else {
							this.selectedFolders = this.selectedFolders.filter(f => f !== folder);
							this.folderOrder = this.folderOrder.filter(f => f !== folder);
						}
						this.refreshOrderSection(contentEl);
					}));
		});

		// Order section
		const orderSection = contentEl.createDiv({ cls: 'story-time-order-section' });
		this.refreshOrderSection(contentEl);

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Continue')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.selectedFolders, this.folderOrder);
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	private refreshOrderSection(contentEl: HTMLElement) {
		let orderSection = contentEl.querySelector('.story-time-order-section');
		if (!orderSection) {
			orderSection = contentEl.createDiv({ cls: 'story-time-order-section' });
		}
		orderSection.empty();

		if (this.selectedFolders.length > 1) {
			orderSection.createEl('h3', { text: 'Folder Order' });
			orderSection.createEl('p', {
				text: 'Reorder folders to determine chapter sequence:',
				cls: 'story-time-description'
			});

			this.folderOrder.forEach((folder, index) => {
				if (this.selectedFolders.includes(folder)) {
					new Setting(orderSection as HTMLElement)
						.setName(`${index + 1}. ${folder}`)
						.addButton(btn => btn
							.setIcon('arrow-up')
							.setTooltip('Move up')
							.onClick(() => {
								if (index > 0) {
									[this.folderOrder[index - 1], this.folderOrder[index]] =
										[this.folderOrder[index], this.folderOrder[index - 1]];
									this.refreshOrderSection(contentEl);
								}
							}))
						.addButton(btn => btn
							.setIcon('arrow-down')
							.setTooltip('Move down')
							.onClick(() => {
								if (index < this.folderOrder.length - 1) {
									[this.folderOrder[index], this.folderOrder[index + 1]] =
										[this.folderOrder[index + 1], this.folderOrder[index]];
									this.refreshOrderSection(contentEl);
								}
							}));
				}
			});
		}
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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for previewing and adjusting the generated story
 */
export class StoryPreviewModal extends Modal {
	private story: GeneratedStory;
	private settings: StoryTimeSettings;
	private generator: StoryGenerator;
	private refiner: AIRefiner;
	private wordsBefore: number;
	private wordsAfter: number;
	private isRefining: boolean = false;

	constructor(
		app: App,
		story: GeneratedStory,
		settings: StoryTimeSettings,
		generator: StoryGenerator,
		refiner: AIRefiner
	) {
		super(app);
		this.story = story;
		this.settings = settings;
		this.generator = generator;
		this.refiner = refiner;
		this.wordsBefore = settings.wordsBefore;
		this.wordsAfter = settings.wordsAfter;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('story-time-modal');
		contentEl.addClass('story-time-preview-modal');

		contentEl.createEl('h2', { text: `Journey of "${this.story.concept}"` });

		// Stats
		const totalMentions = this.story.chapters.reduce((sum, ch) => sum + ch.mentions.length, 0);
		contentEl.createEl('p', {
			text: `Found ${totalMentions} mentions across ${this.story.chapters.length} files`,
			cls: 'story-time-stats'
		});

		// Context adjustment sliders
		const sliderSection = contentEl.createDiv({ cls: 'story-time-sliders' });
		sliderSection.createEl('h3', { text: 'Adjust Context' });

		new Setting(sliderSection)
			.setName(`Words before: ${this.wordsBefore}`)
			.addSlider(slider => slider
				.setLimits(5, 100, 5)
				.setValue(this.wordsBefore)
				.setDynamicTooltip()
				.onChange(async value => {
					this.wordsBefore = value;
					await this.regeneratePreview();
				}));

		new Setting(sliderSection)
			.setName(`Words after: ${this.wordsAfter}`)
			.addSlider(slider => slider
				.setLimits(5, 150, 5)
				.setValue(this.wordsAfter)
				.setDynamicTooltip()
				.onChange(async value => {
					this.wordsAfter = value;
					await this.regeneratePreview();
				}));

		// Preview section
		const previewSection = contentEl.createDiv({ cls: 'story-time-preview' });
		this.renderPreview(previewSection);

		// Action buttons
		const actionSection = contentEl.createDiv({ cls: 'story-time-actions' });

		new Setting(actionSection)
			.addButton(btn => btn
				.setButtonText('Save Raw Story')
				.setCta()
				.onClick(async () => {
					await this.saveStory(false);
				}));

		if (this.refiner.isAvailable()) {
			new Setting(actionSection)
				.addButton(btn => btn
					.setButtonText('Refine with AI & Save')
					.onClick(async () => {
						await this.refineAndSave();
					}));
		} else {
			actionSection.createEl('p', {
				text: 'Configure an AI provider in settings to enable story refinement.',
				cls: 'story-time-hint'
			});
		}

		new Setting(actionSection)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	private renderPreview(container: HTMLElement) {
		container.empty();
		container.createEl('h3', { text: 'Preview' });

		const previewContent = container.createDiv({ cls: 'story-time-preview-content' });

		// Show a summary view
		for (const chapter of this.story.chapters) {
			const chapterEl = previewContent.createDiv({ cls: 'story-time-chapter-preview' });
			chapterEl.createEl('h4', { text: chapter.fileName });
			chapterEl.createEl('span', {
				text: ` (${chapter.mentions.length} mention${chapter.mentions.length > 1 ? 's' : ''})`,
				cls: 'story-time-mention-count'
			});

			// Show first mention as preview
			if (chapter.mentions.length > 0) {
				const previewText = chapter.mentions[0].extractedContext;
				const truncated = previewText.length > 200
					? previewText.substring(0, 200) + '...'
					: previewText;
				chapterEl.createEl('blockquote', { text: truncated });
			}
		}
	}

	private async regeneratePreview() {
		// Update settings temporarily
		const originalBefore = this.settings.wordsBefore;
		const originalAfter = this.settings.wordsAfter;

		this.settings.wordsBefore = this.wordsBefore;
		this.settings.wordsAfter = this.wordsAfter;
		this.generator.updateSettings(this.settings);

		// Regenerate story
		this.story = await this.generator.generateStory(this.story.concept);

		// Restore settings
		this.settings.wordsBefore = originalBefore;
		this.settings.wordsAfter = originalAfter;

		// Re-render preview
		const previewSection = this.contentEl.querySelector('.story-time-preview');
		if (previewSection) {
			this.renderPreview(previewSection as HTMLElement);
		}
	}

	private async saveStory(useRefined: boolean) {
		try {
			// Use current slider values for final save
			this.settings.wordsBefore = this.wordsBefore;
			this.settings.wordsAfter = this.wordsAfter;
			this.generator.updateSettings(this.settings);

			const file = await this.generator.saveStory(this.story, useRefined);
			new Notice(`Story saved: ${file.path}`);
			this.close();

			// Open the file
			await this.app.workspace.openLinkText(file.path, '', true);
		} catch (error) {
			new Notice(`Failed to save story: ${error.message}`);
		}
	}

	private async refineAndSave() {
		if (this.isRefining) return;

		this.isRefining = true;
		new Notice('Refining story with AI... This may take a moment.');

		try {
			const refinedContent = await this.refiner.refineStory(this.story);
			this.story.refinedContent = refinedContent;
			await this.saveStory(true);
		} catch (error) {
			new Notice(`AI refinement failed: ${error.message}`);
		} finally {
			this.isRefining = false;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Simple folder selection modal for backup
 */
export class BackupFolderSelectModal extends Modal {
	private selectedFolders: string[] = [];
	private onSubmit: (folders: string[]) => void;

	constructor(app: App, onSubmit: (folders: string[]) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('story-time-modal');

		contentEl.createEl('h2', { text: 'Select Folders to Backup' });
		contentEl.createEl('p', {
			text: 'Choose which folders to back up now.',
			cls: 'story-time-description'
		});

		const folders = this.getAllFolders();
		const folderContainer = contentEl.createDiv({ cls: 'story-time-folder-select' });

		folders.forEach(folder => {
			new Setting(folderContainer)
				.setName(folder || '(Root)')
				.addToggle(toggle => toggle
					.setValue(false)
					.onChange(value => {
						if (value) {
							if (!this.selectedFolders.includes(folder)) {
								this.selectedFolders.push(folder);
							}
						} else {
							this.selectedFolders = this.selectedFolders.filter(f => f !== folder);
						}
					}));
		});

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Backup Selected')
				.setCta()
				.onClick(() => {
					if (this.selectedFolders.length > 0) {
						this.close();
						this.onSubmit(this.selectedFolders);
					} else {
						new Notice('Please select at least one folder');
					}
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Confirmation modal for AI refinement
 */
export class AIRefineConfirmModal extends Modal {
	private onConfirm: () => void;
	private onDecline: () => void;

	constructor(app: App, onConfirm: () => void, onDecline: () => void) {
		super(app);
		this.onConfirm = onConfirm;
		this.onDecline = onDecline;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('story-time-modal');

		contentEl.createEl('h2', { text: 'Refine with AI?' });
		contentEl.createEl('p', {
			text: 'Would you like AI to refine your story? This will:',
		});

		const list = contentEl.createEl('ul');
		list.createEl('li', { text: 'Add smooth transitions between sections' });
		list.createEl('li', { text: 'Create bridging concepts for better flow' });
		list.createEl('li', { text: 'Make the narrative more cohesive' });
		list.createEl('li', { text: 'Keep all original content intact' });

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Yes, Refine It')
				.setCta()
				.onClick(() => {
					this.close();
					this.onConfirm();
				}))
			.addButton(btn => btn
				.setButtonText('No, Keep Raw')
				.onClick(() => {
					this.close();
					this.onDecline();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
