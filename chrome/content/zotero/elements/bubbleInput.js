/*
	***** BEGIN LICENSE BLOCK *****
	
    Copyright © 2024 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
					http://zotero.org
	
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

"use strict";

{
	class BubbleInput extends XULElementBase {
		content = MozXULElement.parseXULToFragment(`
			<html:div xmlns:html="http://www.w3.org/1999/xhtml" flex="1" spellcheck="false" class="bubble-input body" role="application">
			</html:div>
		`);

		init() {
			this._body = this.querySelector('.bubble-input.body');
			this._body.addEventListener('click', this._onBodyClick.bind(this));
			Utils.init(this);
			DragDropHandler.init(this);
		}
		
		_onBodyClick(event) {
			if (event.target !== this._body) {
				return;
			}
			let clickX = event.clientX;
			let clickY = event.clientY;
			let lastBubble = Utils.getLastBubbleBeforePoint(clickX, clickY);
			// If click happened right before another input, focus that input
			// instead of adding another one.
			let nextNode = lastBubble ? lastBubble.nextElementSibling : this._body.firstChild;
			if (this._isInput(nextNode)) {
				nextNode.focus();
				return;
			}
			
			let newInput = this._createInputElem();
			if (lastBubble !== null) {
				lastBubble.after(newInput);
			}
			else {
				this._body.prepend(newInput);
			}
			newInput.focus();
		}

		_onBubblePress(event) {
			let bubble = event.target;
			// if (accepted) return;
			if (event.key == "ArrowDown" || event.key == " ") {
				// On arrow down or whitespace, open new citation properties panel
				Utils.notifyDialog("bubble-popup-show", { bubble });
				event.preventDefault();
				event.stopPropagation();
			}
			else if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				let newInput = this._createInputElem();
				
				if (event.key === Zotero.arrowPreviousKey) {
					if (this._isInput(bubble.previousElementSibling)) {
						this._moveFocusBack(bubble);
					}
					else {
						bubble.before(newInput);
						newInput.focus();
					}
				}
				else if (event.key === Zotero.arrowNextKey) {
					if (this._isInput(bubble.nextElementSibling)) {
						this._moveFocusForward(bubble);
					}
					else {
						bubble.after(newInput);
						newInput.focus();
					}
				}
			}
			else if (["ArrowLeft", "ArrowRight"].includes(event.key) && event.shiftKey) {
				// On Shift-Left/Right swap focused bubble with it's neighbor
				event.preventDefault();
				let findNextBubble = () => {
					let node = event.target;
					do {
						node = event.key == Zotero.arrowPreviousKey ? node.previousElementSibling : node.nextElementSibling;
					} while (node && !(node.classList.contains("bubble") || node.classList.contains("input")));
					return node;
				};
				let nextBubble = findNextBubble();
				if (nextBubble) {
					let nextBubbleIndex = [...this._body.querySelectorAll(".bubble")].findIndex(bubble => bubble == nextBubble);
					if (event.key === Zotero.arrowPreviousKey) {
						nextBubble.before(bubble);
					}
					else {
						nextBubble.after(bubble);
					}
					Utils.notifyDialog('bubble-moved', { bubble, index: nextBubbleIndex });
				}
				
				bubble.focus();
			}
			else if (["Backspace", "Delete"].includes(event.key)) {
				event.preventDefault();
				if (!this._moveFocusBack(bubble)) {
					this._moveFocusForward(bubble);
				}
				this._deleteBubble(bubble);
				// If all bubbles are removed, add and focus an input
				if (this.getAllBubbles().length == 0) {
					this.refocusInput();
				}
			}
			else if (Utils.isKeypressPrintable(event) && event.key !== " ") {
				event.preventDefault();
				let input = this.refocusInput();
				// Typing when you are focused on the bubble will re-focus the last input
				input.value += event.key;
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}
		}
		
		convertInputToBubble(text) {
			const input = this.getCurrentInput();
			text = text || input.value;
			const bubble = this._createBubble(text);
			if (input) {
				input.before(bubble);
				input.remove();
			}
			else {
				this._body.append(bubble);
			}
			return bubble;
		}
		
		_createBubble(str) {
			let bubble = document.createElement("div");
			bubble.setAttribute("draggable", "true");
			bubble.setAttribute("role", "button");
			bubble.setAttribute("tabindex", "0");
			bubble.setAttribute("aria-describedby", "bubble-description");
			bubble.setAttribute("aria-haspopup", true);
			bubble.className = "bubble";
			// VoiceOver works better without it
			if (!Zotero.isMac) {
				bubble.setAttribute("aria-label", str);
			}
			bubble.addEventListener("click", () => Utils.notifyDialog("bubble-popup-show", { bubble }));
			bubble.addEventListener("keypress", this._onBubblePress.bind(this));
			let text = document.createElement("span");
			text.textContent = str;
			text.className = "text";
			bubble.append(text);
			
			let cross = document.createElement("div");
			cross.className = "cross";
			cross.addEventListener("click", (event) => {
				this._deleteBubble(bubble);
				event.stopPropagation();
			});
			cross.addEventListener("keydown", (e) => {
				if (e.target === cross && e.key === "Enter") {
					this._deleteBubble(bubble);
				}
			});
			bubble.append(cross);
			
			return bubble;
		}

		// Delete the bubble and merge any adjacent inputs
		_deleteBubble(bubble) {
			Utils.notifyDialog('bubble-deleted', { bubble });
			this._combineNeighboringInputs();
		}
		
		_isInput(node) {
			if (!node) return false;
			return node.tagName === "input";
		}
		
		// Determine if the input is empty
		_isInputEmpty(input) {
			if (!input) {
				return true;
			}
			return input.value.length == 0;
		}
		
		getCurrentInput() {
			if (this._isInput(document.activeElement)) {
				return document.activeElement;
			}
			if (this._lastFocusedInput && this.contains(this._lastFocusedInput)) {
				return this._lastFocusedInput;
			}
			return false;
		}

		isEmpty() {
			return this._body.childElementCount == 1 && this._isInput(this._body.firstChild);
		}
		
		_getContentWidth(input) {
			let span = document.createElement("span");
			span.classList = "input";
			span.innerText = input.value;
			this._body.appendChild(span);
			let spanWidth = span.getBoundingClientRect().width;
			span.remove();
			return spanWidth + 2;
		}

		_createInputElem() {
			let input = document.createElement('input');
			input.className = "input";
			input.setAttribute("aria-describedby", "input-description");
			input.addEventListener("input", (_) => {
				// Expand/shrink the input field to match the width of content
				let width = this._getContentWidth(input);
				input.style.width = width + 'px';
				Utils.notifyDialog("run-search", { query: input.value, debounce: true });
			});
			input.addEventListener("keypress", e => this._onInputKeypress(input, e));
			input.addEventListener("focus", (_) => {
				// Should we run the search only if the input is non-empty?
				Utils.notifyDialog("run-search", { query: input.value, debounce: false });
			});
			input.addEventListener("blur", async (event) => {
				// delete blurred empty input
				if (this._isInputEmpty(input) && (!event.relatedTarget || this.contains(event.relatedTarget))) {
					input.remove();
				}
				// reecord this input as last focused it it's not empty OR if the focus left bubbleInput altogether
				else if (!this._isInputEmpty(input) || !this.contains(event.relatedTarget)) {
					this._lastFocusedInput = input;
				}
			});
			return input;
		}
		
		// Return the focus to the input.
		// If tryLastFocused=true, try to focus on the last active input first.
		// Then, try to focus the last input from the editor.
		// If there are no inputs, append one to the end and focus that.
		refocusInput(tryLastFocused = true) {
			let input = tryLastFocused ? this.getCurrentInput() : null;
			if (!input) {
				let allInputs = this._body.querySelectorAll(".input");
				if (allInputs.length > 0) {
					input = allInputs[allInputs.length - 1];
				}
			}
			if (!input) {
				input = this._createInputElem();
				this._body.appendChild(input);
			}
			setTimeout(() => {
				input.focus();
				input.setSelectionRange(input.value.length, input.value.length);
			});
			return input;
		}
		
		_onInputKeypress(input, event) {
			if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.shiftKey) {
				// On arrow left from the beginning of the input, move to previous bubble
				if (event.key === "ArrowLeft" && input.selectionStart === 0) {
					this._moveFocusBack(input);
					event.preventDefault();
					event.stopPropagation();
				}
				// On arrow right from the end of the input, move to next bubble
				else if (event.key === "ArrowRight" && input.selectionStart === input.value.length) {
					this._moveFocusForward(input);
					event.preventDefault();
					event.stopPropagation();
				}
			}
			else if (["Backspace", "Delete"].includes(event.key)
				&& (input.selectionStart + input.selectionEnd) === 0) {
				event.preventDefault();
				// Backspace/Delete from the beginning of an input will delete the previous bubble.
				// If there are two inputs next to each other as a result, they are merged
				if (input.previousElementSibling) {
					this._deleteBubble(input.previousElementSibling);
				}
			}
		}

		_moveFocusForward(node) {
			if (node.nextElementSibling?.focus) {
				node.nextElementSibling.focus();
				return true;
			}
			return false;
		}

		_moveFocusBack(node) {
			if (node.previousElementSibling?.focus) {
				node.previousElementSibling.focus();
				return true;
			}
			return false;
		}

		// If a bubble is removed between two inputs we need to combine them
		_combineNeighboringInputs() {
			let node = this._body.firstChild;
			while (node && node.nextElementSibling) {
				if (this._isInput(node)
					&& this._isInput(node.nextElementSibling)) {
					let secondInputValue = node.nextElementSibling.value;
					node.value += ` ${secondInputValue}`;
					node.dispatchEvent(new Event('input', { bubbles: true }));
					// Make sure focus is not lost when two inputs are combined
					if (node.nextElementSibling == document.activeElement) {
						node.focus();
					}
					node.nextElementSibling.remove();
				}
				node = node.nextElementSibling;
			}
		}
	}

	const DragDropHandler = {
		init(bubbleInput) {
			this.bubbleInput = bubbleInput;
			this.dragBubble = null;
			this.dragOver = null;

			bubbleInput.addEventListener("dragstart", this.handleDragStart.bind(this));
			bubbleInput.addEventListener("dragenter", this.handleDragEnter.bind(this));
			bubbleInput.addEventListener("dragover", this.handleDragOver.bind(this));
			bubbleInput.addEventListener("drop", this.handleDrop.bind(this));
			bubbleInput.addEventListener("dragend", this.handleDragEnd.bind(this));
		},

		handleDragStart(event) {
			this.dragBubble = event.target;
			event.dataTransfer.setData("text/plain", '<span id="zotero-drag"/>');
			event.stopPropagation();
		},

		handleDragEnter(event) {
			event.preventDefault();
		},

		handleDragOver(event) {
			event.preventDefault();
			// Find the last bubble before current mouse position
			let lastBeforeDrop = Utils.getLastBubbleBeforePoint(event.clientX, event.clientY);
			// If no bubble, mouse may be at the very start of the input so use the first bubble
			if (!lastBeforeDrop) {
				lastBeforeDrop = this.getAllBubbles()[0];
			}
			
			this.dragOver?.classList.remove('drop-after', 'drop-before');
			this.dragOver = lastBeforeDrop;

			// Add indicator after or before the hovered bubble depending on mouse position
			let bubbleRect = lastBeforeDrop.getBoundingClientRect();
			let midpoint = (bubbleRect.right + bubbleRect.left) / 2;

			if (event.clientX > midpoint) {
				this.dragOver.classList.add('drop-after');
			}
			else {
				this.dragOver.classList.add('drop-before');
			}
		},

		handleDrop(event) {
			event.preventDefault();
			event.stopPropagation();
			if (!this.dragBubble || !this.dragOver) return;
			
			if (this.dragOver.classList.contains("drop-after")) {
				this.dragOver.after(this.dragBubble);
			}
			else {
				this.dragOver.before(this.dragBubble);
			}
			this.dragOver.classList.remove('drop-after', 'drop-before');

			// Tell citationDialog.js where the bubble moved
			let newIndex = [...this.bubbleInput.querySelectorAll(".bubble")].findIndex(node => node == this.dragBubble);
			Utils.notifyDialog('bubble-moved', { bubble: this.dragBubble, index: newIndex });
		},

		handleDragEnd(_) {
			this.bubbleInput.querySelector(".drop-after,.drop-before")?.classList.remove('drop-after', 'drop-before');
			this.dragBubble = null;
			this.dragOver = null;
		},
	};

	const Utils = {
		init(bubbleInput) {
			this.bubbleInput = bubbleInput;
		},

		/**
		 * Find the last bubble (lastBubble) before a given coordinate.
		 * If there is no last bubble, null is returned.
		 * Outputs for a sample of coordinates:
		 *  NULL    #1      #2          #3
		 *  ↓        ↓       ↓           ↓
		 * [ bubble_1 bubble_2 bubble_3
		 * 	  bubble_4, bubble_5          ]
		 *   ↑       ↑      ↑       ↑
		 *  #3      #4     #5      #5
		 * @param {Int} x - X coordinate
		 * @param {Int} y - Y coordinate
		 * @returns {Node} lastBubble
		 */
		getLastBubbleBeforePoint(x, y) {
			let bubbles = this.bubbleInput.querySelectorAll('.bubble');
			let lastBubble = null;
			let isClickAfterBubble = (clickX, bubbleRect) => {
				return Zotero.rtl ? clickX < bubbleRect.right : clickX > bubbleRect.left;
			};
			for (let i = 0; i < bubbles.length; i++) {
				let rect = bubbles[i].getBoundingClientRect();
				// If within the vertical range of a bubble
				if (y >= rect.top && y <= rect.bottom) {
					// If the click is to the right of a bubble, it becomes a candidate
					if (isClickAfterBubble(x, rect)) {
						lastBubble = i;
					}
					// Otherwise, stop and return the last bubble we saw if any
					else {
						if (i == 0) {
							lastBubble = null;
						}
						else {
							lastBubble = Math.max(i - 1, 0);
						}
						break;
					}
				}
			}
			if (lastBubble !== null) {
				lastBubble = bubbles[lastBubble];
			}
			return lastBubble;
		},

		notifyDialog(eventType, data = {}) {
			let event = new CustomEvent(eventType, {
				bubbles: true,
				detail: data
			});
			this.bubbleInput.dispatchEvent(event);
		},
		// Determine if keypress event is on a printable character.
		/* eslint-disable array-element-newline */
		isKeypressPrintable(event) {
			if (event.ctrlKey || event.metaKey || event.altKey) return false;
			// If it's a single character, for latin locales it has to be printable
			if (event.key.length === 1) {
				return true;
			}
			// Otherwise, check against a list of common control keys
			let nonPrintableKeys = [
				'Enter', 'Escape', 'Backspace', 'Tab',
				'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
				'Home', 'End', 'PageUp', 'PageDown',
				'Delete', 'Insert',
				'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
				'Control', 'Meta', 'Alt', 'Shift', 'CapsLock'
			];
			/* eslint-enable array-element-newline */
		
			return !nonPrintableKeys.includes(event.key);
		}
	};

	customElements.define('bubble-input', BubbleInput);
}