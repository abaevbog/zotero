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

//
// Initialization of all handlers and top-level functions
//
function onLoad() {
	doc = document;
	io = window.arguments[0].wrappedJSObject;
	isCitingNotes = !!io.isCitingNotes;

	Helpers = new CitationDialogHelpers({ doc, io });
	SearchHandler = new CitationDialogSearchHandler({ isCitingNotes, io });
	PopupsHandler = new CitationDialogPopupsHandler({ doc });
	KeyboardHandler = new CitationDialogKeyboardHandler({ doc });

	_id("keepSorted").disabled = !io.sortable;
	_id("keepSorted").checked = io.sortable && !io.citation.properties.unsorted;
	let visibleSettings = !!_id("settings-popup").querySelector("input:not([disabled])");
	_id("settings-button").hidden = !visibleSettings;

	libraryLayout = new LibraryLayout();
	listLayout = new ListLayout();

	// top-level keypress handling and focus navigation across the dialog
	// keypresses for lower-level bubble-specific behavior are handled in bubbleInput.js
	doc.addEventListener("keypress", event => KeyboardHandler.handleKeypress(event));
	// capturing keypress listener for a few special cases, such as handling arrowUp
	// keypress from the top-most row in the items table
	doc.addEventListener("keydown", event => KeyboardHandler.captureKeydown(event), true);

	// handling of user's IO
	IOManager.init();

	// build the citation items based on io, and then create bubbles and focus an input
	CitationDataManager.buildCitation().then(() => {
		IOManager.updateBubbleInput();
		_id("bubble-input").refocusInput();
	});
}


function accept() {
	if (accepted || SearchHandler.searching) return;
	accepted = true;
	CitationDataManager.updateCitationObject(true);
	_id("library-layout").hidden = true;
	_id("list-layout").hidden = true;
	_id("bubble-input").hidden = true;
	_id("progress").hidden = false;
	document.documentElement.style.removeProperty("min-height");
	currentLayout.resizeWindow();
	Zotero.Prefs.set("integration.citationDialogLastClosedMode", currentLayout.type);
	if (currentLayout.type == "library") {
		Zotero.Prefs.set("integration.citationDialogCollectionLastSelected", libraryLayout.collectionsView.selectedTreeRow.ref.treeViewID);
	}
	io.accept((percent) => {
		_id("progress").value = Math.round(percent);
	});
}

function cancel() {
	if (accepted) return;
	accepted = true;
	io.citation.citationItems = [];
	io.accept();
	window.close();
}

// shortcut used for brevity
function _id(id) {
	return doc.getElementById(id);
}


// Template for layout classes.
class Layout {
	constructor(type) {
		this.type = type;
	}

	// Re-render the items based on search rersults
	async refreshItemsList() {
		let sections = [];

		// Tell SearchHandler which currently cited items are so they are not included in results
		let citedItems = CitationDataManager.getCitationItems();
		let searchResultGroups = SearchHandler.getOrderedSearchResultGroups(citedItems);
		for (let { key, group, isLibrary } of searchResultGroups) {
			if (isLibrary && this.type == "library") break;
			// selected items become a collapsible deck/list if there are multiple items
			let isGroupCollapsible = key == "selected" && group.length > 1;
			
			// Construct each section and items
			let sectionHeader = "";
			if (isLibrary) {
				sectionHeader = Zotero.Libraries.get(key).name;
			}
			// special handling for selected items to display how many total selected items there are
			else if (key == "selected") {
				sectionHeader = await doc.l10n.formatValue(`integration-citationDialog-section-${key}`, { count: group.length, total: SearchHandler.allSelectedItemsCount() });
			}
			else {
				sectionHeader = await doc.l10n.formatValue(`integration-citationDialog-section-${key}`, { count: group.length });
			}
			let section = Helpers.buildItemsSection(`${this.type}-${key}-items`, sectionHeader, isGroupCollapsible, group.length, this.type == "library");
			let itemContainer = section.querySelector(".itemsContainer");
	
			let items = [];
			let index = 0;
			for (let item of group) {
				// do not add an unreasonable number of nodes into the DOM
				if (index >= ITEM_LIST_MAX_ITEMS) break;
				// createItemNode implemented by layouts
				let itemNode = await this.createItemNode(item, isGroupCollapsible ? index : null);
				itemNode.addEventListener("click", IOManager.handleItemClick);
				items.push(itemNode);
				index++;
			}
			itemContainer.replaceChildren(...items);
			sections.push(section);
			if (isGroupCollapsible) {
				// just collapse/expand items when section header is clicked
				section.querySelector(".header-label").addEventListener("click", event => IOManager.handleCollapsibleSectionHeaderClick(section, event));
				// handle click on "Add all"
				section.querySelector(".add-all").addEventListener("click", () => IOManager.addItemsToCitation(group));
				// if the user explicitly expanded or collapsed the section, keep it as such
				if (IOManager.sectionExpandedStatus[section.id]) {
					IOManager.toggleSectionCollapse(section, IOManager.sectionExpandedStatus[section.id]);
				}
				// otherwise, expand the section if something is typed or whenever the list layout is opened
				else {
					let isSomethingTyped = _id("bubble-input").isSomethingTyped();
					IOManager.toggleSectionCollapse(section, (isSomethingTyped || this.type == "list") ? "expanded" : "collapsed");
				}
			}
		}
		_id(`${this.type}-layout`).querySelector(".search-items").replaceChildren(...sections);
		// Update which bubbles need to be highlighted
		this.updateSelectedItems();
		// Clear the record of currently selected item from inputs
		_id("bubble-input").ariaSetCurrentItem(null);
		// Pre-select the item to be added on Enter of an input
		IOManager.markPreSelected();
	}

	// Create the node for selected/cited/opened item groups.
	// It's different for list and library modes, so it is implemented by layouts.
	async createItemNode() {}

	// Regardless of which layout we are in, we need to run the search and
	// update itemsList.
	async searchDebounced(value) {
		_id("loading-spinner").setAttribute("status", "animate");
		_id("accept-button").hidden = true;
		SearchHandler.searching = true;
		// This is called on each typed character, so refresh item list when typing stopped
		SearchHandler.refreshDebounced(value, () => {
			this.refreshItemsList();
			SearchHandler.searching = false;
			_id("loading-spinner").removeAttribute("status");
			_id("accept-button").hidden = false;
		});
	}

