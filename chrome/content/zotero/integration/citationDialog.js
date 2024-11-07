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

var doc, io, isCitingNotes, accepted;

var currentLayout, libraryLayout, listLayout;

var Helpers, SearchHandler, PopupsHandler, KeyboardHandler;

const ITEM_LIST_MAX_ITEMS = 50;

var { CitationDialogHelpers } = ChromeUtils.importESModule('chrome://zotero/content/integration/citationDialog/helpers.mjs');
var { CitationDialogSearchHandler } = ChromeUtils.importESModule('chrome://zotero/content/integration/citationDialog/searchHandler.mjs');
var { CitationDialogPopupsHandler } = ChromeUtils.importESModule('chrome://zotero/content/integration/citationDialog/popupHandler.mjs');
var { CitationDialogKeyboardHandler } = ChromeUtils.importESModule('chrome://zotero/content/integration/citationDialog/keyboardHandler.mjs');
function onDOMContentLoaded() {
	doc = document;
	io = window.arguments[0].wrappedJSObject;
	isCitingNotes = !!io.isCitingNotes;

	Helpers = new CitationDialogHelpers({ doc, io });
	SearchHandler = new CitationDialogSearchHandler({ isCitingNotes, io, getCitationItems: () => Citation.items });
	PopupsHandler = new CitationDialogPopupsHandler({ doc, Helpers, findItemForBubble: Citation.findItemForBubble.bind(Citation), deleteBubbleNode: Citation.deleteBubbleNode.bind(Citation) });
	KeyboardHandler = new CitationDialogKeyboardHandler({ doc });

	_id("keepSorted").disabled = !io.sortable;
	_id("keepSorted").checked = io.sortable && !io.citation.properties.unsorted;

	libraryLayout = new LibraryLayout();
	listLayout = new ListLayout();

	_toggleMode();
	_id("mode-button").addEventListener("click", _toggleMode);

	// Run search and refresh items that are being displayed.
	// Can either happen immediately (e.g. on focus of an input)
	// or after a debounce (e.g. when one types)
	this.addEventListener("run-search", ({ detail }) => {
		let query = detail.query;
		// If there is a locator typed, exclude it from the query
		let locator = Helpers.fetchLocator(query);
		if (locator) {
			query = query.replace(locator.fullLocatorString, "");
		}
		if (detail.debounce) {
			currentLayout.searchDebounced(query);
		}
		else {
			currentLayout.search(query);
		}
	});
	this.addEventListener("bubble-deleted", async ({ detail }) => Citation.deleteBubbleNode(detail.bubble));
	this.addEventListener("bubble-moved", ({ detail }) => Citation.onBubbleNodeMoved(detail.bubble, detail.index));
	this.addEventListener("bubble-popup-show", ({ detail }) => PopupsHandler.openItemDetails(detail.bubble));

	doc.addEventListener("keypress", handleTopLevelKeypress);
	doc.addEventListener("keypress", event => KeyboardHandler.handleFocusNavigation(event));

	Citation.buildCitation();
}

// switch between list and library modes
function _toggleMode() {
	let mode = _id("mode-button").getAttribute("mode");
	let newMode = mode == "library" ? "list" : "library";

	_id("list-layout").hidden = newMode == "library";
	_id("library-layout").hidden = newMode == "list";

	_id("mode-button").setAttribute("mode", newMode);

	currentLayout = newMode === "library" ? libraryLayout : listLayout;
	currentLayout.refreshItemsList();
}


function accept() {
	if (accepted || SearchHandler.searching) return;
	accepted = true;
	Citation.updateCitationObject(true);
	io.accept((percent) => console.log("Percent ", percent));
}

function handleTopLevelKeypress(event) {
	if (event.key == "Enter" && event.target.classList.contains("input")) {
		let input = event.target;
		let locator = Helpers.fetchLocator(input.value);
		let bubble = input.previousElementSibling;
		if (locator && locator.onlyLocator && bubble) {
			Citation.addLocator(bubble, locator.label, locator.locator);
			input.remove();
			_id("bubble-input").refocusInput(false);
			return;
		}
		if (doc.querySelector(".first-item")) {
			doc.querySelector(".first-item").click();
		}
		else {
			accept();
		}
	}
	// Shift-Enter will always accept the existing dialog's state
	if (event.key == "Enter" && event.shiftKey) {
		event.preventDefault();
		event.stopPropagation();
		accept();
		return;
	}
	if (event.key == "Escape") {
		accepted = true;
		io.citation.citationItems = [];
		io.accept();
		window.close();
		return;
	}
	// Unhandled Enter or Space triggers a click
	if ((event.key == "Enter" || event.key == " ")) {
		let isButton = event.target.tagName == "button";
		let isCheckbox = event.target.getAttribute("type") == "checkbox";
		if (!(isButton || isCheckbox)) {
			event.target.click();
		}
	}
}

