/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2025 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
                     http://digitalscholar.org/
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Zotero.Embeddings = {
	_embeddings: new Map(), // itemID -> Float32Array
	_model: 'Xenova/all-MiniLM-L6-v2',
	_populated: false,
	
	/**
	 * Build searchable text from item metadata
	 */
	_buildItemText(item) {
		let parts = [];
		
		// Title
		let title = item.getField('title');
		if (title) {
			parts.push(title);
		}
		
		// Creators
		let creators = item.getCreators();
		if (creators.length) {
			let creatorNames = creators.map(c => {
				let name = c.firstName ? `${c.firstName} ${c.lastName}` : c.lastName;
				return name;
			}).join(', ');
			parts.push(creatorNames);
		}
		
		// Abstract
		let abstract = item.getField('abstractNote');
		if (abstract) {
			// Limit abstract length to avoid overwhelming the model
			parts.push(abstract.substring(0, 500));
		}
		
		return parts.join(' | ');
	},
	
	/**
	 * Generate embedding for an item
	 */
	async _generateEmbedding(item) {
		let text = this._buildItemText(item);
		if (!text.trim()) {
			return null;
		}
		
		// Run inference to get embeddings
		let result = await Zotero.MLWorker.runInference(
			'feature-extraction',
			text,
			this._model
		);
		
		// Result is a tensor with shape [batch_size, sequence_length, hidden_size]
		// We need to pool it to get [batch_size, hidden_size]
		// For single text: [[token1_embedding], [token2_embedding], ...] -> [sentence_embedding]
		
		// Mean pooling: average all token embeddings
		let tokenEmbeddings = result.data; // This is a flat array
		let dims = result.dims; // [batch_size, sequence_length, hidden_size]
		
		if (!dims || dims.length !== 3) {
			console.log("Unexpected result format:", result);
			return null;
		}
		
		let [batchSize, seqLength, hiddenSize] = dims;
		
		// Extract embeddings for first item in batch and perform mean pooling
		let embedding = new Array(hiddenSize).fill(0);
		
		for (let i = 0; i < seqLength; i++) {
			for (let j = 0; j < hiddenSize; j++) {
				let idx = i * hiddenSize + j;
				embedding[j] += tokenEmbeddings[idx];
			}
		}
		
		// Average
		for (let j = 0; j < hiddenSize; j++) {
			embedding[j] /= seqLength;
		}
		
		// Normalize (L2 normalization)
		let norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
		for (let j = 0; j < hiddenSize; j++) {
			embedding[j] /= norm;
		}
		
		return embedding;
	},
	
	/**
	 * Calculate cosine similarity between two embeddings
	 */
	_cosineSimilarity(a, b) {
		if (a.length !== b.length) {
			throw new Error('Embeddings must have same dimensions');
		}
		
		let dotProduct = 0;
		let normA = 0;
		let normB = 0;
		
		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		
		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
	},
	
	/**
	 * Populate embeddings for all items in a library
	 */
	async populate(libraryID = 1, maxCount = null) {
		Zotero.debug(`Embeddings: Starting population for library ${libraryID}`);
		let startTime = Date.now();
		
		// Get all items
		let items = await Zotero.Items.getAll(libraryID, true);
		Zotero.debug(`Embeddings: Processing ${items.length} items`);
		
		let successCount = 0;
		let skipCount = 0;
		
		for (let i = 0; i < (maxCount || items.length); i++) {
			console.log("Item ", items[i].id, items[i].getDisplayTitle());
			let item = items[i];
			
			// Skip items that already have embeddings
			if (this._embeddings.has(item.id)) {
				skipCount++;
				console.log("-- Skipping ", item.id);
				continue;
			}
			
			try {
				let embedding = await this._generateEmbedding(item);
				if (embedding) {
					this._embeddings.set(item.id, embedding);
					successCount++;
					
					// Log progress every 10 items
					if ((i + 1) % 10 === 0) {
						console.log(`Embeddings: Processed ${i + 1}/${items.length} items`);
					}
				}
				else {
					skipCount++;
				}
			}
			catch (error) {
				console.log(`Failed to generate embedding for item ${item.id}: ${error.message}`);
				skipCount++;
			}
		}
		
		this._populated = true;
		
		let duration = Date.now() - startTime;
		Zotero.debug(`Embeddings: Population complete. Success: ${successCount}, Skipped: ${skipCount}, Time: ${duration}ms`);
		
		return {
			total: items.length,
			success: successCount,
			skipped: skipCount,
			duration
		};
	},
	
	/**
	 * Find items similar to the given item
	 */
	async findSimilarItems(item, topK = 10) {
		if (!this._populated) {
			throw new Error('Embeddings not populated. Call Zotero.Embeddings.populate() first.');
		}
		
		// Get or generate embedding for query item
		let queryEmbedding = this._embeddings.get(item.id);
		if (!queryEmbedding) {
			queryEmbedding = await this._generateEmbedding(item);
			if (!queryEmbedding) {
				return [];
			}
		}
		
		// Calculate similarities
		let scores = [];
		for (let [itemID, embedding] of this._embeddings) {
			// Skip the query item itself
			if (itemID === item.id) {
				continue;
			}
			
			let similarity = this._cosineSimilarity(queryEmbedding, embedding);
			
			// Optimization: only keep top K candidates
			if (scores.length < topK || similarity > scores[scores.length - 1].similarity) {
				scores.push({ itemID, similarity });
				scores.sort((a, b) => b.similarity - a.similarity);
				if (scores.length > topK) {
					scores.pop();
				}
			}
		}
		
		// Load the actual items
		let results = [];
		for (let { itemID, similarity } of scores) {
			let similarItem = await Zotero.Items.getAsync(itemID);
			if (similarItem) {
				results.push({ item: similarItem, similarity });
			}
		}
		
		return results;
	},
	
	/**
	 * Suggest tags for an item based on similar items
	 */
	async suggestTags(item, topK = 5, similarItemCount = 10) {
		// Find similar items
		let similarItems = await this.findSimilarItems(item, similarItemCount);
		
		console.log("Similar items: ", similarItems.map(x => ({ id: x.item.id, title: x.item.getDisplayTitle() })));
		if (!similarItems.length) {
			return [];
		}
		
		// Get existing tags on the item to exclude them
		let existingTags = new Set(item.getTags().map(t => t.tag));
		
		// Aggregate tags from similar items, weighted by similarity
		let tagScores = new Map();
		
		for (let { item: similarItem, similarity } of similarItems) {
			let tags = similarItem.getTags();
			
			for (let tagObj of tags) {
				let tag = tagObj.tag;
				
				// Skip tags already on the item
				if (existingTags.has(tag)) {
					continue;
				}
				
				// Add weighted score (similarity acts as weight)
				let currentScore = tagScores.get(tag) || 0;
				tagScores.set(tag, currentScore + similarity);
			}
		}
		
		// Return top K
		let suggestions = Array.from(tagScores.entries())
			.map(([tag, score]) => ({ tag, score }))
			.slice(0, topK);
		
		Zotero.debug(`Embeddings: Suggested ${suggestions.length} tags for item ${item.id}`);
		
		return suggestions;
	},
	
	/**
	 * Clear all embeddings
	 */
	clear() {
		this._embeddings.clear();
		this._populated = false;
		Zotero.debug('Embeddings: Cache cleared');
	},
	
	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			populated: this._populated,
			itemCount: this._embeddings.size,
			model: this._model
		};
	}
};