	// Run search and refresh items list immediately
	async search(value) {
		_id("loading-spinner").setAttribute("status", "animate");
		_id("accept-button").hidden = true;
		SearchHandler.searching = true;
		await SearchHandler.refresh(value);
		this.refreshItemsList();
		SearchHandler.searching = false;
		_id("loading-spinner").removeAttribute("status");
		_id("accept-button").hidden = false;
	}

	// implemented by layouts
	resizeWindow() {}

	updateSelectedItems() {}
}

class LibraryLayout extends Layout {
	constructor() {
		super("library");
		this._initItemTree();
		this._initCollectionTree();
		this.lastHeight = null;
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

	// Create item node for an item group and store item ids in itemIDs attribute
	async createItemNode(item, index = null) {
		let itemNode = Helpers.createNode("div", { tabindex: "-1", "aria-describedby": "item-description", role: "option", "data-tabindex": 40, "data-arrow-nav-enabled": true }, "item keyboard-clickable");
		let id = item.cslItemID || item.id;
		itemNode.setAttribute("itemID", id);
		itemNode.setAttribute("role", "option");
		itemNode.id = id;
		let title = Helpers.createNode("div", {}, "title");
		let description = Helpers.buildItemDescription(item);
		title.textContent = item.getDisplayTitle();

		itemNode.append(title, description);

		if (index !== null) {
			itemNode.style.setProperty('--deck-index', index);
		}

		return itemNode;
	}

	async refreshItemsList() {
		await super.refreshItemsList();
		_id("library-other-items").hidden = !_id("library-layout").querySelector(".section:not([hidden])");
		this.resizeWindow();
		if (!_id("library-other-items").hidden) {
			// on mouse scrollwheel in suggested items, scroll the list horizontally
			_id("library-other-items").addEventListener('wheel', this._scrollHorizontallyOnWheel);
			// clicking on the collapsed deck of items will add all of them
			let collapsibleDecks = [..._id("library-other-items").querySelectorAll(".section.expandable")];
			for (let collapsibleDeck of collapsibleDecks) {
				collapsibleDeck.querySelector(".itemsContainer").addEventListener("click", this._captureItemsContainerClick, true);
				collapsibleDeck.querySelector(".itemsContainer").classList.add("keyboard-clickable");
			}
		}
	}

	// Refresh itemTree to properly display +/- icons column
	async refreshItemsView() {
		this._refreshItemsViewHighlightedRows();
		// Save selected items, clear selection to not scroll after refresh
		let selectedItemIDs = this.itemsView.getSelectedItems(true);
		this.itemsView.selection.clearSelection();
		// Refresh to reset row cache to get latest data of which items are included
		await this.itemsView.refresh();
		// Redraw the itemTree
		this.itemsView.tree.invalidate();
		// Restore selection without scrolling
		this.itemsView.selection.selectEventsSuppressed = true;
		await this.itemsView.selectItems(selectedItemIDs, true, true);
		this.itemsView.selection.selectEventsSuppressed = false;
	}

	updateSelectedItems() {
		if (!libraryLayout.itemsView) return;
		let selectedItemIDs = new Set(libraryLayout.itemsView.getSelectedItems().map(item => item.id));
		for (let itemObj of CitationDataManager.items) {
			if (selectedItemIDs.has(itemObj.zoteroItem.id)) {
				itemObj.selected = true;
			}
			else {
				itemObj.selected = false;
			}
		}
		IOManager.updateBubbleInput();
	}

	resizeWindow() {
		let bubbleInputStyle = getComputedStyle(_id("search-row"));
		let bubbleInputMargins = parseInt(bubbleInputStyle.marginTop) + parseInt(bubbleInputStyle.marginBottom);
		let bubbleInputHeight = _id("search-row").getBoundingClientRect().height + bubbleInputMargins;

		let suggestedItemsHeight = _id("library-other-items").getBoundingClientRect().height;

		let minTableHeight = 200;

		let bottomHeight = _id("bottom-area-wrapper").getBoundingClientRect().height;
		
		let minHeight = bubbleInputHeight + suggestedItemsHeight + bottomHeight + minTableHeight;
		// set min-height to make sure suggested items and at least 200px of itemsView is always visible
		doc.documentElement.style.minHeight = `${minHeight}px`;

		// if there is lastHeight recorded, resize to that
		if (this.lastHeight) {
			// timeout is likely required to let updated minHeight to settle
			setTimeout(() => {
				window.resizeTo(window.innerWidth, this.lastHeight);
			}, 10);
		}
	}

	// handle click on the items container
	_captureItemsContainerClick(event) {
		// only handle clicks without a modifier or meta/ctrl+click
		let withModifier = ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].some(key => event[key]);
		if (withModifier && !(Zotero.isMac && event.metaKey) || (!Zotero.isMac && event.ctrlKey)) return;

		let section = event.target.closest(".section");
		// if the section is expanded, do nothing
		if (section.classList.contains("expanded")) return;
		event.stopPropagation();
		// on meta/ctrl+click, toggle selected status of all items in the container
		if (withModifier) {
			for (let item of [...section.querySelectorAll(".item")]) {
				IOManager.toggleItemNodeSelect(item);
			}
			currentLayout.updateSelectedItems();
			return;
		}
		// on click without modifier, if all items in the container are selected, add all selected items.
		// otherwise, add just items from this container
		let selectedIDs = [];
		if (section.querySelector(".item").classList.contains("selected")) {
			let selectedItemNodes = _id(`${currentLayout.type}-layout`).querySelectorAll(".item.selected");
			selectedIDs = [...selectedItemNodes].map(node => node.getAttribute("itemID"));
		}
		else {
			selectedIDs = [...section.querySelectorAll(".item")].map(node => node.getAttribute("itemID"));
		}
		IOManager.addItemsToCitation(Zotero.Items.get(selectedIDs));
	}

