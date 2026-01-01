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
}

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