function _id(id) {
	return doc.getElementById(id);
}
function _getNode(selector) {
	return doc.querySelector(selector);
}
function _getCitationItems() {
	return Citation.items;
}


// Template for layout classes
class Layout {
	constructor(type) {
		this.type = type;
		this.selectedItemsExpanded = false;
	}

	// General logic of refreshing the items list supplemented by layouts
	async refreshItemsList() {
		let canAddNotes = ITEM_LIST_MAX_ITEMS;
		let sections = [];
		for (let { key, group, isLibrary } of SearchHandler.getOrderedSearchResultGroups(this.type == "list")) {
			if (canAddNotes <= 0) break;
			if (isLibrary && this.type == "library") break;
			let label = isLibrary ? Zotero.Libraries.get(key).name : key;
			let section = Helpers.buildItemsSection(`${this.type}-${key}-items`, label);
			let itemContainer = section.querySelector(".itemsContainer");
	
			let items = [];
			for (let item of group) {
				let grouppedSelectedItems = key == "selected" && !this.selectedItemsExpanded;
				// createItemNode implemented by layouts
				let itemNode = this.createItemNode(item, grouppedSelectedItems);
				itemNode.addEventListener("click", async () => {
					this.includeItemsIntoCitation(grouppedSelectedItems ? group : item);
				});
				items.push(itemNode);
				canAddNotes -= 1;
				if (canAddNotes <= 0) break;

				if (grouppedSelectedItems) break;
			}
			itemContainer.replaceChildren(...items);
			sections.push(section);
		}
		_id(`${this.type}-layout`).querySelector(".search-items").replaceChildren(...sections);
		this.markFirstItem();
	}

	// Implemented by layouts
	createItemNode() {}

	// Regardless of which layout we are in, we need to run the search and
	// update itemsList.
	async searchDebounced(value) {
		_id("loading-spinner").setAttribute("status", "animate");
		SearchHandler.searching = true;
		// This is called on each typed character, so refresh item list when typing stopped
		SearchHandler.refreshDebounced(value, () => {
			this.refreshItemsList();
			SearchHandler.searching = false;
			_id("loading-spinner").removeAttribute("status");
		});
	}

	async search(value) {
		_id("loading-spinner").setAttribute("status", "animate");
		SearchHandler.searching = true;
		await SearchHandler.refresh(value);
		this.refreshItemsList();
		SearchHandler.searching = false;
		_id("loading-spinner").removeAttribute("status");
	}

	async includeItemsIntoCitation(items) {
		if (accepted) return;
		if (!Array.isArray(items)) {
			items = [items];
		}
		if (isCitingNotes) {
			let item = items[0];
			if (!item.isNote()) return;
			Citation.items = items;
			accept();
			return;
		}
		// If the last input has a locator, add it into the item
		let input = _id("bubble-input").getCurrentInput();
		let locator = Helpers.fetchLocator(input.value || "");
		if (locator) {
			for (let item of items) {
				item.label = locator.label;
				item.locator = locator.locator;
			}
		}
		await Citation.addItems({ citationItems: items });
		_id("bubble-input").refocusInput();
	}

	// Mark the first matching item to be added to citation on Enter
	markFirstItem() {
		document.querySelector(".first-item")?.classList.remove("first-item");
		if (SearchHandler.lastSearchValue.length) {
			_id(`${this.type}-layout`).querySelector(".item")?.classList.add("first-item");
		}
	}

	generateAddAllSelectedItemsNode() {
		let description = Helpers.createNode("div", { tabindex: "-1", "data-tabstop": "1" }, "description hbox expand-selected");
		description.innerText = "Expand selected";
		description.addEventListener("click", (event) => {
			event.stopPropagation();
			this.selectedItemsExpanded = true;
			this.refreshItemsList();
		});
		return description;
	}
}

class LibraryLayout extends Layout {
	constructor() {
		super("library");
		this._initItemTree();
		this._initCollectionTree();
	}

	// After the search is run, library layout updates the itemsView filter
	async search(value) {
		super.search(value);
		// Make sure itemTree is fully loaded
		if (!this.itemsView?.collectionTreeRow) return;
		this.itemsView.setFilter('search', value);
	}