	async _initItemTree() {
		const ItemTree = require('zotero/itemTree');
		const { getCSSIcon } = require('components/icons');
		const { COLUMNS } = require('zotero/itemTreeColumns');

		var itemsTree = _id('zotero-items-tree');
		let itemColumns = COLUMNS.map((column) => {
			column = Object.assign({}, column);
			column.hidden = !['title', 'firstCreator', 'date'].includes(column.dataKey);
			return column;
		});
		// Add +/- column to indicate if an item is included in a citation
		// and add/exclude them on click
		itemColumns.push({
			dataKey: 'removeFromCitation',
			label: 'Remove from Citation',
			htmlLabel: ' ', // space for column label to appear empty
			width: 26,
			staticWidth: true,
			fixedWidth: true,
			showInColumnPicker: false,
			renderer: (index, inCitation, column) => {
				let cell = Helpers.createNode("span", {}, `cell ${column.className} clickable`);
				let iconWrapper = Helpers.createNode("span", {}, `icon-action`);
				cell.append(iconWrapper);
				let icon = getCSSIcon('minus-circle');
				if (inCitation === null) {
					// no icon should be shown when an item cannot be added
					// (e.g. when citing notes, parent items are displayed but not included)
					icon = getCSSIcon("");
				}
				if (inCitation == false) {
					iconWrapper.setAttribute("disabled", true);
				}
				iconWrapper.append(icon);
				return cell;
			}
		});
		itemColumns.push({
			dataKey: 'addToCitation',
			label: 'Add to citation',
			htmlLabel: ' ', // space for column label to appear empty
			width: 26,
			staticWidth: true,
			fixedWidth: true,
			showInColumnPicker: false,
			renderer: (index, inCitation, column) => {
				let cell = Helpers.createNode("span", {}, `cell ${column.className} clickable`);
				let iconWrapper = Helpers.createNode("span", {}, `icon-action`);
				cell.append(iconWrapper);
				let icon = getCSSIcon('plus-circle');
				if (inCitation === null) {
					// no icon should be shown when an item cannot be added
					// (e.g. when citing notes, parent items are displayed but not included)
					icon = getCSSIcon("");
				}
				iconWrapper.append(icon);
				return cell;
			}
		});
		this.itemsView = await ItemTree.init(itemsTree, {
			id: "citationDialog",
			dragAndDrop: false,
			persistColumns: true,
			columnPicker: true,
			onSelectionChange: () => {
				libraryLayout.updateSelectedItems();
			},
			regularOnly: !isCitingNotes,
			onActivate: (event, items) => {
				// PreventDefault needed to stop Enter event from reaching KeyboardHandler
				// which would accept the dialog
				event.preventDefault();
				IOManager.addItemsToCitation(items, { noInputRefocus: true });
			},
			emptyMessage: Zotero.getString('pane.items.loading'),
			columns: itemColumns,
			// getExtraField helps itemTree fetch the data for a column that's
			// not a part of actual item properties
			getExtraField: (item, key) => {
				if (key == "removeFromCitation" || key == "addToCitation") {
					if (!(item instanceof Zotero.Item)) return null;
					if (isCitingNotes && !item.isNote()) return null;
					if (!isCitingNotes && !item.isRegularItem()) return null;
					return CitationDataManager.itemAddedCache.has(item.id);
				}
				return undefined;
			}
		});
		// handle icon click to add/remove items
		itemsTree.addEventListener("mousedown", event => this._handleItemsViewRowClick(event), true);
		itemsTree.addEventListener("mouseup", event => this._handleItemsViewRowClick(event), true);
		// when focus leaves the itemTree, remove fixed height from bubbleInput
		itemsTree.addEventListener("focusout", event => this._handleFocusOut(event));
		// manually handle hover effect on +/- icon, since css :hover applies to the entire row
		itemsTree.addEventListener("mousemove", event => this._handleItemsViewMouseMove(event));
		// handle backspace to remove an item from citation
		itemsTree.addEventListener("keypress", event => this._handleItemsViewKeyPress(event));
		this._refreshItemsViewHighlightedRows();
	}
	
