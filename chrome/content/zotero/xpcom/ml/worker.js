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

/* global self, importScripts */

let initialized = false;
let transformers = null;
let pipelines = new Map();

/**
 * Initialize transformers.js in worker context
 */
async function init() {
	if (initialized) return;
	
	// Dynamically import transformers.js
	transformers = await import('resource://zotero/transformers.js');
	
	// Configure environment
	transformers.env.useBrowserCache = false;
	transformers.env.allowRemoteModels = false;
	transformers.env.allowLocalModels = true;
	transformers.env.backends.onnx.wasm.wasmPaths = 'resource://zotero/onnx-runtime/';
	transformers.env.localModelPath = 'resource://zotero/models/';
	
	initialized = true;
}

/**
 * Get or create a pipeline
 */
async function getPipeline(task, model) {
	await init();
	
	let key = `${task}:${model || 'default'}`;
	if (pipelines.has(key)) {
		return pipelines.get(key);
	}
	
	let pipeline = await transformers.pipeline(task, model);
	pipelines.set(key, pipeline);
	return pipeline;
}

/**
 * Run inference with specified task, input, and model
 */
async function runInference(task, input, model, options = {}) {
	let pipeline = await getPipeline(task, model);
	let result = await pipeline(input);
	if (task === 'feature-extraction') {
		return {
			data: Array.from(result.data),
			dims: result.dims,
			type: result.type
		};
	}
	return result;
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
	let message = event.data;
	let { id, action, data } = message;
	
	try {
		let respData = null;
		
		if (action === 'runInference') {
			let { task, input, model, options } = data;
			respData = await runInference(task, input, model, options);
		}
		
		self.postMessage({ responseID: id, data: respData });
	}
	catch (error) {
		self.postMessage({
			responseID: id,
			error: {
				name: error.name,
				message: error.message,
				stack: error.stack
			}
		});
	}
});

self.addEventListener('error', (event) => {
	console.error(`ML Worker error: ${event.message}`);
});
