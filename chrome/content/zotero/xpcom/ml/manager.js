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

class MLWorker {
	constructor() {
		this._worker = null;
		this._lastPromiseID = 0;
		this._waitingPromises = {};
	}

	_init() {
		if (this._worker) return;
		this._worker = new Worker('chrome://zotero/content/xpcom/ml/worker.js', { type: 'module' });
		this._worker.addEventListener('message', (event) => {
			let message = event.data;
			if (message.responseID) {
				let { resolve, reject } = this._waitingPromises[message.responseID];
				delete this._waitingPromises[message.responseID];
				if (message.data !== undefined) {
					resolve(message.data);
				}
				else if (message.error) {
					let error = new Error(message.error.message);
					error.name = message.error.name;
					reject(error);
				}
				else {
					reject(new Error('Unknown worker response'));
				}
			}
		});
		this._worker.addEventListener('error', (event) => {
			Zotero.logError(`ML Worker error: ${event.message}`);
		});
	}

	async _query(action, data) {
		this._init();
		return new Promise((resolve, reject) => {
			this._lastPromiseID++;
			this._waitingPromises[this._lastPromiseID] = { resolve, reject };
			this._worker.postMessage({ id: this._lastPromiseID, action, data });
		});
	}

	/**
	 * Run ML inference on text input
	 *
	 * @param {String} task - The task type (e.g., 'sentiment-analysis', 'feature-extraction')
	 * @param {String|String[]} input - Input text or array of texts
	 * @param {String} [model] - Optional model identifier
	 * @returns {Promise<Object>} Inference results
	 */
	async runInference(task, input, model = null, options = {}) {
		Zotero.debug(`Running ML inference: task=${task}, model=${model || 'default'}`);
		try {
			let result = await this._query('runInference', { task, input, model, options });
			return result;
		}
		catch (error) {
			Zotero.logError(`Worker 'runInference' failed: ${error.message}`);
			throw error;
		}
	}
}

Zotero.MLWorker = new MLWorker();