	async _initCollectionTree() {
		const CollectionTree = require('zotero/collectionTree');
		this.collectionsView = await CollectionTree.init(_id('zotero-collections-tree'), {
			onSelectionChange: this._onCollectionSelection.bind(this),
			hideSources: ['duplicates', 'trash', 'feeds'],
			initialFolder: Zotero.Prefs.get("integration.citationDialogCollectionLastSelected"),
			onActivate: () => {}
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
		
		await this.itemsView.changeCollectionTreeRow({
			getItems: async () => {
				let items = await collectionTreeRow.getItems();
				// when citing notes, only keep notes or note parents
				if (isCitingNotes) {
					items = items.filter(item => item.isNote() || item.getNotes().length);
				}
				return items;
			},
			isSearch: () => true,
			isSearchMode: () => true,
			setSearch: str => collectionTreeRow.setSearch(str)
		});
		await this.itemsView.setFilter('search', SearchHandler.lastSearchValue);
		
		this.itemsView.clearItemsPaneMessage();
	}

	// Handle mouseup and mousedown events on a row in itemTree to enable clicking on +/- button
	// On mousedown, add .active effect to the +/- button
	// On mouseup, add/remove the clicked item from the citation
	// This specific handling is required, since :active effect fires on the row and not the child button
	_handleItemsViewRowClick(event) {
		// only trigger on left mouse click
		if (event.button !== 0) return;
		let row = event.target;
		// find which icon we hovered over
		let hoveredOverIcon = row.querySelector(".icon-action.hover");
		if (!hoveredOverIcon) return;
		if (event.type == "mouseup") {
			// fix height on bubble input  to make sure that a change in height
			// does not shift itemTree rows as one is clicking
			_id("bubble-input").setHeightLock(true);
			// fetch index from the row's id (e.g. item-tree-citationDialog-row-0)
			let rowIndex = row.id.split("-")[4];
			let clickedItem = this.itemsView.getRow(rowIndex).ref;
			hoveredOverIcon.classList.remove("active");
			if (hoveredOverIcon.parentNode.classList.contains("addToCitation")) {
				IOManager.addItemsToCitation([clickedItem], { noInputRefocus: true });
			}
			else if (hoveredOverIcon.parentNode.classList.contains("removeFromCitation")) {
				let citationItems = CitationDataManager.getItems({ zoteroItemID: clickedItem.id });
				for (let citationItem of citationItems) {
					let { dialogReferenceID } = citationItem;
					IOManager._deleteItem(dialogReferenceID);
				}
			}
		}
		else if (event.type == "mousedown") {
			hoveredOverIcon.classList.add("active");
		}
		// stop propagation to not select the row
		event.stopPropagation();
	}

	// Add .hover effect to +/- button when the mouse is above it
	// This  handling is required, since :hover effect fires on the row and not the actual button
	_handleItemsViewMouseMove(event) {
		let { clientY, clientX, target } = event;
		let actionIcons = [...event.target.querySelectorAll(".icon-action")];
		if (!actionIcons.length) return;
		// find which icon we hovered over
		let hoveredOverIcon = actionIcons.find((icon) => {
			let iconRect = icon.getBoundingClientRect();
			// event.target is the actual row, so check if the click happened
			// within the bounding box of the +/- icon and handle it same as a double click
			let overIcon = clientX > iconRect.left && clientX < iconRect.right
				&& clientY > iconRect.top && clientY < iconRect.bottom;
			return overIcon;
		});
		if (!target.classList.contains("row") || !hoveredOverIcon) {
			_id('zotero-items-tree').querySelector(".icon-action.hover")?.classList.remove("hover");
			_id('zotero-items-tree').querySelector(".icon-action.active")?.classList.remove("active");
			return;
		}
		hoveredOverIcon.classList.add("hover");
	}

	// backspace in itemsView deletes items from the citation
	_handleItemsViewKeyPress(event) {
		if (event.key == "Backspace") {
			let itemsToRemove = this.itemsView.getSelectedItems();
			for (let item of itemsToRemove) {
				let citationItems = CitationDataManager.getItems({ zoteroItemID: item.id });
				for (let citationItem of citationItems) {
					let { dialogReferenceID } = citationItem;
					IOManager._deleteItem(dialogReferenceID);
				}
			}
		}
	}

	// Highlight/de-highlight selected rows
	_refreshItemsViewHighlightedRows() {
		let selectedIDs = CitationDataManager.items.map(({ zoteroItem }) => zoteroItem.id).filter(id => !!id);
		this.itemsView.setHighlightedRows(selectedIDs);
	}

	// remove fixed height from bubble-input when focus leaves the itemTree
	async _handleFocusOut() {
		await Zotero.Promise.delay();
		if (!_id("zotero-items-tree").contains(doc.activeElement)) {
			_id("bubble-input").setHeightLock(false);
			// wait a moment for bubbles to resize and update window sizing
			await Zotero.Promise.delay(10);
			this.resizeWindow();
		}
	}

	_scrollHorizontallyOnWheel(event) {
		if (event.deltaY !== 0 && event.deltaX === 0) {
			_id("library-other-items").scrollLeft += event.deltaY;
			event.preventDefault();
		}
	}
}

class ListLayout extends Layout {
	constructor() {
		super("list");
	}

	// Create item node for an item group and store item ids in itemIDs attribute
	async createItemNode(item) {
		let itemNode = Helpers.createNode("div", { tabindex: "-1", "aria-describedby": "item-description", role: "option", "data-tabindex": 40, "data-arrow-nav-enabled": true }, "item hbox keyboard-clickable");
		let id = item.cslItemID || item.id;
		itemNode.setAttribute("itemID", id);
		itemNode.setAttribute("role", "option");
		itemNode.id = id;
		let itemInfo = Helpers.createNode("div", {}, "info");
		let icon = Helpers.createNode("span", {}, "icon icon-css icon-item-type");
		let dataTypeLabel = item.getItemTypeIconName(true);
		icon.setAttribute("data-item-type", dataTypeLabel);

		let title = Helpers.createNode("div", {}, "title");
		let description = Helpers.buildItemDescription(item);
		title.textContent = item.getDisplayTitle();

		itemInfo.append(title, description);
		itemNode.append(icon, itemInfo);
		return itemNode;
	}

	async refreshItemsList() {
		await super.refreshItemsList();

		// Hide the entire list layout if there is not a single item to show
		_id("list-layout").hidden = !_id("list-layout").querySelector(".section:not([hidden])");
		// Explicitly set the height of the container so the transition works when container is collapssed
		for (let container of [..._id("list-layout").querySelectorAll(".itemsContainer")]) {
			container.style.height = `${container.scrollHeight}px`;
		}
		this.resizeWindow();
	}

	updateSelectedItems() {
		let selectedIDs = new Set([...doc.querySelectorAll(".selected")].map(node => parseInt(node.getAttribute("itemID"))));
		for (let itemObj of CitationDataManager.items) {
			if (selectedIDs.has(itemObj.zoteroItem.id)) {
				itemObj.selected = true;
			}
			else {
				itemObj.selected = false;
			}
		}
		IOManager.updateBubbleInput();
	}

	resizeWindow() {
		// height of bubble-input
		let bubbleInputStyle = getComputedStyle(_id("search-row"));
		let bubbleInputMargins = parseInt(bubbleInputStyle.marginTop) + parseInt(bubbleInputStyle.marginBottom);
		let bubbleInputHeight = _id("search-row").getBoundingClientRect().height + bubbleInputMargins;

		// height of all sections
		let sectionsHeight = 0;
		for (let section of [..._id("list-layout").querySelectorAll(".section:not([hidden])")]) {
			sectionsHeight += section.getBoundingClientRect().height;
		}
		// cap at 400px
		sectionsHeight = Math.min(sectionsHeight, 400);

		// account for margins of the items list
		let sectionsWrapperStyle = getComputedStyle(_id("list-layout-wrapper"));
		let sectionsWrapperMargins = parseInt(sectionsWrapperStyle.marginTop) + parseInt(sectionsWrapperStyle.marginBottom);

		// height of the bottom section
		let bottomHeight = _id("bottom-area-wrapper").getBoundingClientRect().height;
		
		// set min height and resize the window
		let autoHeight = bubbleInputHeight + sectionsHeight + sectionsWrapperMargins + bottomHeight;
		let minHeight = bubbleInputHeight + bottomHeight + (_id("list-layout").hidden ? 0 : 80);
		doc.documentElement.style.minHeight = `${minHeight}px`;
		
		// Timeout is required likely to allow minHeight update to settle
		setTimeout(() => {
			window.resizeTo(window.innerWidth, parseInt(autoHeight));
		}, 10);
	}

	_markRoundedCorners() {
		let selectedGroupStarted = false;
		let previousRow;
		let items = [...doc.querySelectorAll(".item")];
		for (let rowIndex = 0; rowIndex < items.length; rowIndex++) {
			let row = items[rowIndex];
			row.classList.remove("selected-first", "selected-last");
			// stop if we reached the end of the container
			if (previousRow && selectedGroupStarted && row.parentNode !== previousRow.parentNode) {
				selectedGroupStarted = false;
				previousRow.classList.add("selected-last");
			}
			// mark the first item in a group of consecutively selected
			if (row.classList.contains("selected") && !selectedGroupStarted) {
				row.classList.add("selected-first");
				selectedGroupStarted = true;
			}
			// mark the last item in a group of consecutively selected
			if (!row.classList.contains("selected") && selectedGroupStarted && previousRow) {
				previousRow.classList.add("selected-last");
				selectedGroupStarted = false;
			}
			// if this is the last selected item, mark it as the last selected too
			if (row.classList.contains("selected") && rowIndex == items.length - 1) {
				row.classList.add("selected-last");
			}
			previousRow = row;
		}
	}
}

//
// Handling of user IO
//
const IOManager = {
	sectionExpandedStatus: {},

	init() {
		// handle input receiving focus or something being typed
		doc.addEventListener("handle-input", ({ detail: { query, debounce } }) => this._handleInput({ query, debounce }));
		// handle input keypress on an input of bubbleInput. It's handled here and not in bubbleInput
		// because we may need to set a locator or add a pre-selected item to the citation
		doc.addEventListener("input-enter", ({ detail: { input } }) => this._handleInputEnter(input));
		// handle a bubble being moved or deleted
		doc.addEventListener("delete-item", ({ detail: { dialogReferenceID } }) => this._deleteItem(dialogReferenceID));
		doc.addEventListener("move-item", ({ detail: { dialogReferenceID, index } }) => this._moveItem(dialogReferenceID, index));
		// display details popup for the bubble
		doc.addEventListener("show-details-popup", ({ detail: { dialogReferenceID } }) => this._openItemDetailsPopup(dialogReferenceID));
		// handle expansion of collapsed decks initiated from other components
		doc.addEventListener("expand-section", ({ detail: { section } }) => this.toggleSectionCollapse(section, "expanded"));
		// mark item nodes as selected to highlight them and mark relevant bubbles
		doc.addEventListener("select-items", ({ detail: { startNode, endNode } }) => this.selectItemNodesRange(startNode, endNode));
		
		// accept/cancel events emitted by keyboardHandler
		doc.addEventListener("dialog-accepted", accept);
		doc.addEventListener("dialog-cancelled", cancel);

		doc.addEventListener("DOMMenuBarActive", () => this._handleMenuBarAppearance());

		// after item details popup closes, item may have been updated, so refresh bubble input
		_id("itemDetails").addEventListener("popuphidden", () => this.updateBubbleInput());
		// if keep sorted was unchecked and then checked, resort items and update bubbles
		_id("keepSorted").addEventListener("change", () => this._resortItems());

		// set initial dialog mode and attach listener to button
		this._setInitialDialogMode();
		_id("mode-button").addEventListener("click", () => this.toggleDialogMode());

		// open settings popup on btn click
		_id("settings-button").addEventListener("click", event => _id("settings-popup").openPopup(event.target, "before_end"));
		// handle accept/cancel buttons
		_id("accept-button").addEventListener("click", accept);
		_id("cancel-button").addEventListener("click", cancel);

		// some additional logic to keep focus on relevant nodes during mouse interactions
		this._initFocusRetention();
	},

	// switch between list and library modes
	toggleDialogMode(newMode) {
		if (!newMode) {
			let mode = _id("mode-button").getAttribute("mode");
			newMode = mode == "library" ? "list" : "library";
		}
		_id("list-layout").hidden = newMode == "library";
		_id("library-layout").hidden = newMode == "list";

		// Delete all item nodes from the old layout
		for (let itemNode of [...doc.querySelectorAll(".item")]) {
			itemNode.remove();
		}

		_id("mode-button").setAttribute("mode", newMode);
		doc.l10n.setAttributes(_id("mode-button"), "integration-citationDialog-btn-mode", { mode: newMode });
		// save the library layout's height to restore it if we switch back
		if (currentLayout?.type == "library") {
			currentLayout.lastHeight = window.innerHeight;
		}

		currentLayout = newMode === "library" ? libraryLayout : listLayout;
		// do not show View menubar with itemTree-specific options in list mode
		doc.querySelector("item-tree-menu-bar").suppressed = currentLayout.type == "list";
		if (currentLayout.type == "list") {
			// when switching from library to list, make sure all selected items are de-selected
			libraryLayout.itemsView?.selection.clearSelection();
			currentLayout.updateSelectedItems();
		}
		else {
			// when switching to the library mode, invalidate collection tree to make sure
			// the selected row is properly rendered
			setTimeout(() => {
				libraryLayout.collectionsView?.tree.invalidate();
			});
		}
		currentLayout.refreshItemsList();
	},

	// pass current items in the citation to bubble-input to have it update the bubbles
	updateBubbleInput() {
		_id("bubble-input").refresh(CitationDataManager.items);
	},

	async addItemsToCitation(items, { noInputRefocus } = {}) {
		if (accepted || SearchHandler.searching) return;
		if (!Array.isArray(items)) {
			items = [items];
		}
		// if selecting a note, add it and immediately accept the dialog
		if (isCitingNotes) {
			if (!items[0].isNote()) return;
			CitationDataManager.items = [];
			await CitationDataManager.addItems({ citationItems: items });
			accept();
			return;
		}
		// Warn about retracted items, if any are present
		for (let item of items) {
			if (!Zotero.Retractions.shouldShowCitationWarning(item)) continue;
			let canProceed = PopupsHandler.showRetractedWarning(item);
			// User did not select "Continue", so just stop
			if (!canProceed) return;
		}
		
		// If multiple items are being added, only add ones that are not included in the citation
		if (items.length > 1) {
			items = items.filter(item => !CitationDataManager.getItems({ zoteroItemID: item.id }).length);
		}

		// If the last input has a locator, add it into the item
		let input = _id("bubble-input").getCurrentInput();
		let locator = Helpers.extractLocator(input.value || "");
		if (locator) {
			for (let item of items) {
				item.label = locator.label;
				item.locator = locator.locator;
			}
		}
		// Add the item at a position based on current input
		let bubblePosition = null;
		if (input) {
			bubblePosition = _id("bubble-input").getFutureBubbleIndex();
			input.remove();
		}
		await CitationDataManager.addItems({ citationItems: items, index: bubblePosition });
		// Refresh the itemTree if in library mode
		if (currentLayout.type == "library") {
			libraryLayout.refreshItemsView();
		}

		this.updateBubbleInput();
		// Always refresh items list to make sure the opened and selected items are up to date
		currentLayout.refreshItemsList();
		if (!noInputRefocus) {
			_id("bubble-input").refocusInput();
		}
	},

	// Mark initially selected item that can be selected on Enter in an input
	markPreSelected() {
		for (let itemNode of [...doc.querySelectorAll(".selected")]) {
			itemNode.classList.remove("selected");
			itemNode.classList.remove("current");
		}
		let firstItemNode = _id(`${currentLayout.type}-layout`).querySelector(`.item`);
		let somethingIsTyped = _id("bubble-input").isSomethingTyped();
		if (!somethingIsTyped || !firstItemNode) return;
		firstItemNode.classList.add("current");
		_id("bubble-input").ariaSetCurrentItem(firstItemNode.id);
		this.selectItemNodesRange(firstItemNode);
	},

	// select all items between startNode and endNode
	selectItemNodesRange(startNode, endNode = null) {
		let itemNodes = [...doc.querySelectorAll(".item")];
		for (let node of itemNodes) {
			node.classList.remove("selected");
		}
		if (startNode === null) return;

		// handle special case if one of the nodes is a container of items
		if (startNode.classList.contains("itemsContainer")) {
			let items = [...startNode.querySelectorAll(".item")];
			startNode = items[0];
			endNode = endNode || items[items.length - 1];
		}
		if (endNode && endNode.classList.contains("itemsContainer")) {
			let items = [...endNode.querySelectorAll(".item")];
			endNode = items[0];
		}
		let startIndex = itemNodes.indexOf(startNode);
		let endIndex = endNode ? itemNodes.indexOf(endNode) : startIndex;

		// if startIndex is after endIndex, just swap them
		if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];

		for (let i = startIndex; i <= endIndex; i++) {
			IOManager.toggleItemNodeSelect(itemNodes[i], true);
		}
		currentLayout.updateSelectedItems();
	},

	toggleItemNodeSelect(itemNode, isSelected = null) {
		if (isSelected === true) {
			itemNode.classList.add("selected");
		}
		else if (isSelected === false) {
			itemNode.classList.remove("selected");
		}
		else {
			itemNode.classList.toggle("selected");
		}
		currentLayout.updateSelectedItems();
		if (currentLayout.type == "list") {
			listLayout._markRoundedCorners();
		}
	},

	handleItemClick(event) {
		let targetItem = event.target.closest(".item");
		let isMultiselectable = !!targetItem.closest("[data-multiselectable]");
		// Cmd/Ctrl + mouseclick toggles selected item node
		if (isMultiselectable && (Zotero.isMac && event.metaKey) || (!Zotero.isMac && event.ctrlKey)) {
			targetItem.focus();
			IOManager.toggleItemNodeSelect(targetItem);
			return;
		}
		// Shift + click selects a range
		if (isMultiselectable && event.shiftKey) {
			let itemNodes = [..._id(`${currentLayout.type}-layout`).querySelectorAll(".item")];
			let firstNode = _id(`${currentLayout.type}-layout`).querySelector(".item.selected") || itemNodes[0];
			IOManager.selectItemNodesRange(firstNode, targetItem);
			return;
		}
		// get itemIDs associated with the nodes
		let itemIDs = new Set([targetItem.getAttribute("itemID")]);
		// if target item is selected, add all other selected itemIDs
		if (targetItem.classList.contains("selected")) {
			let selectedItemNodes = _id(`${currentLayout.type}-layout`).querySelectorAll(".item.selected");
			for (let itemNode of selectedItemNodes) {
				itemIDs.add(itemNode.getAttribute("itemID"));
			}
		}
		let itemsToAdd = Array.from(itemIDs).map(itemID => SearchHandler.getItem(itemID));
		IOManager.addItemsToCitation(itemsToAdd);
	},

	handleCollapsibleSectionHeaderClick(section, event) {
		IOManager.toggleSectionCollapse(section);
		// Record if the user explicitly expanded or collapsed the section to not undo it
		// during next refresh
		IOManager.sectionExpandedStatus[section.id] = section.classList.contains("expanded") ? "expanded" : "collapsed";
		// When section is expanded by a click via keyboard, navigate into the section
		if (IOManager._clicked !== event.target && section.classList.contains("expanded")) {
			KeyboardHandler.navigateGroup({ group: section, current: null, forward: true, shouldSelect: true, shouldFocus: true, multiSelect: false });
		}
	},

	toggleSectionCollapse(section, status) {
		// set desired class
		if (status == "expanded" && !section.classList.contains("expanded")) {
			section.classList.add("expanded");
		}
		else if (status == "collapsed" && section.classList.contains("expanded")) {
			section.classList.remove("expanded");
		}
		else if (!status) {
			section.classList.toggle("expanded");
		}
		// mark collapsed items as unfocusable
		if (section.classList.contains("expandable") && !section.classList.contains("expanded")) {
			for (let item of [...section.querySelectorAll(".item")]) {
				item.removeAttribute("tabindex");
				item.classList.remove("current");
			}
			// in library, the items deck itself becomes focusable
			if (currentLayout.type == "library") {
				section.querySelector(".itemsContainer").setAttribute("tabindex", -1);
				section.querySelector(".itemsContainer").dataset.arrowNavEnabled = true;
			}
		}
		// when expanded, make them focusable again
		else {
			for (let item of [...section.querySelectorAll(".item")]) {
				item.setAttribute("tabindex", -1);
			}
			if (currentLayout.type == "library") {
				let container = section.querySelector(".itemsContainer");
				container.removeAttribute("tabindex");
				container.classList.remove("selected", "current");
			}
		}
	},

	// Handle Enter keypress on an input. If a locator has been typed, add it to previous bubble.
	// Otherwise, add pre-selected item if any. Otherwise, accept the dialog.
	_handleInputEnter(input) {
		let locator = Helpers.extractLocator(input.value);
		let bubble = input.previousElementSibling;
		let item = CitationDataManager.getItem({ dialogReferenceID: bubble?.getAttribute("dialogReferenceID") });
		if (item && locator && locator.onlyLocator && bubble) {
			item.citationItem.locator = locator.locator;
			item.citationItem.label = locator.label;
			input.value = "";
			this.updateBubbleInput();
			return;
		}
		// add whatever items are selected
		if (doc.querySelector(".item.selected")) {
			let selectedIDs = [...doc.querySelectorAll(".item.selected")].map(node => node.getAttribute("itemID"));
			let items = selectedIDs.map(id => SearchHandler.getItem(id));
			IOManager.addItemsToCitation(items);
		}
		// if there are no selected items in library mode and something was searched for add the first row from items table
		else if (currentLayout.type == "library" && libraryLayout.itemsView.rowCount > 0 && input.value.length) {
			let firstRowID = libraryLayout.itemsView.getRow(0).ref.id;
			IOManager.addItemsToCitation(Zotero.Items.get(firstRowID));
		}
		// Enter on an empty input accepts the dialog
		else if (!input.value.length) {
			accept();
		}
	},

	_deleteItem(dialogReferenceID) {
		CitationDataManager.deleteItem({ dialogReferenceID });
		if (currentLayout.type == "library") {
			libraryLayout.refreshItemsView();
		}
		this.updateBubbleInput();
		// Always refresh items list to make sure the opened and selected items are up to date
		currentLayout.refreshItemsList();
		// if the focus was lost (e.g. after clicking on the X icon of a bubble)
		// try to return focus to previously-focused node
		setTimeout(() => {
			// timeout needed to handle deleteing the bubble from itemDetails popup
			if (doc.activeElement.tagName == "body") {
				IOManager._restorePreClickFocus();
			}
		});
	},

	_moveItem(dialogReferenceID, newIndex) {
		let moved = CitationDataManager.moveItem(dialogReferenceID, newIndex);
		if (moved) {
			_id("keepSorted").checked = false;
		}
		this.updateBubbleInput();
	},

	_openItemDetailsPopup(dialogReferenceID) {
		let { zoteroItem, citationItem } = CitationDataManager.getItem({ dialogReferenceID });
		PopupsHandler.openItemDetails(dialogReferenceID, zoteroItem, citationItem, Helpers.buildItemDescription(zoteroItem));
	},

	_handleInput({ query, debounce }) {
		// Do not rerun search if the search value is the same
		// (e.g. focus returns into the last input)
		if (query == SearchHandler.lastSearchValue) return;
		// If there is a locator typed, exclude it from the query
		let locator = Helpers.extractLocator(query);
		if (locator) {
			query = query.replace(locator.fullLocatorString, "");
		}
		// Run search within the current layout
		if (debounce) {
			currentLayout.searchDebounced(query);
		}
		else {
			currentLayout.search(query);
		}
	},

	_handleMenuBarAppearance() {
		if (Zotero.isMac) return;
		let bottomAreaBox = _id("bottom-area-wrapper").getBoundingClientRect();
		// if the bottom-area was pushed outside of the bounds of the window by itemTree's menubar
		// increase the window's width a bit so it is still accessible.
		// + 1 is the margin of safety needed to account for tiny differences in positioning
		// (e.g. on windows, bottomAreaBox.bottom may have a decimal)
		if (bottomAreaBox.bottom > window.innerHeight + 1) {
			window.resizeTo(window.innerWidth, window.innerHeight + 30);
		}
	},

	// Resort items and update the bubbles
	_resortItems() {
		if (!_id("keepSorted").checked) return;
		CitationDataManager.sort().then(() => {
			this.updateBubbleInput();
		});
	},

	// Set the initial dialog mode per user's preference
	_setInitialDialogMode() {
		let desiredMode = Zotero.Prefs.get("integration.citationDialogMode");
		if (desiredMode == "last-closed") {
			desiredMode = Zotero.Prefs.get("integration.citationDialogLastClosedMode");
		}
		this.toggleDialogMode(desiredMode);
	},

	// Return focus to where it was before click moved focus.
	// If it's not possible, refocus the last input in bubble-input so that
	// focus is not just lost.
	_restorePreClickFocus() {
		if (doc.contains(IOManager._focusedBeforeClick)) {
			IOManager._focusedBeforeClick.focus();
			return;
		}
		_id("bubble-input").refocusInput();
	},

	// We want to not place focus on some of the focusable nodes on mouse click.
	// These listeners try to keep focus on main components of the interface for
	// a more consistent navigation.
	_initFocusRetention() {
		IOManager._noRefocusing = null;
		IOManager._focusBeforePanelShow = null;
		IOManager._clicked = null;
		IOManager._focusedBeforeClick = null;

		// When focus changes, check if the newly focused node is the node that was last clicked.
		// If so, return focus to whatever  node was focused before the click.
		// That way, one can click a button without moving focus onto it.
		doc.addEventListener("focusout", (_) => {
			setTimeout(() => {
				// bubble-input and itemTree/collectionTree are the main interactable elements,
				// so don't move focus from them
				if (_id("bubble-input").contains(doc.activeElement)) return;
				if (_id("library-trees").contains(doc.activeElement)) return;
				if (IOManager._noRefocusing) return;
				let focused = doc.activeElement;
				if (focused.contains(IOManager._clicked) && !focused.closest("panel")) {
					IOManager._restorePreClickFocus();
				}
			});
		});
		// Record which node was last clicked for the focusout handler above
		doc.addEventListener("mousedown", (event) => {
			if (event.target.closest("panel")) return;
			IOManager._clicked = event.target;
			IOManager._focusedBeforeClick = doc.activeElement;
		});
		// Clear record of last clicked node if some other interaction happened (e.g. keydown)
		doc.addEventListener("keydown", (event) => {
			if (event.target.closest("panel")) return;
			IOManager._clicked = null;
		});

		// When a popup is appearing after click, record which node was focused before click happened
		doc.addEventListener("popupshowing", (event) => {
			if (!["xul:panel"].includes(event.target.tagName)) return;
			IOManager._noRefocusing = true;
			IOManager._focusBeforePanelShow = null;
			if (doc.activeElement.contains(IOManager._clicked)) {
				IOManager._focusBeforePanelShow = IOManager._focusedBeforeClick;
			}
		});
		// When the popup is closed, return focus to where it was before the popup was
		// opened by click.
		doc.addEventListener("popuphidden", (event) => {
			let popup = event.target;
			if (!["xul:panel"].includes(popup.tagName)) return;
			IOManager._noRefocusing = false;
			// after item details popup closes on Enter, refocus the last input
			if (popup.id == "itemDetails" && popup.getAttribute("refocus-input")) {
				_id("bubble-input").refocusInput();
				popup.removeAttribute("refocus-input");
				return;
			}
			if (IOManager._focusBeforePanelShow) {
				IOManager._focusBeforePanelShow.focus();
			}
			IOManager._focusBeforePanelShow = null;
		});
	}
};

//
// Singleton to store and handle items in this citation.
// CitationDataManager.items is an array of { zoteroItem, citationItem } objects,
// where zoteroItem is Zotero.Item and citationItem is a citation item provided by io.
// They are stored as a pair to make it easier to access both item properties (e.g. item.getDisplayTitle())
// and properties of citation item (e.g. locator) across different components.
//
const CitationDataManager = {
	items: [],
	itemAddedCache: new Set(),

	getCitationItems() {
		return this.items.map(item => item.citationItem);
	},

	getItem({ dialogReferenceID }) {
		return this.items.find(item => item.dialogReferenceID === dialogReferenceID);
	},

	getItems({ zoteroItemID }) {
		return this.items.filter(item => item.zoteroItem.id === zoteroItemID);
	},

	getItemIndex({ dialogReferenceID }) {
		return this.items.findIndex(item => item.dialogReferenceID === dialogReferenceID);
	},

	updateItemAddedCache() {
		this.itemAddedCache = new Set();
		for (let { zoteroItem } of this.items) {
			if (!zoteroItem.id) continue;
			this.itemAddedCache.add(zoteroItem.id);
		}
	},
	
	// Include specified items into the citation
	async addItems({ citationItems = [], index = null }) {
		for (let item of citationItems) {
			let zoteroItem = this._citationItemToZoteroItem(item);
			// Add a new ID to our citation item and set the same ID on the bubble
			// so we have a reliable way to identify which bubble refers to which citationItem.
			let dialogReferenceID = Zotero.Utilities.randomString(5);
			let toInsert = { citationItem: item, zoteroItem: zoteroItem, dialogReferenceID };
			if (index !== null) {
				this.items.splice(index, 0, toInsert);
				index += 1;
			}
			else {
				this.items.push(toInsert);
			}
		}
		await this.sort();
		this.updateItemAddedCache();
	},

	deleteItem({ dialogReferenceID }) {
		let index = this.getItemIndex({ dialogReferenceID });
		if (index === -1) {
			throw new Error("Item to delete not found");
		}
		this.items.splice(index, 1);
		this.updateItemAddedCache();
	},

	moveItem(dialogReferenceID, newIndex) {
		let currentIndex = CitationDataManager.getItemIndex({ dialogReferenceID });
		if (currentIndex === newIndex) return false;
		let [obj] = this.items.splice(currentIndex, 1);
		this.items.splice(newIndex, 0, obj);
		return true;
	},

	// Update io citation object based on Citation.items array
	updateCitationObject(final = false) {
		let result = [];
		for (let item of this.items) {
			let dialogReferenceID = item.dialogReferenceID;
			item = item.citationItem;
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
				result.push(ioResult);
			}
			else {
				result.push(item);
			}
			if (!final) {
				result[result.length - 1].dialogReferenceID = dialogReferenceID;
			}
		}
		io.citation.citationItems = result;

		if (final && io.sortable) {
			io.citation.properties.unsorted = !_id("keepSorted").checked;
		}
	},