	async searchDebounced(value) {
		super.searchDebounced(value);
		this.itemsView?.setFilter('search', value);
	}

	createItemNode(item, isSelectedGroup) {
		let itemNode = Helpers.createNode("div", { tabindex: "-1" }, "item");

		let title = Helpers.createNode("div", {}, "title");
		let description;
		if (isSelectedGroup) {
			description = this.generateAddAllSelectedItemsNode();
		}
		else {
			description = Helpers.buildItemDescription(item);
		}
		title.textContent = item.getDisplayTitle();

		itemNode.append(title, description);
		return itemNode;
	}

	async refreshItemsList() {
		await super.refreshItemsList();
		window.resizeTo(window.innerWidth, Math.max(window.innerHeight, 400));
	}

	async _initItemTree() {
		const ItemTree = require('zotero/itemTree');
		var itemsTree = _id('zotero-items-tree');
		this.itemsView = await ItemTree.init(itemsTree, {
			id: "main",
			dragAndDrop: true,
			persistColumns: true,
			columnPicker: true,
			onSelectionChange: selection => {},
			regularOnly: !isCitingNotes,
			onActivate: (event, items) => {
				// debounec as this can fire more than once on the same double click
				this._addItemsDebounced(items);
			},
			emptyMessage: Zotero.getString('pane.items.loading')
		});
	}
	
	async _initCollectionTree() {
		const CollectionTree = require('zotero/collectionTree');
		this.collectionsView = await CollectionTree.init(_id('zotero-collections-tree'), {
			onSelectionChange: this._onCollectionSelection.bind(this),
			hideSources: ['duplicates', 'trash', 'feeds']
		});
	}
	
	async _onCollectionSelection() {
		var collectionTreeRow = this.collectionsView.getRow(this.collectionsView.selection.focused);
		if (!this.collectionsView.selection.count) return;
		// Collection not changed
		if (this.itemsView && this.itemsView.collectionTreeRow && this.itemsView.collectionTreeRow.id == collectionTreeRow.id) {
			return;
		}

		this.itemsView.setItemsPaneMessage(Zotero.getString('pane.items.loading'));
		
		// Load library data if necessary
		var library = Zotero.Libraries.get(collectionTreeRow.ref.libraryID);
		if (!library.getDataLoaded('item')) {
			Zotero.debug("Waiting for items to load for library " + library.libraryID);
			await library.waitForDataLoad('item');
		}
		
		await this.itemsView.changeCollectionTreeRow(collectionTreeRow);
		await this.itemsView.setFilter('search', SearchHandler.lastSearchValue);
		
		this.itemsView.clearItemsPaneMessage();
	}

	_addItemsDebounced = Zotero.Utilities.debounce(async (items) => {
		this.includeItemsIntoCitation(items);
	}, 100);
}

class ListLayout extends Layout {
	constructor() {
		super("list");
	}


	createItemNode(item, isSelectedGroup) {
		let itemNode = Helpers.createNode("div", { tabindex: "-1" }, "item hbox");
		let itemInfo = Helpers.createNode("div", {}, "info");
		let icon = Helpers.createNode("span", {}, "icon icon-css icon-item-type");
		let dataTypeLabel = item.getItemTypeIconName(true);
		icon.setAttribute("data-item-type", dataTypeLabel);

		let title = Helpers.createNode("div", {}, "title");
		let description;
		if (isSelectedGroup) {
			description = this.generateAddAllSelectedItemsNode();
		}
		else {
			description = Helpers.buildItemDescription(item);
		}
		title.textContent = item.getDisplayTitle();

		itemInfo.append(title, description);
		itemNode.append(icon, itemInfo);
		return itemNode;
	}

	async refreshItemsList() {
		await super.refreshItemsList();

		// Hide the entire list layout if there is not a single item to show
		_id("list-layout").hidden = !_id("list-layout").querySelector(".section:not([hidden])");
		// Set document width to avoid window being stretched horizontally
		doc.documentElement.style.maxWidth = window.innerWidth + "px";
		doc.documentElement.style.minWidth = window.innerWidth + "px";
		// Set max height so the window does not end up being too tall
		doc.documentElement.style.maxHeight = Math.max(window.innerHeight, 500) + "px";
		window.sizeToContent();
		// Clear all these styles after resizing is done
		doc.documentElement.style = "";
	}
}

