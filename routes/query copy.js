// routes/query.js (Express.js route)
const OpenAI = require("openai");
const { Anthropic } = require("@anthropic-ai/sdk");
const { GoogleGenAI } = require("@google/genai");

const cardDataSet = require("../assets/dataset.json");

//
const genAI = new GoogleGenAI({
	apiKey: process.env.GOOGLE_GENAI_API_KEY,
});
// const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPY_API_KEY,
});

// Initialize OpenAI client
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// Sample credit card dataset - replace with your actual dataset
const creditCardsDataset = cardDataSet;

// Function to filter cards based on OpenAI-determined criteria
function filterCards(criteria) {
	let filteredCards = [...creditCardsDataset];

	// Apply filters based on criteria
	if (criteria.annualFee !== undefined) {
		if (criteria.annualFee === 0) {
			filteredCards = filteredCards.filter((card) => card.annualFee === 0);
		} else if (criteria.annualFee === "low") {
			filteredCards = filteredCards.filter((card) => card.annualFee <= 100);
		} else if (criteria.annualFee === "any") {
			// No filter needed
		}
	}

	if (criteria.rewardCategory) {
		filteredCards = filteredCards.filter((card) => {
			const category = criteria.rewardCategory.toLowerCase();
			return card.rewards[category] && card.rewards[category] > 1;
		});
	}

	if (criteria.minRewardRate) {
		filteredCards = filteredCards.filter((card) => {
			const category = criteria.rewardCategory || "general";
			return card.rewards[category] >= criteria.minRewardRate;
		});
	}

	if (criteria.cardType) {
		filteredCards = filteredCards.filter(
			(card) =>
				card.category.includes(criteria.cardType.toLowerCase()) ||
				card.features.some((feature) =>
					feature.toLowerCase().includes(criteria.cardType.toLowerCase())
				)
		);
	}

	if (criteria.features && criteria.features.length > 0) {
		filteredCards = filteredCards.filter((card) =>
			criteria.features.some((feature) =>
				card.features.some((cardFeature) =>
					cardFeature.toLowerCase().includes(feature.toLowerCase())
				)
			)
		);
	}

	// Sort by reward rate for the specified category
	if (criteria.rewardCategory) {
		filteredCards.sort(
			(a, b) =>
				(b.rewards[criteria.rewardCategory] || 0) -
				(a.rewards[criteria.rewardCategory] || 0)
		);
	} else {
		// Sort by general reward rate or annual fee
		filteredCards.sort((a, b) => {
			if (criteria.annualFee === 0) {
				return (b.rewards.general || 0) - (a.rewards.general || 0);
			}
			return a.annualFee - b.annualFee;
		});
	}

	return filteredCards.slice(0, 5); // Return top 5 matches
}

// Function to get filtering criteria from OpenAI
async function getCriteriaFromQuery(query, streamCallback) {
	// Streaming callback to write to the response
	try {
		const prompt = `
Analyze this credit card query and extract filtering criteria. Return a JSON object with these possible fields:

- annualFee: 0 (for no fee), "low" (under $100), or "any"
- rewardCategory: "fuel", "dining", "groceries", "travel", "entertainment", "general"
- minRewardRate: minimum reward percentage (number)
- cardType: "premium", "cashback", "travel", "fuel", "lifestyle", "everyday"
- features: array of required features like ["no annual fee", "travel benefits"]

Query: "${query}"

Examples:
"Best card with fuel cashback" → {"rewardCategory": "fuel", "annualFee": "any", "cardType": "fuel"}
"No annual fee cards" → {"annualFee": 0}
"Premium travel rewards card" → {"cardType": "premium", "rewardCategory": "travel"}
"Cards with dining rewards and no fee" → {"rewardCategory": "dining", "annualFee": 0}

Return only the JSON object, no explanation:`;

		const result = await genAI.models.generateContentStream({
			model: "gemini-1.5-flash",
			contents: prompt,
		});
		let response = "";

		for await (const chunk of result) {
			const chunkText = chunk.text;
			response += chunkText;

			// Push stream chunk to client via callback
			if (typeof streamCallback === "function") {
				streamCallback(chunkText);
			}
		}

		// Parse JSON response
		try {
			return JSON.parse(response.trim());
		} catch (parseError) {
			console.error("Error parsing Gemini response:", response);
			streamCallback?.(
				"\n\n[Warning: Could not parse criteria. Using fallback.]\n\n"
			);
			return { annualFee: "any" };
		}
	} catch (error) {
		console.error("Error getting criteria from Gemini:", error);
		throw error;
	}
}

