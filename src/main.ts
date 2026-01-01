import {
	App,
	Plugin,
	Notice,
	TFile,
	Menu,
	Editor,
	MarkdownView
} from 'obsidian';
import { StoryTimeSettings, DEFAULT_SETTINGS } from './types';
import { StoryTimeSettingTab } from './settings';
import { StoryGenerator } from './story-generator';
import { AIRefiner } from './ai-refiner';
import {
	ConceptInputModal,
	FolderSelectModal,
	StoryPreviewModal
} from './modals';

export default class StoryTimePlugin extends Plugin {
	settings: StoryTimeSettings;
	generator: StoryGenerator;
	refiner: AIRefiner;

	async onload() {
		await this.loadSettings();

		this.generator = new StoryGenerator(this.app, this.settings);
		this.refiner = new AIRefiner(this.settings);

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
		console.log('Story Time plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.generator?.updateSettings(this.settings);
		this.refiner?.updateSettings(this.settings);
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
