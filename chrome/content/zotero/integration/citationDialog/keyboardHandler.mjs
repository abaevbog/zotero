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

var { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

// Keyboard handler for citationDialog
export class CitationDialogKeyboardHandler {
	constructor({ doc }) {
		this.doc = doc;
		this._multiselectStart = null;
	}

	_id(id) {
		return this.doc.getElementById(id);
	}

	// main keydown listener that will call more specific handlers
	// until the event is handled
	handleKeypress(event) {
		let handled = this.handleTopLevelKeypress(event);
		if (!handled) {
			handled = this.handleKeyboardNavigation(event);
		}
	}

	handleTopLevelKeypress(event) {
		let handled = false;
		// Shift-Enter will always accept the existing dialog's state
		if (event.key == "Enter" && event.shiftKey) {
			handled = true;
			this.doc.dispatchEvent(new CustomEvent("dialog-accepted"));
		}
		else if (event.key == "Escape") {
			handled = true;
			this.doc.dispatchEvent(new CustomEvent("dialog-cancelled"));
		}
		// Unhandled Enter or Space triggers a click
		else if ((event.key == "Enter" || event.key == " ")) {
			let isButton = event.target.tagName == "button";
			let isCheckbox = event.target.getAttribute("type") == "checkbox";
			let inInput = event.target.tagName == "input";
			if (!(isButton || isCheckbox || inInput)) {
				event.target.click();
				handled = true;
			}
		}
		if (handled) {
			event.preventDefault();
			event.stopPropagation();
		}
		return handled;
	}

	handleKeyboardNavigation(event) {
		let handled = false;
		let noModifiers = !['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].some(key => event[key]);
		let onlyShiftModifierPossible = !['ctrlKey', 'metaKey', 'altKey'].some(key => event[key]);
		if (event.key == "Tab") {
			handled = this.tabToGroup({ forward: !event.shiftKey });
		}
		else if (event.key == "ArrowDown" && this._id("bubble-input").contains(event.target) && noModifiers) {
			// arrowDown from bubbleInput moves focus to the first item
			this.doc.querySelector(".item")?.focus();
			handled = true;
		}
		else if (event.key == "ArrowUp" && this.shouldRefocusBubbleInputOnArrowUp() && noModifiers) {
			// arrowUp from the first item will refocus bubbleInput
			this._id("bubble-input").refocusInput();
			handled = true;
		}
		else if (event.key.includes("Arrow") && onlyShiftModifierPossible) {
			// handle focus movement within a group with arrow left/right or up/down
			let arrowDirection = event.target.closest("[data-arrow-nav]")?.getAttribute("data-arrow-nav");
			let isMultiselectable = !!event.target.closest("[data-multiselectable]");
			// This determines if something is multiselectable
			if (!arrowDirection) return false;
			if (arrowDirection == "horizontal") {
				if (!(event.key === Zotero.arrowNextKey || event.key === Zotero.arrowPreviousKey)) return false;
				handled = this.moveWithinGroup(event.key == Zotero.arrowNextKey);
			}
			if (arrowDirection == "vertical") {
				if (!(event.key == "ArrowUp" || event.key === "ArrowDown")) return false;
				handled = this.moveWithinGroup(event.key === "ArrowDown", isMultiselectable && event.shiftKey);
			}
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
		return handled;
	}

	tabToGroup({ forward = true }) {
		let active = this.doc.activeElement;
		let currentGroup = active.closest("[data-tabstop]");
		if (!currentGroup) return false;
		let allGroups = [...this.doc.querySelectorAll("[data-tabstop]")];
		allGroups = allGroups.filter(group => !group.closest("[hidden]") && !group.disabled);
		let nextGroupIndex = null;
		for (let i = 0; i < allGroups.length; i++) {
			if (allGroups[i] == currentGroup) {
				nextGroupIndex = forward ? (i + 1) : (i - 1);
				break;
			}
		}
		if (nextGroupIndex === null) return false;
		if (nextGroupIndex < 0) nextGroupIndex = allGroups.length - 1;
		if (nextGroupIndex > allGroups.length - 1) nextGroupIndex = 0;
		let nextGroup = allGroups[nextGroupIndex];
		// try to focus on the next group itself (only if it is marked with tabindex).
		// tabindex accounts for scrollable containers that become unnecessarily focusable
		if (nextGroup.getAttribute("tabindex")) {
			nextGroup.focus();
			return nextGroup;
		}
		let firstFocusable = nextGroup.querySelector("[tabindex]");
		firstFocusable?.focus();
		return firstFocusable;
	}

	moveWithinGroup(forward, multiSelect) {
		let active = this.doc.activeElement;
		let currentGroup = active.closest("[data-tabstop]");
		if (!currentGroup) return false;
		let allFocusableWithinGroup = [...currentGroup.querySelectorAll("[tabindex]")];
		allFocusableWithinGroup = allFocusableWithinGroup.filter(focusable => focusable.closest("[data-tabstop]") === currentGroup);
		let nextFocusableIndex = null;
		for (let i = 0; i < allFocusableWithinGroup.length; i++) {
			if (allFocusableWithinGroup[i] == active) {
				nextFocusableIndex = forward ? (i + 1) : (i - 1);
				break;
			}
		}
		if (nextFocusableIndex === null || nextFocusableIndex < 0 || nextFocusableIndex >= allFocusableWithinGroup.length) return false;
		let nextNode = allFocusableWithinGroup[nextFocusableIndex];
		nextNode.focus();

		if (multiSelect) {
			// on arrow keypressees while holding shift, move focus and also perform multiselect
			if (this._multiselectStart === null) {
				this._multiselectStart = active;
			}
			this.rangeSelect(allFocusableWithinGroup, this._multiselectStart, nextNode);
		}
		else {
			// on arrow keypress without shift, clear multiselect starting point
			this._multiselectStart = null;
			this.rangeSelect(allFocusableWithinGroup, null);
		}

		return nextNode;
	}


	// select all items between startNode and endNode
	rangeSelect(allNodes, startNode, endNode) {
		for (let node of allNodes) {
			node.classList.remove("selected");
		}
		if (startNode === null) return;

		let startIndex = allNodes.indexOf(startNode);
		let endIndex = allNodes.indexOf(endNode);

		// if startIndex is after endIndex, just swap them
		if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

		for (let i = startIndex; i <= endIndex; i++) {
			allNodes[i].classList.add("selected");
		}
	}


	shouldRefocusBubbleInputOnArrowUp() {
		if (!this._id("library-layout").hidden) {
			return this._id("library-other-items").contains(this.doc.activeElement);
		}
		if (!this._id("list-layout").hidden) {
			return this.doc.activeElement == this.doc.querySelector(".item");
		}
		return false;
	}
}
