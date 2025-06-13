// routes/query.js (LLM-First Approach)
const { GoogleGenAI } = require("@google/genai");
const cardDataSet = require("../assets/dataset.json");

const genAI = new GoogleGenAI({
	apiKey: process.env.GOOGLE_GENAI_API_KEY,
});

const creditCardsDataset = cardDataSet;

// Let LLM directly analyze query and return best matches
async function getRecommendationsFromLLM(query, streamCallback) {
	try {
		const prompt = `
You are an expert credit card consultant with access to a comprehensive database of Indian credit cards. Analyze the user's query and provide the most relevant card recommendations.

Available Credit Cards Database:
${JSON.stringify(creditCardsDataset, null, 2)}

User Query: "${query}"

Instructions:
1. Understand the user's intent (comparison, recommendation, specific card info, etc.)
2. Analyze their needs based on the query
3. Select the most relevant cards from the database
4. For comparisons: Find the exact cards mentioned
5. For recommendations: Find cards that best match their criteria
6. Consider factors like fees, rewards, card type, features, and target audience

IMPORTANT: In the analysis field, avoid using pipe characters (|) for tables. Use simple text formatting instead.

Return a JSON response with this structure:
{
  "queryType": "comparison" | "recommendation" | "information",
  "selectedCards": [
    {
      "card_name": "exact name from database",
      "bank": "bank name",
      "relevanceScore": 95,
      "relevanceReason": "why this card matches the query"
    }
  ],
  "analysis": "detailed explanation using simple markdown without pipe tables"
}

Rules:
- For comparison queries: Find the exact cards mentioned, even if names are abbreviated
- Maximum 5 cards for recommendations, all mentioned cards for comparisons
- Relevance score: 1-100 based on how well the card matches the query
- Be thorough in your analysis but avoid pipe tables in the analysis field
- Use bullet points, numbered lists, and simple formatting instead of tables
- Consider Indian market context and typical usage patterns

Be flexible with card names, abbreviations, and common terms. If the query is vague, use your best judgment to find the most relevant cards.

Return only the JSON object:`;

		const result = await genAI.models.generateContentStream({
			contents: prompt,
			model: "gemini-1.5-flash",
		});

		let response = "";
		for await (const chunk of result) {
			const chunkText = chunk.text;
			response += chunkText;

			// Stream the thinking process
			if (typeof streamCallback === "function") {
				streamCallback({
					type: "thinking",
					content: chunkText,
				});
			}
		}

		// Clean and parse JSON response
		try {
			// Find JSON block more carefully
			let jsonString = response.trim();

			// Remove code block markers if present
			if (jsonString.startsWith("```json")) {
				jsonString = jsonString
					.replace(/^```json\s*/, "")
					.replace(/\s*```$/, "");
			} else if (jsonString.startsWith("```")) {
				jsonString = jsonString.replace(/^```\s*/, "").replace(/\s*```$/, "");
			}

			// Find the actual JSON object
			const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("No valid JSON structure found");
			}

			let jsonText = jsonMatch[0];

			// Clean the JSON string to handle common parsing issues
			// Fix newlines in string values
			jsonText = jsonText.replace(
				/"analysis":\s*"([^"]*(?:\\"[^"]*)*)"/,
				(match, analysisContent) => {
					// Properly escape newlines and quotes in the analysis field
					const cleanAnalysis = analysisContent
						.replace(/\n/g, "\\n")
						.replace(/\r/g, "\\r")
						.replace(/\t/g, "\\t")
						.replace(/"/g, '\\"');
					return `"analysis": "${cleanAnalysis}"`;
				}
			);

			const llmResponse = JSON.parse(jsonText);

			// Get full card details for selected cards
			const selectedCards = llmResponse.selectedCards
				.map((selection) => {
					const fullCard = creditCardsDataset.find(
						(card) =>
							card.card_name.toLowerCase() === selection.card_name.toLowerCase()
					);

					if (fullCard) {
						return {
							...fullCard,
							relevanceScore: selection.relevanceScore,
							relevanceReason: selection.relevanceReason,
						};
					}
					return null;
				})
				.filter(Boolean);

			return {
				queryType: llmResponse.queryType,
				selectedCards,
				analysis: llmResponse.analysis,
				totalResults: selectedCards.length,
			};
		} catch (parseError) {
			console.error("Error parsing LLM response:", parseError);
			console.error("Raw response:", response);

			// Enhanced fallback: try to extract useful information
			streamCallback?.({
				type: "message",
				content: "⚠️ JSON parsing failed, using fallback matching...\n\n",
			});

			// Try to extract card names from the response even if JSON parsing fails
			const cardNameMatches = response.match(/"card_name":\s*"([^"]+)"/g);
			if (cardNameMatches) {
				const extractedCardNames = cardNameMatches.map(
					(match) => match.match(/"card_name":\s*"([^"]+)"/)[1]
				);

				const matchedCards = extractedCardNames
					.map((name) =>
						creditCardsDataset.find(
							(card) => card.card_name.toLowerCase() === name.toLowerCase()
						)
					)
					.filter(Boolean);

				if (matchedCards.length > 0) {
					return {
						queryType: "recommendation",
						selectedCards: matchedCards.map((card) => ({
							...card,
							relevanceScore: 90,
							relevanceReason: "Extracted from failed JSON response",
						})),
						analysis:
							"Card recommendations were extracted despite JSON parsing issues.",
						totalResults: matchedCards.length,
					};
				}
			}

			return fallbackMatching(query);
		}
	} catch (error) {
		console.error("Error getting LLM recommendations:", error);
		throw error;
	}
}