// Object with citation-specific logic. Citation.items is the list of citationItems that
// is updated as bubbles are being updated, and it is used to set io.citationItems when dialog
// is accepted.
var Citation = {
	items: [],

	// Update io citation object based on Citation.items array
	updateCitationObject(final = false) {
		let result = [];
		for (let item of Citation.items) {
			if (final) {
				delete item.dialogReferenceID;
			}
			if (item instanceof Zotero.Item) {
				let ioResult = { id: item.cslItemID || item.id };
				if (typeof ioResult.id === "string" && ioResult.id.indexOf("/") !== -1) {
					let item = Zotero.Cite.getItem(ioResult.id);
					ioResult.uris = item.cslURIs;
					ioResult.itemData = item.cslItemData;
				}
				ioResult.label = item.label || null;
				ioResult.locator = item.locator || null;
				ioResult.prefix = item.prefix || null;
				ioResult.suffix = item.suffix || null;
				ioResult['suppress-author'] = item["suppress-author"] || null;
				if (!final) {
					ioResult.dialogReferenceID = item.dialogReferenceID;
				}
				result.push(ioResult);
			}
			else {
				result.push(item);
			}
		}
		io.citation.citationItems = result;

		if (final && io.sortable) {
			io.citation.properties.unsorted = !_id("keepSorted").checked;
		}
	},

	// Resorts the items in the citation and reorders bubbles to be in their proper spots
	async sort() {
		if (!_id("keepSorted").checked) return;
		Citation.updateCitationObject();
		await io.sort();
		for (let [index, sortedItemsEntry] of Object.entries(io.citation.sortedItems)) {
			let item = sortedItemsEntry[1];
			let allBubbles = [...doc.querySelectorAll("bubble-input .bubble")];
			let bubbleNode = allBubbles.find(candidate => candidate.getAttribute("dialogReferenceID") == item.dialogReferenceID);
			let expectedIndex = allBubbles.indexOf(bubbleNode);
			if (expectedIndex != index) {
				let referenceNode = allBubbles[index];
				_getNode("bubble-input .body").insertBefore(bubbleNode, referenceNode);
			}
		}
	},

	// Include specified items into the citation
	async addItems({ citationItems = [] }) {
		for (let item of citationItems) {
			// Add a new ID to our citation item and set the same ID on the bubble
			// so we have a reliable way to identify which bubble refers to which citationItem.
			item.dialogReferenceID = Zotero.Utilities.randomString(5);
			let bubbleString = Helpers.buildBubbleString(item);
			let bubble = _id("bubble-input").convertInputToBubble(bubbleString);
			bubble.setAttribute("dialogReferenceID", item.dialogReferenceID);
			let bubbleIndex = [...doc.querySelectorAll("bubble-input .bubble")].findIndex(candidate => candidate == bubble);
			
			this.items.splice(bubbleIndex, 0, item);
		}
		await this.sort();
	},

	// Construct citation upon initial load
	async buildCitation() {
		if (!io.citation.properties.unsorted
				&& _id("keepSorted").checked
				&& io.citation.sortedItems?.length) {
			await Citation.addItems({ citationItems: io.citation.sortedItems.map(entry => entry[0]) });
		}
		else {
			await Citation.addItems({ citationItems: io.citation.citationItems });
		}
		_id("bubble-input").refocusInput();
	},

	// Props passed to bubble-input to update citation items list after reordering or deletion
	async deleteBubbleNode(bubbleNode) {
		let itemIndex = Citation.findItemIDForBubble(bubbleNode);
		Citation.items.splice(itemIndex, 1);
		await SearchHandler.refresh(SearchHandler.lastSearchValue);
		currentLayout.refreshItemsList();
		bubbleNode.remove();
	},

	onBubbleNodeMoved(bubble, index) {
		let currentIndex = Citation.findItemIDForBubble(bubble);
		let [obj] = Citation.items.splice(currentIndex, 1);
		Citation.items.splice(index, 0, obj);
		_id("keepSorted").checked = false;
	},

	addLocator(bubble, label, locator) {
		let item = this.findItemForBubble(bubble);
		item.label = label;
		item.locator = locator;
		bubble.textContent = Helpers.buildBubbleString(item);
	},

	// Convenience functions to find which citation item in the array a given bubble refers to.
	findItemForBubble(bubble) {
		return this.items.find(item => item.dialogReferenceID === bubble.getAttribute("dialogReferenceID"));
	},

	findItemIDForBubble(bubble) {
		return this.items.findIndex(item => item.dialogReferenceID === bubble.getAttribute("dialogReferenceID"));
	},
};
window.addEventListener("DOMContentLoaded", onDOMContentLoaded);
