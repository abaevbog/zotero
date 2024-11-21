var { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");


export class CitationDialogKeyboardHandler {
	constructor({ doc }) {
		this.doc = doc;
	}

	_id(id) {
		return this.doc.getElementById(id);
	}

	handleKeypress(event) {
		let handled = this.handleTopLevelKeypress(event);
		if (!handled) {
			handled = this.handleFocusNavigation(event);
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

	handleFocusNavigation(event) {
		let handled = false;
		let noModifiers = !['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].some(key => event[key]);
		if (event.key == "Tab") {
			handled = this.tabToGroup(!event.shiftKey);
		}
		else if (event.key == "ArrowDown" && this._id("bubble-input").contains(event.target) && noModifiers) {
			this.doc.querySelector(".item").focus();
			handled = true;
		}
		else if (event.key == "ArrowUp" && this.shouldRefocusBubbleInputOnArrowUp() && noModifiers) {
			this._id("bubble-input").refocusInput();
			handled = true;
		}
		else if (event.key.includes("Arrow") && noModifiers) {
			let arrowDirection = event.target.closest("[data-arrow-nav]")?.getAttribute("data-arrow-nav");
			if (!arrowDirection) return false;
			if (arrowDirection == "horizontal") {
				if (!(event.key === Zotero.arrowNextKey || event.key === Zotero.arrowPreviousKey)) return false;
				handled = this.moveWithinGroup(event.key == Zotero.arrowNextKey);
			}
			if (arrowDirection == "vertical") {
				if (!(event.key == "ArrowUp" || event.key === "ArrowDown")) return false;
				handled = this.moveWithinGroup(event.key === "ArrowDown");
			}
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
		return handled;
	}

	tabToGroup(forward = true) {
		let active = this.doc.activeElement;
		let currentGroup = active.closest("[data-tabstop]");
		if (!currentGroup) return false;
		let allGroups = [...this.doc.querySelectorAll("[data-tabstop]")];
		allGroups = allGroups.filter(group => !group.closest("[hidden]"));
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
		if (nextGroup.getAttribute("tabindex")) {
			nextGroup.focus();
			return nextGroup;
		}
		let firstFocusable = nextGroup.querySelector("[tabindex]");
		firstFocusable.focus();
		return firstFocusable;
	}

	moveWithinGroup(forward) {
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
}
