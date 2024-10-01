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

var doc, io, isCitingNotes;

var currentLayout, libraryLayout, listLayout;

var accepted;
const SEARCH_TIMEOUT = 500;

function onLoad() {
	console.log("OnLoad!");
}

function onDOMContentLoaded() {
	doc = document;
	io = window.arguments[0].wrappedJSObject;

	libraryLayout = new LibraryLayout();
	listLayout = new ListLayout();

	_toggleMode();
	_id("mode-button").addEventListener("click", _toggleMode);
	currentLayout.search("");

	// pass a few functions to bubble-input to call on user interactions
	// that affect the general state that we keep track of here
	_id("bubble-input").propSearch = text => currentLayout.search(text);
	_id("bubble-input").propOnBubbleDelete = Citation.onBubbleNodeDeleted;
	_id("bubble-input").propOnBubbleMove = Citation.onBubbleNodeMoved;
	_id("bubble-input").propOpenItemDetails = Popups.openItemDetails;
	_id("bubble-input").prophide = Popups.hide;

	doc.addEventListener("keypress", handleTopLevelKeypress);

	Citation.buildCitation();
	_id("settings-button").addEventListener("click", Popups.openSettings);
	doc.querySelector(".overlay").addEventListener("click", Popups.hide);
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
	if (accepted || SearchHanlder.searching) return;
	accepted = true;
	try {
		io.citation.citationItems = Citation.items;
		// document.querySelector(".citation-dialog.deck").selectedIndex = 1;
		io.accept(percent => console.log("Progress ", percent));
	}
	catch (e) {
		Zotero.debug(e);
	}
}

function handleTopLevelKeypress(event) {
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
	}
}

function _id(id) {
	return doc.getElementById(id);
}


// Template for layout classes
class Layout {
	constructor(type) {
		this.type = type;
	}

	// overriden by library and list layouts
	async refreshItemsList() {}

	// Regardless of which layout we are in, we need to run the search and
	// update itemsList.
	async search(value) {
		SearchHanlder.searching = true;
		// This is called on each typed character, so refresh item list when typing stopped
		SearchHanlder.refreshDebounced(value, () => {
			this.refreshItemsList();
			SearchHanlder.searching = false;
		});
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
		this.itemsView.setFilter('search', value);
	}

	async refreshItemsList() {
		let groups = SearchHanlder.results;
		
		for (let [key, group] of Object.entries(groups)) {
			let section = _id(`${this.type}-${key}-items`);
			console.log("Refresh items list ", `${this.type}-${key}-items`, group.length);
			if (!section) continue;
			section.hidden = !group.length;
			let itemContainer = section.querySelector(".itemsContainer");
			if (section.hidden) {
				itemContainer.replaceChildren();
				continue;
			}
	
			let items = [];
			for (let item of group) {
				let itemNode = Helpers.createNode("div", {}, "item");

				let title = Helpers.createNode("div", {}, "title");
				let description = Helpers.buildItemDescription(item);
				title.textContent = item.getDisplayTitle();

				itemNode.append(title, description);
				itemNode.addEventListener("click", () => {
					Citation.addItems({ items: [item] });
				});
				items.push(itemNode);
			}
			itemContainer.replaceChildren(...items);
		}
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
			onActivate: (event, items) => {
				Citation.addItems({ items: items });
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
		await this.itemsView.setFilter('search', SearchHanlder.lastSearchValue);
		
		this.itemsView.clearItemsPaneMessage();
	}
}

class ListLayout extends Layout {
	constructor() {
		super("list");
	}