// Simple fallback matching if LLM fails
function fallbackMatching(query) {
	const queryLower = query.toLowerCase();
	let matches = [];

	// Check for specific card mentions
	creditCardsDataset.forEach((card) => {
		const cardNameLower = card.card_name.toLowerCase();
		const bankNameLower = card.bank.toLowerCase();

		if (
			queryLower.includes(cardNameLower) ||
			queryLower.includes(bankNameLower) ||
			cardNameLower.includes(queryLower.split(" ")[0])
		) {
			matches.push({
				...card,
				relevanceScore: 80,
				relevanceReason: "Name mentioned in query",
			});
		}
	});

	// If no specific matches, do keyword matching
	if (matches.length === 0) {
		creditCardsDataset.forEach((card) => {
			let score = 0;
			const searchTerms = queryLower.split(" ");

			searchTerms.forEach((term) => {
				if (
					card.features.some((feature) => feature.toLowerCase().includes(term))
				)
					score += 20;
				if (card.card_type.toLowerCase().includes(term)) score += 30;
				if (card.summary.toLowerCase().includes(term)) score += 10;
			});

			if (score > 0) {
				matches.push({
					...card,
					relevanceScore: Math.min(score, 100),
					relevanceReason: "Keyword matching",
				});
			}
		});

		matches.sort((a, b) => b.relevanceScore - a.relevanceScore);
		matches = matches.slice(0, 5);
	}

	return {
		queryType: "recommendation",
		selectedCards: matches,
		analysis:
			"Here are the cards that best match your query based on keyword analysis.",
		totalResults: matches.length,
	};
}

// Generate streaming explanation
async function generateStreamingExplanation(query, llmResult, streamCallback) {
	try {
		const prompt = `
You are a friendly credit card advisor. The user asked: "${query}"

Based on my analysis, I've selected these cards:
${llmResult.selectedCards
	.map(
		(card, index) =>
			`${index + 1}. ${card.card_name} by ${card.bank}
   - Annual Fee: ₹${card.annual_fee}
   - Reward Rate: ${card.reward_rate}
   - Type: ${card.card_type}
   - Key Features: ${card.features.slice(0, 4).join(", ")}
   - Why selected: ${card.relevanceReason}
   - Summary: ${card.summary}`
	)
	.join("\n\n")}

Previous Analysis: ${llmResult.analysis}

Now provide a conversational, helpful explanation to the user. Make it:
- Natural and friendly
- Focused on practical benefits
- Easy to understand
- Action-oriented (help them decide)

Don't repeat the technical details, focus on helping them understand which card(s) would work best for their needs.`;

		const result = await genAI.models.generateContentStream({
			contents: prompt,
			model: "gemini-1.5-flash",
		});

		let explanation = "";
		for await (const chunk of result) {
			const chunkText = chunk.text;
			explanation += chunkText;

			if (typeof streamCallback === "function") {
				streamCallback({
					type: "message",
					content: chunkText,
				});
			}
		}

		return explanation.trim();
	} catch (error) {
		console.error("Error generating explanation:", error);
		return (
			llmResult.analysis || "Here are the best matching cards for your query."
		);
	}
}

// Main handler - much simpler now!
const queryHandler = async (req, res) => {
	try {
		const { query } = req.body;

		if (!query || typeof query !== "string") {
			return res
				.status(400)
				.json({ error: "Query is required and must be a string" });
		}

		// Set up Server-Sent Events
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.flushHeaders();

		const streamCallback = (data) => {
			res.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		// Step 1: Let LLM analyze and recommend
		streamCallback({
			type: "status",
			content: "🤖 AI is analyzing your query and finding the best matches...",
		});

		const llmResult = await getRecommendationsFromLLM(query, streamCallback);

		streamCallback({
			type: "status",
			content: `✅ Found ${llmResult.totalResults} relevant cards\n\n`,
		});

		// Step 2: Generate user-friendly explanation
		streamCallback({
			type: "status",
			content: "💬 Preparing personalized explanation...\n\n",
		});

		const explanation = await generateStreamingExplanation(
			query,
			llmResult,
			streamCallback
		);

		// Step 3: Send final results
		streamCallback({
			type: "cards",
			content: {
				queryType: llmResult.queryType,
				matches: llmResult.selectedCards.map((card) => ({
					...card,
					annual_fee_display:
						card.annual_fee === "0" ? "Free" : `₹${card.annual_fee}`,
					relevantFeatures: card.features.slice(0, 4),
				})),
				explanation,
				totalResults: llmResult.totalResults,
				query: query,
				aiAnalysis: llmResult.analysis,
			},
		});

		res.write("data: [DONE]\n\n");
		res.end();
	} catch (error) {
		console.error("API Error:", error);
		res.write(
			`data: ${JSON.stringify({
				type: "error",
				content: "❌ An error occurred. Please try again.",
			})}\n\n`
		);
		res.write("data: [DONE]\n\n");
		res.end();
	}
};

module.exports = queryHandler;
