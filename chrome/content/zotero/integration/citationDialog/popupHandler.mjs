var { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

// Handle the logic of opening popups and saving/discarding edits to the citaiton items
export class CitationDialogPopupsHandler {
	constructor({ doc, Helpers, findItemForBubble, deleteBubbleNode }) {
		this.doc = doc;
		this.Helpers = Helpers;
		this.findItemForBubble = findItemForBubble;
		this.deleteBubbleNode = deleteBubbleNode;

		this.detailsOfBubble = null;
		this.discardItemDetailsEdits = false;
		this.focusBubbleOnClose = false;

		this.setupListeners();
	}

	setupListeners() {
		// Display overlay when a panel appears
		this.doc.addEventListener("popuphidden", (event) => {
			if (event.target.tagName !== "xul:panel") return;
			this._getNode(".overlay").hidden = true;
		});
		this.doc.addEventListener("popupshown", (event) => {
			// make sure overlay doesn't appear on tooltips and etc.
			if (event.target.tagName !== "xul:panel") return;
			this._getNode(".overlay").hidden = false;
			// focus specified target
			let potentialFocusTarget = event.target.getAttribute("focus-target-id");
			if (potentialFocusTarget) {
				this.doc.getElementById(potentialFocusTarget).focus();
			}
			// if there was no focus target, just tab into the panel
			if (!event.target.contains(this.doc.activeElement)) {
				Services.focus.moveFocus(this.doc.defaultView, event.target, Services.focus.MOVEFOCUS_FORWARD, 0);
			}
		});

		this._getNode("#settings-button").addEventListener("click", this.openSettings.bind(this));
		this._getNode("#itemDetails").addEventListener("popuphidden", this.handleItemDetailsClosure.bind(this));
		// Item details Remove btn
		this._getNode("#itemDetails .remove").addEventListener("click", (_) => {
			this.deleteBubbleNode(this.detailsOfBubble);
			this.discardItemDetailsEdits = true;
			this._getNode("#itemDetails").hidePopup();
		});
		// Item details Show in Library btn
		this._getNode("#itemDetails .show").addEventListener("click", (_) => {
			let item = this.findItemForBubble(this.detailsOfBubble);
			this.discardItemDetailsEdits = true;
			this._getNode("#itemDetails").hidePopup();
			Zotero.Utilities.Internal.showInLibrary(item.id);
		});
		this._getNode("#itemDetails .done").addEventListener("click", (_) => {
			this._getNode("#itemDetails").hidePopup();
		});
		

		// Capture the keydown on the document to be able to handle Escape
		// when a popup is opened to discard edits
		this.doc.addEventListener("keydown", (event) => {
			if (this._getNode("#itemDetails").state !== "open") return;
			this.captureItemDetailsKeyDown(event);
		}, true);
		// Handle remaining keypress events with a usual bubbling listener
		this._getNode("#itemDetails").addEventListener("keypress", this.handleItemDetailsKeyPress.bind(this));
	}

	openItemDetails(bubble) {
		let bubbleRect = bubble.getBoundingClientRect();
		let popup = this._getNode("#itemDetails");
		popup.openPopup(bubble, "after_start", bubble.clientWidth / 2, 0, false, false, null);
		// popup should be cenetered on the bubble
		popup.style.left = `${Math.max(10, bubbleRect.left + (bubbleRect.width / 2) - (popup.offsetWidth / 2))}px`;
		popup.style.top = `${bubbleRect.bottom + 10}px`;

		// add locator labels if they don't exist yet
		if (this._getNode("#label").childElementCount == 0) {
			let locators = Zotero.Cite.labels;
			for (var locator of locators) {
				let locatorLabel = Zotero.Cite.getLocatorString(locator);
				var option = this.doc.createElement("option");
				option.value = locator;
				option.label = locatorLabel;
				this._getNode("#label").appendChild(option);
			}
		}

		let citationItem = this.findItemForBubble(bubble);
		let item = this.Helpers.citationItemToZoteroItem(citationItem);
		// Add header and fill inputs with their values
		let description = this.Helpers.buildItemDescription(item);
		this._getNode("#itemDetails").querySelector(".description")?.remove();
		this._getNode("#itemTitle").textContent = item.getDisplayTitle();
		this._getNode("#itemTitle").after(description);
		let dataTypeLabel = item.getItemTypeIconName(true);
		this._getNode("#itemDetails").querySelector(".icon").setAttribute("data-item-type", dataTypeLabel);

		this._getNode("#label").value = citationItem.label || "page";
		this._getNode("#locator").value = citationItem.locator || "";
		this._getNode("#prefix").value = citationItem.prefix || "";
		this._getNode("#suffix").value = citationItem.suffix || "";
		this._getNode("#suppress-author").checked = !!citationItem["suppress-author"];
		// Record that the popup is open for this bubble
		this.detailsOfBubble = bubble;
		bubble.classList.add("showingDetails");
	}

	// When item details popup is closed, sync it's data to citationItems
	handleItemDetailsClosure() {
		this.detailsOfBubble.classList.remove("showingDetails");
		if (this.focusBubbleOnClose) {
			this.focusBubbleOnClose = false;
			this.detailsOfBubble.focus();
		}
		else {
			this._getNode("#bubble-input").refocusInput();
		}
		if (this.discardItemDetailsEdits) {
			this.discardItemDetailsEdits = false;
			return;
		}
		let item = this.findItemForBubble(this.detailsOfBubble);

		item.label = this._getNode("#locator").value ? this._getNode("#label").value : null;
		item.locator = this._getNode("#locator").value;
		item.prefix = this._getNode("#prefix").value;
		item.suffix = this._getNode("#suffix").value;
		item["suppress-author"] = this._getNode("#suppress-author").checked;
		
		this.detailsOfBubble.textContent = this.Helpers.buildBubbleString(item);
	}

	captureItemDetailsKeyDown(event) {
		if (event.key == "Escape") {
			this.discardItemDetailsEdits = true;
			event.stopPropagation();
			event.preventDefault();
		}
	}

	handleItemDetailsKeyPress(event) {
		if (event.key == "ArrowUp" || event.key == "Enter") {
			this.focusBubbleOnClose = event.key == "ArrowUp";
			this._getNode("#itemDetails").hidePopup();
		}
	}

	openSettings() {
		let button = this._getNode("#settings-button");
		this._getNode("#settingsPopup").openPopup(button, "after_start", button.clientWidth / 2, 0, false, false, null);
	}

	openedPopup() {
		return [...this.doc.querySelectorAll("panel")].find(panel => panel.state == "open");
	}

	_getNode(selector) {
		return this.doc.querySelector(selector);
	}
}