// Function to generate explanation using OpenAI
async function generateExplanation(query, matches, criteria, streamCallback) {
	try {
		const prompt = `
    You are a helpful credit card advisor. Provide a brief, natural explanation for why these cards match the user's query.
    Query: "${query}"
          
Filtering criteria used: ${JSON.stringify(criteria)}

Top matched cards:
${matches
	.map(
		(card) =>
			`- ${card.name}: ${card.description} (Annual Fee: $${card.annualFee})`
	)
	.join("\n")}

Provide a brief, helpful explanation (2-3 sentences) of why these cards are good matches.
    `;
		// 		const completion = await openai.chat.completions.create({
		// 			model: "gpt-3.5-turbo",
		// 			messages: [
		// 				{
		// 					role: "system",
		// 					content:
		// 						"You are a helpful credit card advisor. Provide a brief, natural explanation for why these cards match the user's query.",
		// 				},
		// 				{
		// 					role: "user",
		// 					content: `Query: "${query}"

		// Filtering criteria used: ${JSON.stringify(criteria)}

		// Top matched cards:
		// ${matches
		// 	.map(
		// 		(card) =>
		// 			`- ${card.name}: ${card.description} (Annual Fee: $${card.annualFee})`
		// 	)
		// 	.join("\n")}

		// Provide a brief, helpful explanation (2-3 sentences) of why these cards are good matches.`,
		// 				},
		// 			],
		// 			max_tokens: 150,
		// 			temperature: 0.7,
		// 		});

		// return completion.choices[0].message.content;
		const result = await genAI.models.generateContentStream({
			model: "gemini-1.5-flash",
			contents: prompt,
		});
		let explanation = "";

		for await (const chunk of result) {
			const chunkText = chunk.text;
			explanation += chunkText;

			// Stream back to client if callback is provided
			if (typeof streamCallback === "function") {
				streamCallback(chunkText);
			}
		}

		return explanation.trim();
	} catch (error) {
		console.error("Error generating explanation:", error);
		return "Here are the best matching cards based on your criteria.";
	}
}

// Express.js route handler
const queryHandler = async (req, res) => {
	try {
		const { query } = req.body;

		if (!query || typeof query !== "string") {
			return res
				.status(400)
				.json({ error: "Query is required and must be a string" });
		}

		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		// Streaming callback to write to the response
		const streamCallback = (chunk) => {
			res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		};

		// Step 1: Streamed Gemini call
		streamCallback("Processing your query...\n\n");
		const criteria = await getCriteriaFromQuery(query, streamCallback);

		// Step 2: Filter cards
		const matches = filterCards(criteria);
		streamCallback(`\nFound ${matches.length} matching cards...\n`);

		// Step 3: Generate explanation
		const explanation = await generateExplanation(
			query,
			matches,
			criteria,
			streamCallback
		);
		streamCallback(`\n\n${explanation}\n`);

		// Step 4: Send final JSON (if needed by frontend)
		const finalPayload = {
			criteria,
			matches: matches.map((card) => ({
				...card,
				relevantReward: criteria.rewardCategory
					? `${card.rewards[criteria.rewardCategory] || 0}% on ${
							criteria.rewardCategory
					  }`
					: `${card.rewards.general || 0}% general`,
			})),
			explanation,
			totalResults: matches.length,
		};

		res.write(
			`\ndata: ${JSON.stringify({ type: "done", payload: finalPayload })}\n\n`
		);
		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		console.error("API Error:", error);
		res.write(
			`data: ${JSON.stringify("An error occurred. Please try again.")}\n\n`
		);
		res.write("data: [DONE]\n\n");
		res.end();
	}
};

module.exports = queryHandler;
