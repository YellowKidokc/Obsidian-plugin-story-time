import { Notice } from 'obsidian';
import { StoryTimeSettings, GeneratedStory } from './types';

export class AIRefiner {
	private settings: StoryTimeSettings;

	constructor(settings: StoryTimeSettings) {
		this.settings = settings;
	}

	updateSettings(settings: StoryTimeSettings) {
		this.settings = settings;
	}

	/**
	 * Refine the story using the configured AI provider
	 */
	async refineStory(story: GeneratedStory): Promise<string> {
		if (this.settings.aiProvider === 'none') {
			throw new Error('No AI provider configured');
		}

		const prompt = this.buildPrompt(story);

		try {
			if (this.settings.aiProvider === 'openai') {
				return await this.callOpenAI(prompt);
			} else if (this.settings.aiProvider === 'anthropic') {
				return await this.callAnthropic(prompt);
			}
		} catch (error) {
			new Notice(`AI refinement failed: ${error.message}`);
			throw error;
		}

		throw new Error('Unknown AI provider');
	}

	/**
	 * Build the prompt for AI refinement
	 */
	private buildPrompt(story: GeneratedStory): string {
		return `You are a skilled editor helping to create a cohesive narrative.

I have collected excerpts about the concept "${story.concept}" from multiple documents. These excerpts are arranged in order, but they need to be woven together into a flowing, cohesive story.

Your task:
1. Keep ALL the original content and meaning intact - do not remove any information
2. Add smooth transitions between excerpts (bridging sentences)
3. Create a narrative flow that connects the ideas
4. Maintain the chapter structure but make it read like one continuous journey
5. Keep the academic/technical accuracy if present
6. Add a brief introduction and conclusion to frame the journey

Here is the raw collected content:

${story.rawContent}

Please rewrite this as a cohesive narrative journey, keeping all the original insights but making it flow naturally from one section to the next.`;
	}

	/**
	 * Call OpenAI API
	 */
	private async callOpenAI(prompt: string): Promise<string> {
		if (!this.settings.openaiApiKey) {
			throw new Error('OpenAI API key not configured');
		}

		const response = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.openaiApiKey}`
			},
			body: JSON.stringify({
				model: this.settings.aiModel || 'gpt-4',
				messages: [
					{
						role: 'system',
						content: 'You are a skilled editor who weaves disparate excerpts into cohesive narratives while preserving all original content.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: 4096,
				temperature: 0.7
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error?.message || 'OpenAI API request failed');
		}

		const data = await response.json();
		return data.choices[0].message.content;
	}

	/**
	 * Call Anthropic API
	 */
	private async callAnthropic(prompt: string): Promise<string> {
		if (!this.settings.anthropicApiKey) {
			throw new Error('Anthropic API key not configured');
		}

		const response = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.settings.anthropicApiKey,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: this.settings.aiModel || 'claude-3-sonnet-20240229',
				max_tokens: 4096,
				system: 'You are a skilled editor who weaves disparate excerpts into cohesive narratives while preserving all original content.',
				messages: [
					{
						role: 'user',
						content: prompt
					}
				]
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error?.message || 'Anthropic API request failed');
		}

		const data = await response.json();
		return data.content[0].text;
	}

	/**
	 * Check if AI refinement is available
	 */
	isAvailable(): boolean {
		if (this.settings.aiProvider === 'none') return false;
		if (this.settings.aiProvider === 'openai' && !this.settings.openaiApiKey) return false;
		if (this.settings.aiProvider === 'anthropic' && !this.settings.anthropicApiKey) return false;
		return true;
	}
}
