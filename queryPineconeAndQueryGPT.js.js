const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
// const { loadQAStuffChain, ConversationChain } = require("langchain/chains");
const { PineconeClient } = require("@pinecone-database/pinecone");
const ChatMessage = require("../../models/ChatMessageSchema");

const { ConversationChain } = require("langchain/chains");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const {
	ChatPromptTemplate,
	HumanMessagePromptTemplate,
	SystemMessagePromptTemplate,
	MessagesPlaceholder
} = require("langchain/prompts");
const { BufferMemory } = require("langchain/memory");
const Customization = require("../../models/Customizations");

const getCurrentChatContext = async (clientName, visitorId, chatbotId) => {
	const res = await ChatMessage.findOne({
		clientName: clientName,
		visitorId: visitorId,
		chatbotId: chatbotId
	});

	if (res) {
		let history = "";
		let questions = [];
		let answers = [];
		for (let i = 0; i < res.content.length; i++) {
			// if (res.content[i].sender == "Visitor") {
			//   questions.push(res.content[i].text)
			// } else{
			//   answers.push(res.content[i].text)
			// }
			history += res.content[i].sender + ": " + res.content[i].text + "\n";
		}

		// history = {
		//   "previousQuestions": questions,
		//   "previousAnswers": answers,
		// }

		return history;
	} else {
		return "";
	}
};

const saveCurrentChatContext = async (
	sender,
	text,
	clientName,
	visitorId,
	chatbotId
) => {
	// Set the context value in a proper format for ai and user response to be separate

	const newContent = {
		sender: sender,
		text: text,
		timestamp: new Date()
	};

	try {
		const chatSaveResponse = await ChatMessage.findOneAndUpdate(
			{
				clientName: clientName,
				visitorId: visitorId,
				chatbotId: chatbotId
			},
			{ $push: { content: newContent }, $set: { lastModified: new Date() } },
			{ new: true }
		);

		if (chatSaveResponse.err) {
			console.log(chatSaveResponse.err);
		} else {
			// console.log(chatSaveResponse);
			const latestMessage =
				chatSaveResponse.content[chatSaveResponse.content.length - 1];
			const latestMessageId = latestMessage._id;
			// return id of latest message content
			return latestMessageId;
		}
	} catch (err) {
		console.log(err);
	}
};

// 2. Export the queryPineconeVectorStoreAndQueryLLM function
const queryPineconeVectorStoreAndQueryLLM = async (
	question,
	clientName,
	chatbotId,
	visitorId
) => {
	const temperature = 0.5;

	await saveCurrentChatContext(
		"Visitor",
		question,
		clientName,
		visitorId,
		chatbotId
	);

	const customizationResponse = await Customization.findOne({
		email: clientName,
		chatbotId: chatbotId
	});

	const systemPrompt = customizationResponse.sysPrompt;

	const client = new PineconeClient();
	await client.init({
		apiKey: process.env.PINECONE_API_KEY,
		environment: process.env.PINECONE_ENVIRONMENT
	});
	const indexName = process.env.PINECONE_INDEX_NAME;

	const specificDocuments = [];
	// console.log("Querying Pinecone vector store...");
	const index = client.Index(indexName);
	const queryEmbedding = await new OpenAIEmbeddings().embedQuery(question);

	let queryResponse = await index.query({
		queryRequest: {
			vector: queryEmbedding,
			topK: 3,
			includeValues: true,
			includeMetadata: true,
			// filter: {
			//   genre: { $in: ["comedy", "documentary", "drama"] },
			// },
			namespace: chatbotId
		}
	});

	// console.log(`Found ${queryResponse.matches.length} matches...`);
	// console.log(`Asking question: ${question}...`);
	if (queryResponse.matches.length) {
		// const currentChatContext = await getCurrentChatContext(clientName, visitorId, chatbotId);

		const concatenatedPageContent = queryResponse.matches
			.map(match => match.metadata.pageContent)
			.join(" ");

		const source = queryResponse.matches
			.map(match => match.metadata.txtPath)
			.join(" ");

		const chat = new ChatOpenAI({ temperature });

		const chatPrompt = ChatPromptTemplate.fromPromptMessages([
			SystemMessagePromptTemplate.fromTemplate(
				`${systemPrompt}
        CONTEXT: ${concatenatedPageContent}
        SOURCE: ${source}
        `
			),
			new MessagesPlaceholder("history"), // probably should set unique history based on visitorId
			HumanMessagePromptTemplate.fromTemplate("{input}")
		]);

		const chain = new ConversationChain({
			memory: new BufferMemory({ returnMessages: true, memoryKey: "history" }),
			prompt: chatPrompt,
			llm: chat
		});

		const response = await chain.call({
			input: question
		});

		// const response = {
		// 	response: "dummy response from bot"
		// };

		// response.on("data", (chunk) => {
		//   console.log(chunk.toString());
		// });

		// response.on("end", () => {
		//   console.log("Stream ended.");
		// });

		// cache.set(visitorId, {
		//   chain: chain
		// });

		const messageId = await saveCurrentChatContext(
			"AI",
			response.response,
			clientName,
			visitorId,
			chatbotId
		);

		console.log("response from bot: ", response, "messageId: ", messageId);

		return { data: response, messageId: messageId };

		// const result = await chain.call({
		//   input_documents: [new Document({ pageContent: concatenatedPageContent })],
		//   question: question,
		//   context: currentChatContext,
		// });

		const result = await converseChain.call({
			// context: [new Document({ pageContent: concatenatedPageContent })],
			context: concatenatedPageContent,
			input: question
			// history: currentChatContext,
		});

		// if (!conversationChains[visitorId]) {
		//   // Create a new instance of the MemoryBuffer for this conversation
		//   const memory = new MemoryBuffer();

		//   // Create a new instance of the ConversationChain with the memory buffer
		//   conversationChains[visitorId] = new ConversationChain({ memoryBuffer: memory });
		// }

		// // Get the ConversationChain instance for the session ID
		// const chain = conversationChains[visitorId];

		// // Get the response from the ConversationChain
		// const response = chain.generateResponse(question, context=concatenatedPageContent);

		// // Store the conversation history in the memory buffer
		// chain.storeConversation(question, response);

		// 12. Log the answer
		console.log(`Answer: ${result.response}, from ${source}`);
	} else {
		// 13. Log that there are no matches, so GPT-3 will not be queried
		console.log("Since there are no matches, GPT-3 will not be queried.");
	}
};

module.exports = { queryPineconeVectorStoreAndQueryLLM };
