// utils/aiService.js
// Lazy client init to avoid crashing when OPENAI_API_KEY is missing
const OpenAI = require('openai');

let openaiClient = null;
function getClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || !String(apiKey).trim()) {
        return null;
    }
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey });
    }
    return openaiClient;
}

class AIService {
    static async ask(question, context = '') {
        const client = getClient();
        if (!client) {
            const err = new Error('OPENAI_API_KEY missing');
            err.code = 'AI_CONFIG_MISSING';
            throw err;
        }
        const completion = await client.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "Tu es un assistant IA intégré dans un bot Discord. Réponds de manière utile et concise. Si c'est approprié, utilise des emojis Discord."
                },
                {
                    role: "user",
                    content: `${context ? `Contexte: ${context}\n\n` : ''}Question: ${question}`
                }
            ],
            max_tokens: 500,
            temperature: 0.7
        });
        return completion?.choices?.[0]?.message?.content || "";
    }

    // Backwards compat for ask.js which calls generateResponse
    static async generateResponse(question, userId = null, context = '') {
        return this.ask(question, context);
    }
}

module.exports = AIService;