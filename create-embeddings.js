const { Crawler } = require("./crawler.js"); // pinecone blog implementation
const { PineconeClient } = require("@pinecone-database/pinecone");

const { TokenTextSplitter } = require("langchain/text_splitter");
const { updatePinecone } = require("./updatePinecone.js");
const { Document } = require("langchain/document");
const puppeteer = require("puppeteer"); // Used for scraaping, in python you might use scrapy/beautifulsoup

const getTextFromDocument = require("../process_documents"); // given a file (doc, pdf, txt etc) it processes it and returns raw text.
// Do note that pdfs and doc files might have non-text (images, videos etc) in them, so they mess up with the parsing.

// Langchain's automatic document loaders ~ should be available for python as well
const { PDFLoader } = require("langchain/document_loaders/fs/pdf"); // if you want to use langchain's default pdf scrapper, use this
const { DirectoryLoader } = require("langchain/document_loaders/fs/directory");
const { TextLoader } = require("langchain/document_loaders/fs/text");

function truncateStringByBytes(str, byteLimit) {
	const enc = new TextEncoder();
	const bytes = enc.encode(str);
	const length = bytes.byteLength;

	if (length <= byteLimit) {
		return str;
	}

	const startIndex = length - byteLimit;
	const endIndex = length;

	return enc.decode(bytes.slice(startIndex, endIndex));
}

///////////////////////////////////////
let chunkSize = 300;
let chunkOverlap = 20;
let byteLimit = 36000;
let limit = 100;

const splitter = new TokenTextSplitter({
	encodingName: "cl100k_base",
	chunkSize: chunkSize,
	chunkOverlap: chunkOverlap
});
///////////////////////////////////////

const createEmbeddings = (
	urls,
	documentNames,
	text,
	model,
	clientName,
	chatbotId
) => {
	return new Promise(async (resolve, reject) => {
		try {
			let docs;
			let allDocs = [];
			const final_data = [];

			let scrape_worker = 2; // 1 - pinecone scrapper, 2 - my own scrapper
			if (urls) {
				// From pinecone blog implementation
				if (scrape_worker == 1) {
					const crawlLimit = parseInt(limit ? limit : 100);

					const crawler = new Crawler(urls, crawlLimit, 200);
					final_data = await crawler.start();
				} else if (scrape_worker == 2) {
					// My own crawler implementation
					const browser = await puppeteer.launch({
						args: [
							"--no-sandbox",
							"--disable-setuid-sandbox",
							"--single-process",
							"--no-zygote"
						],
						executablePath:
							process.env.NODE_ENV === "production"
								? "/usr/bin/chromium-browser"
								: puppeteer.executablePath()
					});
					const page = await browser.newPage();
					for (let url of urls) {
						await page.goto(url, { waitUntil: "networkidle0" });
						const textContent = await page.evaluate(
							() => document.body.innerText
						);
						// fs.writeFile('input' + ++count + '.txt', textContent, (err) => {
						//   if (err) {
						//     console.error(err);
						//     return;
						//   }
						//   console.log('Text saved to file');
						// });
						final_data.push({ url: url, text: textContent });
					}
					await browser.close();
				}

				docs = await Promise.all(
					final_data.map(row => {
						if (row === undefined) {
							return [];
						}

						const docs = splitter.splitDocuments([
							new Document({
								pageContent: row.text,
								metadata: {
									source: row.url,
									text: truncateStringByBytes(row.text, byteLimit)
								}
							})
						]);
						return docs;
					})
				);
				// console.log("docs 1", docs);
				allDocs = allDocs.concat(docs);
			}

			if (documentNames) {
				// const loader = new DirectoryLoader("../../uploads/documents", {
				// 	".txt": path => new TextLoader(path),
				// 	".pdf": path => new PDFLoader(path)
				// });

				// docs = await loader.load();

				docs = await Promise.all(
					documentNames.map(async filename => {
						const text = await getTextFromDocument(filename);

						const docs = splitter.splitDocuments([
							new Document({
								pageContent: text.rawText,
								metadata: {
									source: filename,
									text: truncateStringByBytes(text, byteLimit)
								}
							})
						]);
						return docs;
					})
				);
				// console.log("docs 2", docs);
				allDocs = allDocs.concat(docs);
			}

			if (text) {
				// plain text processing
				const docs = await Promise.all([
					(async () => {
						const docs = splitter.splitDocuments([
							new Document({
								pageContent: text,
								metadata: {
									source: 0,
									text: truncateStringByBytes(text, byteLimit)
								}
							})
						]);
						return docs;
					})()
				]);
				// console.log("docs 3", docs);
				allDocs = allDocs.concat(docs);
			}

			// 8. Set up variables for the filename, question, and index settings
			const indexName = process.env.PINECONE_INDEX_NAME;
			const vectorDimension = 1536;

			// 9. Initialize Pinecone client with API key and environment
			const client = new PineconeClient();
			await client.init({
				apiKey: process.env.PINECONE_API_KEY,
				environment: process.env.PINECONE_ENVIRONMENT
			});

			// 10. Run the main async function
			await (async () => {
				// 11. Check if Pinecone index exists and create if necessary
				// try {
				//   await createPineconeIndex(client, indexName, vectorDimension);
				// } catch (err) {
				//   console.log("Error creating index:\n" + err);
				//   reject("Error creating index:\n" + err);
				// }

				// 12. Update Pinecone vector store with document embeddings
				try {
					await updatePinecone(
						client,
						indexName,
						allDocs,
						clientName,
						chatbotId
					);
					resolve("Created");
				} catch (err) {
					reject("Error updating index:\n" + err);
				}

				// 13. Query Pinecone vector store and GPT model for an answer
			})();
		} catch (error) {
			reject(error);
		}
	});
};

// // Create a new OpenAI model.
// const model = new OpenAI({
//   model: "gpt-3.5-turbo",
//   openAIApiKey,
//   temperature: 0.9,
// });

// // Create a new conversation chain.
// const chain = new ConversationChain({
//   llm: model,
//   memory: new BufferMemory(),
// });

// // Load your data.
// const data = [
//   "This is my first sentence.",
//   "This is my second sentence.",
//   "This is my third sentence.",
// ];

// // Train the chain on your data.
// chain.train(data);

// // Get the embeddings of your data.
// const embeddings = chain.getEmbeddings(data);

// // Print the embeddings.
// for (const embedding of embeddings) {
//   console.log(embedding);
// }

module.exports = {
	createEmbeddings
};
