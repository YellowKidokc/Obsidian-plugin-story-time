import { App, TFile, TFolder } from 'obsidian';
import { StoryTimeSettings, ConceptMention, StoryChapter, GeneratedStory } from './types';

export class StoryGenerator {
	private app: App;
	private settings: StoryTimeSettings;

	constructor(app: App, settings: StoryTimeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: StoryTimeSettings) {
		this.settings = settings;
	}

	/**
	 * Find all mentions of a concept across selected folders
	 */
	async findConceptMentions(concept: string): Promise<ConceptMention[]> {
		const mentions: ConceptMention[] = [];
		const files = this.getFilesInSelectedFolders();

		// Pattern to match wiki-links: [[concept]] or [[concept|alias]]
		const linkPattern = new RegExp(
			`\\[\\[${this.escapeRegex(concept)}(\\|[^\\]]+)?\\]\\]`,
			'gi'
		);

		for (const file of files) {
			const content = await this.app.vault.read(file);
			const lines = content.split('\n');

			let charIndex = 0;
			for (let lineNum = 0; lineNum < lines.length; lineNum++) {
				const line = lines[lineNum];
				let match;

				while ((match = linkPattern.exec(line)) !== null) {
					const context = this.extractContext(
						content,
						charIndex + match.index,
						match[0].length
					);

					mentions.push({
						filePath: file.path,
						fileName: file.basename,
						folderPath: file.parent?.path || '',
						lineNumber: lineNum + 1,
						fullParagraph: this.extractParagraph(lines, lineNum),
						extractedContext: context,
						conceptLink: match[0],
						position: charIndex + match.index
					});
				}

				charIndex += line.length + 1; // +1 for newline
			}
		}

		return mentions;
	}

	/**
	 * Extract context around a match with configurable word counts
	 */
	private extractContext(content: string, matchStart: number, matchLength: number): string {
		const beforeText = content.substring(0, matchStart);
		const afterText = content.substring(matchStart + matchLength);
		const matchText = content.substring(matchStart, matchStart + matchLength);

		// Get words before
		const wordsBefore = beforeText.split(/\s+/).filter(w => w.length > 0);
		const beforeWords = wordsBefore.slice(-this.settings.wordsBefore).join(' ');

		// Get words after
		const wordsAfter = afterText.split(/\s+/).filter(w => w.length > 0);
		const afterWords = wordsAfter.slice(0, this.settings.wordsAfter).join(' ');

		// Clean up - remove incomplete sentences at boundaries if possible
		let result = `${beforeWords} ${matchText} ${afterWords}`.trim();

		// Add ellipsis if we truncated
		if (wordsBefore.length > this.settings.wordsBefore) {
			result = '...' + result;
		}
		if (wordsAfter.length > this.settings.wordsAfter) {
			result = result + '...';
		}

		return result;
	}

	/**
	 * Extract the full paragraph containing the match
	 */
	private extractParagraph(lines: string[], lineNum: number): string {
		// Find paragraph boundaries (empty lines or headers)
		let start = lineNum;
		let end = lineNum;

		// Search backwards for paragraph start
		while (start > 0 && lines[start - 1].trim() !== '' && !lines[start - 1].startsWith('#')) {
			start--;
		}

		// Search forwards for paragraph end
		while (end < lines.length - 1 && lines[end + 1].trim() !== '' && !lines[end + 1].startsWith('#')) {
			end++;
		}

		return lines.slice(start, end + 1).join('\n').trim();
	}

	/**
	 * Get all markdown files in selected folders
	 */
	private getFilesInSelectedFolders(): TFile[] {
		const allFiles = this.app.vault.getMarkdownFiles();

		if (this.settings.selectedFolders.length === 0) {
			return allFiles;
		}

		return allFiles.filter(file => {
			const filePath = file.path;
			return this.settings.selectedFolders.some(folder =>
				filePath.startsWith(folder + '/') || filePath.startsWith(folder)
			);
		});
	}

	/**
	 * Organize mentions into chapters by folder and file
	 */
	organizeIntoChapters(mentions: ConceptMention[]): StoryChapter[] {
		const chapterMap = new Map<string, StoryChapter>();

		for (const mention of mentions) {
			const key = mention.filePath;

			if (!chapterMap.has(key)) {
				chapterMap.set(key, {
					folderName: mention.folderPath,
					filePath: mention.filePath,
					fileName: mention.fileName,
					mentions: [],
					order: this.getFolderOrder(mention.folderPath)
				});
			}

			chapterMap.get(key)!.mentions.push(mention);
		}

		// Convert to array and sort
		const chapters = Array.from(chapterMap.values());

		// Sort by folder order first, then by filename
		chapters.sort((a, b) => {
			if (a.order !== b.order) {
				return a.order - b.order;
			}
			return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
		});

		// Sort mentions within each chapter by position
		chapters.forEach(chapter => {
			chapter.mentions.sort((a, b) => a.position - b.position);
		});

		return chapters;
	}

	/**
	 * Get the order number for a folder based on settings
	 */
	private getFolderOrder(folderPath: string): number {
		const index = this.settings.folderOrder.indexOf(folderPath);
		return index === -1 ? 999 : index;
	}

	/**
	 * Generate the raw story markdown
	 */
	generateRawStory(concept: string, chapters: StoryChapter[]): string {
		let story = `# The Journey of ${concept}\n\n`;
		story += `*Generated by Story Time on ${new Date().toLocaleDateString()}*\n\n`;
		story += `---\n\n`;

		let chapterNum = 1;
		let currentFolder = '';

		for (const chapter of chapters) {
			// Add folder header if changed
			if (chapter.folderName !== currentFolder) {
				currentFolder = chapter.folderName;
				if (currentFolder) {
					story += `## Part: ${currentFolder}\n\n`;
				}
			}

			// Chapter header
			story += `### Chapter ${chapterNum}: ${chapter.fileName}\n\n`;

			if (this.settings.includeSourceLinks) {
				story += `*Source: [[${chapter.filePath}]]*\n\n`;
			}

			// Add each mention
			for (let i = 0; i < chapter.mentions.length; i++) {
				const mention = chapter.mentions[i];
				story += `> ${mention.extractedContext}\n\n`;

				if (i < chapter.mentions.length - 1) {
					story += `---\n\n`;
				}
			}

			story += `\n`;
			chapterNum++;
		}

		return story;
	}

	/**
	 * Generate the complete story object
	 */
	async generateStory(concept: string): Promise<GeneratedStory> {
		const mentions = await this.findConceptMentions(concept);
		const chapters = this.organizeIntoChapters(mentions);
		const rawContent = this.generateRawStory(concept, chapters);

		return {
			concept,
			chapters,
			rawContent
		};
	}

	/**
	 * Save the story to a file
	 */
	async saveStory(story: GeneratedStory, useRefined: boolean = false): Promise<TFile> {
		const content = useRefined && story.refinedContent
			? story.refinedContent
			: story.rawContent;

		const fileName = `${story.concept}-journey.md`;
		let filePath = fileName;

		if (this.settings.outputFolder) {
			// Ensure output folder exists
			const folder = this.app.vault.getAbstractFileByPath(this.settings.outputFolder);
			if (!folder) {
				await this.app.vault.createFolder(this.settings.outputFolder);
			}
			filePath = `${this.settings.outputFolder}/${fileName}`;
		}

		// Check if file exists and handle accordingly
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, content);
			return existingFile;
		}

		return await this.app.vault.create(filePath, content);
	}

	private escapeRegex(string: string): string {
		return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