	// Resorts the items in the citation
	async sort() {
		if (!_id("keepSorted").checked) return;
		this.updateCitationObject();
		await io.sort();
		// sync the order of this.items with io.citation.sortedItems
		let sortedIOItems = io.citation.sortedItems.map(entry => entry[1]);
		let sortedItems = sortedIOItems.map((sortedItem) => {
			return this.items.find(item => item.dialogReferenceID === sortedItem.dialogReferenceID);
		});
		this.items = sortedItems;
	},
	
	// Construct citation upon initial load
	async buildCitation() {
		if (!io.citation.properties.unsorted
				&& _id("keepSorted").checked
				&& io.citation.sortedItems?.length) {
			await this.addItems({ citationItems: io.citation.sortedItems.map(entry => entry[1]) });
		}
		else {
			await this.addItems({ citationItems: io.citation.citationItems });
		}
	},

	// Check if two given items are the same to prevent an item being inserted more
	// than once into the citation. Compare firstCreator and title fields, instead of just
	// itemIDs to account for cited items that may not have ids.
	potentialDuplicateExists(targetZoteroItem) {
		if (!(targetZoteroItem instanceof Zotero.Item)) {
			targetZoteroItem = this._citationItemToZoteroItem(targetZoteroItem);
		}
		for (let item of this.items) {
			let sameCreator = item.zoteroItem.getField("firstCreator") === targetZoteroItem.getField("firstCreator");
			let sameTitle = item.zoteroItem.getDisplayTitle() === targetZoteroItem.getDisplayTitle();
			if (sameCreator && sameTitle) return true;
		}
		return false;
	},

	// check if items have the same id, comparing .cslItemID for cited items or .id for
	// usual items
	_itemsHaveSameID(itemOne, itemTwo) {
		let itemOneID = itemOne.cslItemID || itemOne.id;
		let itemTwoID = itemTwo.cslItemID || itemTwo.id;
		if (!itemOneID || !itemTwoID) return false;
		return itemOneID == itemTwoID;
	},

	// Shortcut to fetch Zotero.Item based on citationItem
	_citationItemToZoteroItem(citationItem) {
		if (citationItem instanceof Zotero.Item) return citationItem;
		if (io.customGetItem) {
			let item = io.customGetItem(citationItem);
			if (item) return item;
		}
		if (citationItem.id) {
			return Zotero.Cite.getItem(citationItem.id);
		}
		return null;
	}
};

// Top level listeners
window.addEventListener("load", onLoad);
// When the dialog is re-focused, run the search again in case selected or opened items changed
window.addEventListener("focus", () => currentLayout.search(SearchHandler.lastSearchValue));
