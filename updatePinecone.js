const { OpenAIEmbeddings } = require("langchain/embeddings/openai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const updatePinecone = async (
	client,
	indexName,
	docs,
	clientName,
	chatbotId
) => {
	try {
		// console.log("Retrieving Pinecone index...", docs);
		const index = client.Index(indexName);
		// console.log(`Pinecone index retrieved: ${indexName}`);
		for (let doc of docs) {
			doc = doc[0];
			const txtPath = doc.metadata.source;
			const text = doc.pageContent;
			const textSplitter = new RecursiveCharacterTextSplitter({
				chunkSize: 1000
			});
			// console.log("Splitting text into chunks...");
			const chunks = await textSplitter.createDocuments([text]);
			// console.log(`Text split into ${chunks.length} chunks`);
			// console.log(
			//   `Calling OpenAI's Embedding endpoint documents with ${chunks.length} text chunks ...`
			// );
			const embeddingsArrays = await new OpenAIEmbeddings().embedDocuments(
				chunks.map(chunk => chunk.pageContent.replace(/\n/g, " "))
			);
			// console.log(
			// 	"Finished embedding documents",
			// 	embeddingsArrays.length,
			// 	embeddingsArrays[0].length
			// );
			// console.log(
			// 	`Creating ${chunks.length} vectors array with id, values, and metadata...`
			// );
			const batchSize = 100;

			let batch = [];
			for (let idx = 0; idx < chunks.length; idx++) {
				const chunk = chunks[idx];
				const vector = {
					id: `${txtPath}_${idx}`,
					values: embeddingsArrays[idx],
					metadata: {
						...chunk.metadata,
						loc: JSON.stringify(chunk.metadata.loc),
						pageContent: chunk.pageContent,
						txtPath: txtPath,
						clientName: clientName
					}
				};
				batch.push(vector);
				// When batch is full or it's the last item, upsert the vectors
				if (batch.length === batchSize || idx === chunks.length - 1) {
					await index.upsert({
						upsertRequest: {
							vectors: batch,
							namespace: chatbotId
						}
					});
					// Empty the batch
					batch = [];
				}
			}
			console.log(`Pinecone index updated with ${chunks.length} vectors`);
		}
	} catch (error) {
		console.error("An error occurred:", error);
	}
};

module.exports = { updatePinecone };
