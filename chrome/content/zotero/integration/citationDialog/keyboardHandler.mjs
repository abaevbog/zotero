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
	handleKeydown(event) {
		let handled = this.handleTopLevelKeydown(event);
		if (!handled) {
			handled = this.handleKeyboardNavigation(event);
		}
	}

	handleTopLevelKeydown(event) {
		let handled = false;
		let tgt = event.target;
		let isKeyboardClickable = tgt.classList.contains("keyboard-clickable") || tgt.tagName.includes("button");
		// Space/Enter will click on a button or keyboard-clickable components
		if (["Enter", " "].includes(event.key) && isKeyboardClickable) {
			tgt.click();
			handled = true;
		}
		// Unhandled Enter will accept the existing dialog's state
		else if (event.key == "Enter" && !tgt.closest("panel")) {
			handled = true;
			this.doc.dispatchEvent(new CustomEvent("dialog-accepted"));
		}
		// Unhandled Escape will close the dialog
		else if (event.key == "Escape") {
			handled = true;
			this.doc.dispatchEvent(new CustomEvent("dialog-cancelled"));
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
		// arrow down from bubble input in library mode will focus the current item, if any
		// or navigate into the suggested items group. If the suggested items are empty, focus items table below
		else if (!this._id("library-layout").hidden && event.key == "ArrowDown" && this._id("bubble-input").contains(event.target) && noModifiers) {
			let group = this.doc.querySelector("#library-layout [data-arrow-nav]");
			let current = group.querySelector(".selected.current");
			if (current) {
				current.focus();
			}
			else if (!group.hidden) {
				this.navigateGroup({ group, current: null, forward: true, shouldSelect: true, shouldFocus: true, multiSelect: false });
			}
			else {
				this._id("zotero-items-tree").querySelector("[tabindex]").focus();
			}
			handled = true;
		}
		// arrow down from suggested items in library mode will focus items table
		else if (!this._id("library-layout").hidden && event.key == "ArrowDown" && event.target.closest(".itemsContainer") && noModifiers) {
			this._id("zotero-items-tree").querySelector("[tabindex]").focus();
		}
		// arrow up/down from bubble-input in list mode will move selection in the items list
		else if (!this._id("list-layout").hidden && (event.key == "ArrowDown" || event.key == "ArrowUp") && this._id("bubble-input").contains(event.target) && onlyShiftModifierPossible) {
			let group = this.doc.querySelector("#list-layout [data-arrow-nav]");
			let current = group.querySelector(".current");
			let firstRow = group.querySelector('[data-arrow-nav-enabled="true"][tabindex]');
			// on arrowUp from the first row, clear selection
			if (current === firstRow && event.key == "ArrowUp") {
				this.selectItems(null);
				firstRow.classList.remove("current");
				group.scrollTo(0, 0);
			}
			else if (current || event.key == "ArrowDown") {
				// Arrow down from input will just change the selected item without moving focus
				// Arrow down from a bubble in the lowest row will move focus
				let shouldFocus = event.target.classList.contains("bubble");
				this.navigateGroup({ group, current, forward: event.key == "ArrowDown", shouldSelect: true, shouldFocus, multiSelect: event.shiftKey });
			}
			handled = true;
		}
		// arrowUp from the first item will refocus bubbleInput
		else if (event.key == "ArrowUp" && this.shouldRefocusBubbleInputOnArrowUp() && noModifiers) {
			this._id("bubble-input").refocusInput();
			handled = true;
		}
		// handle handle focus and selection movement within bubble-input and item groups
		else if (event.key.includes("Arrow") && onlyShiftModifierPossible) {
			let arrowDirection = event.target.closest("[data-arrow-nav]")?.getAttribute("data-arrow-nav");
			if (!arrowDirection) return false;
			let multiSelect = !!event.target.closest("[data-multiselectable]") && event.shiftKey;
			let current = this.doc.activeElement;
			let group = current.closest("[data-arrow-nav]");
			if (arrowDirection == "horizontal") {
				if (!(event.key === Zotero.arrowNextKey || event.key === Zotero.arrowPreviousKey)) return false;
				let shouldSelect = !this._id("bubble-input").contains(event.target); // selections only apply to items, not bubbles
				handled = this.navigateGroup({ group, current, forward: event.key == Zotero.arrowNextKey, shouldSelect, shouldFocus: true, multiSelect });
			}
			if (arrowDirection == "vertical") {
				if (!(event.key == "ArrowUp" || event.key === "ArrowDown")) return false;
				handled = this.navigateGroup({ group, current, forward: event.key === "ArrowDown", shouldSelect: true, shouldFocus: true, multiSelect });
			}
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
		return handled;
	}

	tabToGroup({ forward = true, startingTabIndex = null }) {
		let currentTabIndex = startingTabIndex;
		if (currentTabIndex === null) {
			let active = this.doc.activeElement;
			let tabindexNode = active.closest("[data-tabindex]");
			if (!tabindexNode) return false;
			currentTabIndex = parseInt(tabindexNode.dataset.tabindex);
		}
		let tabIndexedNodes = [...this.doc.querySelectorAll("[data-tabindex]")];
		tabIndexedNodes = tabIndexedNodes.filter(node => (node.getAttribute("tabindex") || node.querySelector("[tabindex]")) && !node.closest("[hidden]") && !node.disabled);
		tabIndexedNodes = tabIndexedNodes.sort((a, b) => {
			if (a.dataset.tabindex == b.dataset.tabindex) {
				// make sure that if there's a "current" node, it will have priority
				let aSelected = a.classList.contains("current") ? -1 : 0;
				let bSelected = b.classList.contains("current") ? -1 : 0;
				return aSelected - bSelected;
			}
			if (forward) {
				return parseInt(a.dataset.tabindex) - parseInt(b.dataset.tabindex);
			}
			return parseInt(b.dataset.tabindex) - parseInt(a.dataset.tabindex);
		});
		let nodeToFocus;
		for (let node of tabIndexedNodes) {
			let tabIndex = parseInt(node.dataset.tabindex);
			if ((forward && tabIndex > currentTabIndex) || (!forward && tabIndex < currentTabIndex)) {
				nodeToFocus = node;
				break;
			}
		}
		if (!nodeToFocus && startingTabIndex === null) {
			tabIndexedNodes[0].focus();
			return tabIndexedNodes[0];
		}

		// if node to focus is a part of arrow-navigation group (e.g. suggested items)
		// and we are not re-focusing a previously selected item,
		// navigate into that group to also have the item marked as selected.
		if (nodeToFocus.dataset.arrowNavEnabled && !nodeToFocus.classList.contains("current")) {
			let group = nodeToFocus.closest("[data-arrow-nav]");
			this.navigateGroup({ group, current: null, forward: true, shouldSelect: true, shouldFocus: true, multiSelect: false });
		}
		else if (nodeToFocus.getAttribute("tabindex")) {
			nodeToFocus.focus();
		}
		else {
			nodeToFocus.querySelector("[tabindex]")?.focus();
		}
		return nodeToFocus;
	}


	// Navigate the group by moving selection or focus between nodes in a group
	navigateGroup({ group, current, forward, multiSelect, shouldFocus, shouldSelect }) {
		// navigatable nodes have to be marked with data-arrow-nav-enabled
		let allFocusableWithinGroup = [...group.querySelectorAll("[tabindex][data-arrow-nav-enabled]")];
		let nextFocusableIndex = 0;
		for (let i = 0; i < allFocusableWithinGroup.length; i++) {
			if (allFocusableWithinGroup[i] == current) {
				nextFocusableIndex = forward ? (i + 1) : (i - 1);
				break;
			}
		}
		if (nextFocusableIndex < 0 || nextFocusableIndex >= allFocusableWithinGroup.length) return false;
		let nextNode = allFocusableWithinGroup[nextFocusableIndex];
		if (shouldFocus) {
			nextNode.focus();
		}
		if (!shouldSelect) return nextNode;
		
		current?.classList.remove("current");
		nextNode.classList.add("current");
		this.doc.querySelector("#bubble-input").ariaSetCurrentItem(nextNode.id);
		// if the node is not being focused in list mode, make sure we scroll to it so it is visible
		if (!shouldFocus) {
			let wrapperRect = this._id("list-layout-wrapper").getBoundingClientRect();
			let nodeRect = nextNode.getBoundingClientRect();
			if (nodeRect.bottom > wrapperRect.bottom || nodeRect.top < wrapperRect.top) {
				nextNode.scrollIntoView();
			}
		}
		
		if (multiSelect) {
			// on arrow keypressees while holding shift, move focus and also perform multiselect
			if (this._multiselectStart === null || !this.doc.contains(this._multiselectStart)) {
				this._multiselectStart = current || nextNode;
			}
			this.selectItems(this._multiselectStart, nextNode);
		}
		else {
			// on arrow keypress without shift, clear multiselect starting point
			this._multiselectStart = null;
			this.selectItems(nextNode);
		}
		
		return nextNode;
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

	captureKeydown(event) {
		// Shift-Enter will always accept the dialog regardless of the target (unless within a panel)
		if (event.key == "Enter" && event.shiftKey && !event.target.closest("panel")) {
			this.doc.dispatchEvent(new CustomEvent("dialog-accepted"));
			event.stopPropagation();
			event.preventDefault();
			return;
		}
		let noModifiers = !['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].some(key => event[key]);
		if (this._id("zotero-items-tree").contains(event.target) && event.key == "ArrowUp" && noModifiers) {
			let focusedRow = this._id("zotero-items-tree").querySelector(".row.focused");
			if (!focusedRow) return;
			// fetch index from the row's id (e.g. item-tree-citationDialog-row-0)
			let rowIndex = focusedRow.id.split("-")[4];
			if (rowIndex !== "0") return;
			if (!this._id("library-other-items").hidden) {
				let current = this.doc.querySelector(".selected.current");
				if (current) {
					current.focus();
				}
				else {
					this.navigateGroup({ group: this._id("library-other-items"), current: null, forward: true, shouldSelect: true, shouldFocus: true, multiSelect: false });
				}
			}
			else {
				this._id("bubble-input").focus();
			}
			event.stopPropagation();
			event.preventDefault();
		}
	}

	selectItems(startNode, endNode) {
		this.doc.dispatchEvent(new CustomEvent("select-items", {
			bubbles: true,
			detail: {
				startNode, endNode
			}
		}));
	}
}