	async refreshItemsList() {
		let groups = SearchHanlder.results;
		
		for (let [key, group] of Object.entries(groups)) {
			let section = _id(`${this.type}-${key}-items`);
			console.log("Refresh items list ", `${this.type}-${key}-items`, group.length);
			if (!section) continue;
			section.hidden = !group.length;
			let itemContainer = section.querySelector(".itemsContainer");
			if (section.hidden) {
				itemContainer.replaceChildren();
				continue;
			}
	
			let items = [];
			for (let item of group) {
				let itemNode = Helpers.createNode("div", {}, "item hbox");
				let itemInfo = Helpers.createNode("div", {}, "info");
				let icon = Helpers.createNode("span", {}, "icon icon-css icon-item-type");
				let dataTypeLabel = item.getItemTypeIconName(true);
				icon.setAttribute("data-item-type", dataTypeLabel);

				let title = Helpers.createNode("div", {}, "title");
				let description = Helpers.buildItemDescription(item);
				title.textContent = item.getDisplayTitle();

				itemInfo.append(title, description);
				itemNode.append(icon, itemInfo);
				itemNode.addEventListener("click", () => {
					Citation.addItems({ items: [item] });
				});
				items.push(itemNode);
			}
			itemContainer.replaceChildren(...items);
		}
		_id("no-items-message").hidden = !!_id("list-layout").querySelector(".section:not([hidden])");
	}
}

// Contains all search-related logic. Last search results are stored in SearchHandler.results
// as the following object: { found: [], cited: [], open: [], selected: []}.
// Can be refreshed via SearchHandler.refresh or refreshDebounced.
var SearchHanlder = {
	lastSearchValue: "",
	results: {},
	options: {},
	searching: false,

	refreshDebounced: Zotero.Utilities.debounce(async (str, callback) => {
		await SearchHanlder.refresh(str);
		callback();
	}, SEARCH_TIMEOUT),

	async refresh(str = "") {
		let searchResultIDs = await this._runSearch(str);
		this.lastSearchValue = str;
		this.options = {
			citedItems: false,
			citedItemsMatchingSearch: false,
			searchString: str,
			searchResultIDs: searchResultIDs,
			preserveSelection: false,
			nCitedItemsFromLibrary: {},
			citationItemIDs: new Set()
		};

		let [selectedItems, libraryItems] = await this._getMatchingLibraryItems();
		this.results = {
			found: currentLayout.type == "list" ? libraryItems : [],
			open: (await this._getMatchingReaderOpenItems()) || [],
			cited: this._getMatchingCitedItems(),
			selected: selectedItems,
		};
	},

	// Need to fill up with remaining logic
	async _runSearch(str) {
		var s = new Zotero.Search();
		str = str.replace(/ (?:&|and) /g, " ", "g").replace(/^,/, '');
		s.addCondition("quicksearch-titleCreatorYear", "contains", str);
		s.addCondition("itemType", "isNot", "attachment");
		if (io.filterLibraryIDs) {
			io.filterLibraryIDs.forEach(id => s.addCondition("libraryID", "is", id));
		}
		let searchResultIDs = await s.search();
		return searchResultIDs;
	},

	_getMatchingCitedItems() {
		let { citedItems, citedItemsMatchingSearch, nCitedItemsFromLibrary } = this.options;
		if (isCitingNotes || !citedItems) return [];
	
		// We have cited items
		for (let citedItem of citedItems) {
			// Tabulate number of items in document for each library
			if (!citedItem.cslItemID) {
				var libraryID = citedItem.libraryID;
				if (libraryID in nCitedItemsFromLibrary) {
					nCitedItemsFromLibrary[libraryID]++;
				}
				else {
					nCitedItemsFromLibrary[libraryID] = 1;
				}
			}
		}
		return citedItemsMatchingSearch;
	},
	
	async  _getMatchingReaderOpenItems() {
		if (isCitingNotes) return [];
		let win = Zotero.getMainWindow();
		let tabs = win.Zotero_Tabs.getState();
		let itemIDs = tabs.filter(t => t.type === 'reader').sort((a, b) => {
			// Sort selected tab first
			if (a.selected) return -1;
			else if (b.selected) return 1;
			// Then in reverse chronological select order
			else if (a.timeUnselected && b.timeUnselected) return b.timeUnselected - a.timeUnselected;
			// Then in reverse order for tabs that never got loaded in this session
			else if (a.timeUnselected) return -1;
			return 1;
		}).map(t => t.data.itemID);
		if (!itemIDs.length) return [];

		let items = itemIDs.map((itemID) => {
			let item = Zotero.Items.get(itemID);
			if (item && item.parentItemID) {
				itemID = item.parentItemID;
			}
			return Zotero.Cite.getItem(itemID);
		});
		let matchedItems = new Set(items);
		if (this.options.searchString) {
			Zotero.debug("QuickFormat: Searching open tabs");
			matchedItems = new Set();
			let splits = Zotero.Fulltext.semanticSplitter(this.options.searchString);
			for (let item of items) {
				// Generate a string to search for each item
				let itemStr = item.getCreators()
					.map(creator => creator.firstName + " " + creator.lastName)
					.concat([item.getField("title"), item.getField("date", true, true).substr(0, 4)])
					.join(" ");
				
				// See if words match
				for (let split of splits) {
					if (itemStr.toLowerCase().includes(split)) matchedItems.add(item);
				}
			}
			Zotero.debug("QuickFormat: Found matching open tabs");
		}
		// Filter out already cited items
		return Array.from(matchedItems).filter(i => !this.options.citationItemIDs.has(i.cslItemID ? i.cslItemID : i.id));
	},
	
	async  _getMatchingLibraryItems() {
		let { searchString,
			searchResultIDs, nCitedItemsFromLibrary } = this.options;

		let win = Zotero.getMainWindow();
		let selectedItems = [];
		if (win.Zotero_Tabs.selectedType === "library") {
			if (!isCitingNotes) {
				selectedItems = Zotero.getActiveZoteroPane().getSelectedItems().filter(i => i.isRegularItem());
				// Filter out already cited items
				selectedItems = selectedItems.filter(i => !this.options.citationItemIDs.has(i.cslItemID ? i.cslItemID : i.id));
			}
			else {
				selectedItems = Zotero.getActiveZoteroPane().getSelectedItems().filter(i => i.isNote());
			}
		}
		if (!searchString) {
			return [selectedItems, []];
		}
		else if (!searchResultIDs.length) {
			return [[], []];
		}
			
		// Search results might be in an unloaded library, so get items asynchronously and load
		// necessary data
		var items = await Zotero.Items.getAsync(searchResultIDs);
		await Zotero.Items.loadDataTypes(items);
		
		searchString = searchString.toLowerCase();
		let searchParts = Zotero.SearchConditions.parseSearchString(searchString);
		var collation = Zotero.getLocaleCollation();
		
		function _itemSort(a, b) {
			var firstCreatorA = a.firstCreator, firstCreatorB = b.firstCreator;
			
			// Favor left-bound name matches (e.g., "Baum" < "Appelbaum"),
			// using last name of first author
			if (firstCreatorA && firstCreatorB) {
				for (let part of searchParts) {
					let caStartsWith = firstCreatorA.toLowerCase().startsWith(part.text);
					let cbStartsWith = firstCreatorB.toLowerCase().startsWith(part.text);
					if (caStartsWith && !cbStartsWith) {
						return -1;
					}
					else if (!caStartsWith && cbStartsWith) {
						return 1;
					}
				}
			}
			
			var libA = a.libraryID, libB = b.libraryID;
			if (libA !== libB) {
				// Sort by number of cites for library
				if (nCitedItemsFromLibrary[libA] && !nCitedItemsFromLibrary[libB]) {
					return -1;
				}
				if (!nCitedItemsFromLibrary[libA] && nCitedItemsFromLibrary[libB]) {
					return 1;
				}
				if (nCitedItemsFromLibrary[libA] !== nCitedItemsFromLibrary[libB]) {
					return nCitedItemsFromLibrary[libB] - nCitedItemsFromLibrary[libA];
				}
				
				// Sort by ID even if number of cites is equal
				return libA - libB;
			}
		
			// Sort by last name of first author
			if (firstCreatorA !== "" && firstCreatorB === "") {
				return -1;
			}
			else if (firstCreatorA === "" && firstCreatorB !== "") {
				return 1;
			}
			else if (firstCreatorA) {
				return collation.compareString(1, firstCreatorA, firstCreatorB);
			}
			
			// Sort by date
			var yearA = a.getField("date", true, true).substr(0, 4),
				yearB = b.getField("date", true, true).substr(0, 4);
			return yearA - yearB;
		}
		
		function _noteSort(a, b) {
			return collation.compareString(
				1, b.getField('dateModified'), a.getField('dateModified')
			);
		}
		
		items.sort(isCitingNotes ? _noteSort : _itemSort);
		
		// Split filtered items into selected and other bins
		let matchingSelectedItems = [];
		let matchingItems = [];
		for (let item of items) {
			if (selectedItems.findIndex(i => i.id === item.id) !== -1) {
				matchingSelectedItems.push(item);
			}
			else {
				matchingItems.push(item);
			}
		}
		return [matchingSelectedItems, matchingItems];
	},
};

// Object with citation-specific logic. Citation.items is the list of citationItems that
// is updated as bubbles are being updated, and it is used to set io.citationItems when dialog
// is accepted.
var Citation = {
	keepSorted: true,
	items: [],

	// Resorts the items in the citation and reorders bubbles to be in their proper spots
	async sort() {
		if (!Citation.keepSorted || !io.sortable) return;

		await io.sort();
		for (let sortedItemsEntry of io.citation.sortedItems) {
			let item = sortedItemsEntry[0];
			let allBubbles = [...doc.querySelectorAll("bubble-input .bubble")];
			let bubbleNode = allBubbles.find(candidate => candidate.getAttribute("dialogReferenceID") == item.dialogReferenceID);
			let expectedIndex = allBubbles.indexOf(bubbleNode);
			let actualIndex = [...io.citation.sortedItems].indexOf(item);
			if (expectedIndex != actualIndex) {
				let referenceNode = allBubbles[actualIndex];
				_id("bubble-input").querySelector(".body").insertBefore(bubbleNode, referenceNode);
			}
		}
	},

	// Include specified items into the citation
	async addItems({ ids = [], items = [], citationItems = [] }) {
		if (items) {
			ids = ids.concat(items.map(item => item.id));
		}
		if (ids) {
			citationItems = citationItems.concat(ids.map((id) => {
				let citationItem = { id };
				if (typeof id === "string" && id.indexOf("/") !== -1) {
					let item = Zotero.Cite.getItem(id);
					citationItem.uris = item.cslURIs;
					citationItem.itemData = item.cslItemData;
				}
				return citationItem;
			}));
		}
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
	buildCitation() {
		if (!io.citation.properties.unsorted
				&& this.keepSorted
				&& io.citation.sortedItems?.length) {
			Citation.addItems({ citationItems: io.citation.sortedItems.map(entry => entry[0]) });
		}
		else {
			Citation.addItems({ citationItems: io.citation.citationItems });
		}
	},

	// Props passed to bubble-input to update citation items list after reordering or deletion
	onBubbleNodeDeleted(bubble) {
		let itemIndex = Citation.findItemIDForBubble(bubble);
		Citation.items.splice(itemIndex, 1);
	},

	onBubbleNodeMoved(bubble, index) {
		let currentIndex = Citation.findItemIDForBubble(bubble);
		let [obj] = Citation.items.splice(currentIndex, 1);
		Citation.items.splice(index, 0, obj);
	},

	// Convenience functions to find which citation item in the array a given bubble refers to.
	findItemForBubble(bubble) {
		return this.items.find(item => item.dialogReferenceID === bubble.getAttribute("dialogReferenceID"));
	},

	findItemIDForBubble(bubble) {
		return this.items.findIndex(item => item.dialogReferenceID === bubble.getAttribute("dialogReferenceID"));
	}
};

// General helper functions
var Helpers = {
	createNode(type, attributes, className) {
		let node = doc.createElement(type);
		for (let [key, val] of Object.entries(attributes)) {
			node.setAttribute(key, val);
		}
		node.className = className;
		return node;
	},

	buildBubbleString(citationItem) {
		var item = io.customGetItem && io.customGetItem(citationItem) || Zotero.Cite.getItem(citationItem.id);
		// create text for bubble
		
		// Creator
		var title;
		var str = item.getField("firstCreator");
		
		// Title, if no creator (getDisplayTitle in order to get case, e-mail, statute which don't have a title field)
		title = item.getDisplayTitle();
		title = title.substr(0, 32) + (title.length > 32 ? "…" : "");
		if (!str) {
			str = Zotero.getString("punctuation.openingQMark") + title + Zotero.getString("punctuation.closingQMark");
		}
		
		// Date
		var date = item.getField("date", true, true);
		if (date && (date = date.substr(0, 4)) !== "0000") {
			str += ", " + parseInt(date);
		}
		
		// Locator
		if (citationItem.locator) {
			// Try to fetch the short form of the locator label. E.g. "p." for "page"
			// If there is no locator label, default to "page" for now
			let label = (Zotero.Cite.getLocatorString(citationItem.label || 'page', 'short') || '').toLocaleLowerCase();
			
			str += `, ${label} ${citationItem.locator}`;
		}
		
		// Prefix
		if (citationItem.prefix && Zotero.CiteProc.CSL.ENDSWITH_ROMANESQUE_REGEXP) {
			let prefix = citationItem.prefix.substr(0, 10) + (citationItem.prefix.length > 10 ? "…" : "");
			str = prefix
				+ (Zotero.CiteProc.CSL.ENDSWITH_ROMANESQUE_REGEXP.test(citationItem.prefix) ? " " : "")
				+ str;
		}
		
		// Suffix
		if (citationItem.suffix && Zotero.CiteProc.CSL.STARTSWITH_ROMANESQUE_REGEXP) {
			let suffix = citationItem.suffix.substr(0, 10) + (citationItem.suffix.length > 10 ? "…" : "");
			str += (Zotero.CiteProc.CSL.STARTSWITH_ROMANESQUE_REGEXP.test(citationItem.suffix) ? " " : "") + suffix;
		}
		
		return str;
	},

	buildItemDescription(item) {
		let descriptionWrapper = document.createElement("div");
		descriptionWrapper.classList = "description";
		let wrapTextInSpan = (text, styles = {}) => {
			let span = document.createElement("span");
			for (let [style, value] of Object.entries(styles)) {
				span.style[style] = value;
			}
			span.textContent = text;
			return span;
		};
		let addPeriodIfNeeded = (node) => {
			if (node.textContent.length && node.textContent[node.textContent.length - 1] !== ".") {
				let period = document.createElement("span");
				period.textContent = ".";
				descriptionWrapper.lastChild.setAttribute("no-comma", true);
				descriptionWrapper.appendChild(period);
			}
		};
		if (item.isNote()) {
			var date = Zotero.Date.sqlToDate(item.dateModified, true);
			date = Zotero.Date.toFriendlyDate(date);
			let dateLabel = wrapTextInSpan(date);
			
			var text = item.note;
			text = Zotero.Utilities.unescapeHTML(text);
			text = text.trim();
			text = text.slice(0, 500);
			var parts = text.split('\n').map(x => x.trim()).filter(x => x.length);
			if (parts[1]) {
				dateLabel.textContent += ` ${parts[1]}.`;
			}
			descriptionWrapper.appendChild(dateLabel);
			addPeriodIfNeeded(descriptionWrapper);
			return descriptionWrapper;
		}

		var nodes = [];
		// Add a red label to retracted items
		if (Zotero.Retractions.isRetracted(item)) {
			let label = wrapTextInSpan(Zotero.getString("retraction.banner"), { color: 'red', 'margin-inline-end': '5px' });
			label.setAttribute("no-comma", true);
			nodes.push(label);
		}
		var authorDate = "";
		if (item.firstCreator) authorDate = item.firstCreator;
		var date = item.getField("date", true, true);
		if (date && (date = date.substr(0, 4)) !== "0000") {
			authorDate += ` ( ${parseInt(date)} )`;
		}
		authorDate = authorDate.trim();
		if (authorDate) nodes.push(wrapTextInSpan(authorDate));
		
		var publicationTitle = item.getField("publicationTitle", false, true);
		if (publicationTitle) {
			let label = wrapTextInSpan(publicationTitle, { fontStyle: 'italics' });
			nodes.push(label);
		}
		
		var volumeIssue = item.getField("volume");
		if (item.getField("issue")) volumeIssue += `(${item.getField("issue")})`;
		if (volumeIssue) nodes.push(wrapTextInSpan(volumeIssue));
		
		var publisherPlace = [];
		if (item.getField("publisher")) publisherPlace.push(item.getField("publisher"));
		if (item.getField("place")) publisherPlace.push(item.getField("place"));
		
		if (publisherPlace.length) nodes.push(wrapTextInSpan(publisherPlace.join(": ")));
		
		if (item.getField("pages")) nodes.push(wrapTextInSpan(item.getField("pages")));
		
		if (!nodes.length && item.getField("url")) {
			nodes.push(wrapTextInSpan(item.getField("url")));
		}

		descriptionWrapper.replaceChildren(...nodes);
		
		addPeriodIfNeeded(descriptionWrapper);

		return descriptionWrapper;
	}
};

// Handling of popups
var Popups = {
	detailsOfBubble: null,

	openSettings() {
		_id("settingsPopup").setAttribute("open", true);
		doc.querySelector(".overlay").hidden = false;
	},

	openItemDetails(bubble) {
		let bubbleRect = bubble.getBoundingClientRect();
		let popup = document.querySelector("#itemDetails");
		popup.setAttribute("open", true);
		// popup should be cenetered on the bubble
		popup.style.left = `${Math.max(10, bubbleRect.left + (bubbleRect.width / 2) - (popup.offsetWidth / 2))}px`;
		popup.style.top = `${bubbleRect.bottom + 10}px`;
		doc.querySelector(".overlay").hidden = false;

		// add locator labels if they don't exist yet
		if (_id("label").childElementCount == 0) {
			let locators = Zotero.Cite.labels;
			for (var locator of locators) {
				let locatorLabel = Zotero.Cite.getLocatorString(locator);
				var option = doc.createElement("option");
				option.value = locator;
				option.label = locatorLabel;
				_id("label").appendChild(option);
			}
		}

		let citationItem = Citation.findItemForBubble(bubble);
		let item = Zotero.Cite.getItem(citationItem.id);
		// Add header and fill inputs with their values
		let description = Helpers.buildItemDescription(item);
		_id("itemDetails").querySelector(".description")?.remove();
		_id("itemTitle").textContent = item.getDisplayTitle();
		_id("itemTitle").after(description);
		let dataTypeLabel = item.getItemTypeIconName(true);
		_id("itemDetails").querySelector(".icon").setAttribute("data-item-type", dataTypeLabel);

		_id("label").value = citationItem.label || "page";
		_id("locator").value = citationItem.locator || "";
		_id("prefix").value = citationItem.prefix || "";
		_id("suffix").value = citationItem.suffix || "";
		_id("suppress-author").checked = !!citationItem["suppress-author"];
		// Record that the popup is open for this bubble
		Popups.detailsOfBubble = bubble;
	},

	// When item details popup is closed, sync it's data to citationItems
	handleItemDetailsUpdate() {
		let item = Citation.findItemForBubble(Popups.detailsOfBubble);

		item.label = _id("locator").value ? _id("label").value : null;
		item.locator = _id("locator").value;
		item.prefix = _id("prefix").value;
		item.suffix = _id("suffix").value;
		item["suppress-author"] = _id("suppress-author").checked;
		
		Popups.detailsOfBubble.textContent = Helpers.buildBubbleString(item);
	},

	hide() {
		let popup = doc.querySelector(".popup[open]");
		if (!popup) return;
		popup.style.removeProperty("left");
		popup.style.removeProperty("top");
		popup.removeAttribute("open");
		doc.querySelector(".overlay").hidden = true;

		if (popup.id == "itemDetails") {
			Popups.handleItemDetailsUpdate();
		}

		Popups.detailsOfBubble = null;
	}
};

window.addEventListener("DOMContentLoaded", onDOMContentLoaded, false);
window.addEventListener("load", onLoad, false);
