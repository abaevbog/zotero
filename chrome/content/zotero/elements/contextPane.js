/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2024 Corporation for Digital Scholarship
					 Vienna, Virginia, USA
					 https://www.zotero.org
	
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


{
	class ContextPane extends XULElementBase {
		content = MozXULElement.parseXULToFragment(`
			<deck id="zotero-context-pane-deck" flex="1" selectedIndex="0">
				<deck id="zotero-context-pane-item-deck"></deck>
				<deck id="zotero-context-pane-notes-deck" class="notes-pane-deck" flex="1"></deck>
			</deck>
		`);

		get sidenav() {
			return this._sidenav;
		}

		set sidenav(sidenav) {
			this._sidenav = sidenav;
			// TODO: decouple sidenav and contextPane
			sidenav.contextNotesPane = this._notesPaneDeck;
		}

		get viewType() {
			return ["item", "notes"][this._panesDeck.getAttribute('selectedIndex')];
		}

		set viewType(viewType) {
			let viewTypeMap = {
				item: "0",
				notes: "1",
			};
			if (!(viewType in viewTypeMap)) {
				throw new Error(`ContextPane.viewType must be one of ["item", "notes"], but got ${viewType}`);
			}
			this._panesDeck.setAttribute("selectedIndex", viewTypeMap[viewType]);
		}

		init() {
			this._panesDeck = this.querySelector('#zotero-context-pane-deck');
			// Item pane deck
			this._itemPaneDeck = this.querySelector('#zotero-context-pane-item-deck');
			// Notes pane deck
			this._notesPaneDeck = this.querySelector('#zotero-context-pane-notes-deck');

			this._notifierID = Zotero.Notifier.registerObserver(this, ['item', 'tab'], 'contextPane');
		}

		destroy() {
			Zotero.Notifier.unregisterObserver(this._notifierID);
		}

		notify(action, type, ids, extraData) {
			if (type == 'item') {
				this._handleItemUpdate(action, type, ids, extraData);
				return;
			}
			if (type == 'tab' && action == 'add') {
				this._handleTabAdd(action, type, ids, extraData);
				return;
			}
			if (type == 'tab' && action == 'close') {
				this._handleTabClose(action, type, ids, extraData);
				return;
			}
			if (type == 'tab' && action == 'select') {
				this._handleTabSelect(action, type, ids, extraData);
			}
		}

		_handleItemUpdate(action, type, ids, extraData) {
			// Update, remove or re-create item panes
			for (let itemDetails of Array.from(this._itemPaneDeck.children)) {
				let item = itemDetails.item;
				let tabID = itemDetails.dataset.tabId;
				if (!item) {
					this._removeItemContext(tabID);
				}
				else if (item.parentID != itemDetails.parentID) {
					this._removeItemContext(tabID);
					this._addItemContext(tabID, item.itemID);
				}
			}

			// Update notes lists for affected libraries
			let libraryIDs = [];
			for (let id of ids) {
				let item = Zotero.Items.get(id);
				if (item && (item.isNote() || item.isRegularItem())) {
					libraryIDs.push(item.libraryID);
				}
				else if (action == 'delete') {
					libraryIDs.push(extraData[id].libraryID);
				}
			}
			for (let context of Array.from(this._notesPaneDeck.children)) {
				if (libraryIDs.includes(context.libraryID)) {
					context.affectedIDs = new Set([...context.affectedIDs, ...ids]);
					context.update();
				}
			}
		}

		_handleTabAdd(action, type, ids, extraData) {
			let data = extraData[ids[0]];
			this._addItemContext(ids[0], data.itemID, data.type);
		}

		_handleTabClose(action, type, ids) {
			this._removeItemContext(ids[0]);
			if (Zotero_Tabs.deck.children.length == 1) {
				Array.from(this._notesPaneDeck.children).forEach(x => x.notesList.expanded = false);
			}
			// Close tab specific notes if tab id no longer exists, but
			// do that only when unloaded tab is reloaded
			setTimeout(() => {
				let contextNodes = Array.from(this._notesPaneDeck.children);
				for (let contextNode of contextNodes) {
					let nodes = Array.from(contextNode.querySelector('.zotero-context-pane-tab-notes-deck').children);
					for (let node of nodes) {
						let tabID = node.getAttribute('data-tab-id');
						if (!document.getElementById(tabID)) {
							node.remove();
						}
					}
				}
				// For unknown reason fx102, unlike 60, sometimes doesn't automatically update selected index
				this._selectItemContext(Zotero_Tabs.selectedID);
			});
		}

		_handleTabSelect(action, type, ids) {
			// TEMP: move these variables to ZoteroContextPane
			let _contextPaneSplitter = document.getElementById('zotero-context-splitter');
			let _contextPane = document.getElementById('zotero-context-pane');
			// It seems that changing `hidden` or `collapsed` values might
			// be related with significant slow down when there are too many
			// DOM nodes (i.e. 10k notes)
			if (Zotero_Tabs.selectedType == 'library') {
				_contextPaneSplitter.setAttribute('hidden', true);
				_contextPane.setAttribute('collapsed', true);
				ZoteroContextPane.showTabCover(false);
				this._sidenav.hidden = true;
			}
			else if (Zotero_Tabs.selectedType == 'reader') {
				let currentNoteContext = this._getCurrentNotesContext();
				currentNoteContext?._cacheViewType();

				let reader = Zotero.Reader.getByTabID(Zotero_Tabs.selectedID);
				this._handleReaderReady(reader);
			
				_contextPaneSplitter.setAttribute('hidden', false);

				_contextPane.setAttribute('collapsed', !(_contextPaneSplitter.getAttribute('state') != 'collapsed'));
				// It seems that on heavy load (i.e. syncing) the line below doesn't set the correct value,
				// therefore we repeat the same operation at the end of JS message queue
				setTimeout(() => {
					_contextPane.setAttribute('collapsed', !(_contextPaneSplitter.getAttribute('state') != 'collapsed'));
				});
				
				this._sidenav.hidden = false;
			}

			this._selectItemContext(ids[0]);
			ZoteroContextPane.update();
		}

		async _handleReaderReady(reader) {
			if (!reader) {
				return;
			}
			ZoteroContextPane.showTabCover(true);
			await reader._initPromise;
			ZoteroContextPane.showTabCover(false);
			// Focus reader pages view if context pane note editor is not selected
			if (Zotero_Tabs.selectedID == reader.tabID
				&& !Zotero_Tabs.isTabsMenuVisible()
				&& (!document.activeElement
					|| !document.activeElement.closest('.context-node iframe[id="editor-view"]'))) {
				if (!Zotero_Tabs.focusOptions?.keepTabFocused) {
					// Do not move focus to the reader during keyboard navigation
					reader.focus();
				}
			}
			
			let attachment = await Zotero.Items.getAsync(reader.itemID);
			if (attachment) {
				this._selectNotesContext(attachment.libraryID);
				let notesContext = this._getNotesContext(attachment.libraryID);
				notesContext.updateFromCache();
			}

			let currentNoteContext = this._getCurrentNotesContext();
			let tabNotesDeck = currentNoteContext.querySelector('.zotero-context-pane-tab-notes-deck');
			let selectedIndex = Array.from(tabNotesDeck.children).findIndex(x => x.getAttribute('data-tab-id') == reader.tabID);
			if (selectedIndex != -1) {
				tabNotesDeck.setAttribute('selectedIndex', selectedIndex);
				currentNoteContext.viewType = "childNote";
			}
			else {
				currentNoteContext._restoreViewType();
			}
		}

		_getCurrentNotesContext() {
			return this._notesPaneDeck.selectedPanel;
		}

		_getNotesContext(libraryID) {
			let context = Array.from(this._notesPaneDeck.children).find(x => x.libraryID == libraryID);
			if (!context) {
				context = this._addNotesContext(libraryID);
			}
			return context;
		}

		_addNotesContext(libraryID) {
			let context = new (customElements.get("notes-context"));
			this._notesPaneDeck.append(context);
			context.libraryID = libraryID;
			return context;
		}

		_selectNotesContext(libraryID) {
			let context = this._getNotesContext(libraryID);
			this._notesPaneDeck.selectedPanel = context;
		}

		_removeNotesContext(libraryID) {
			let context = Array.from(this._notesPaneDeck.children).find(x => x.libraryID == libraryID);
			context?.remove();
		}

		_getActiveEditor() {
			let currentContext = this._getCurrentNotesContext();
			return currentContext?._getCurrentEditor();
		}

		_getItemContext(tabID) {
			return this._itemPaneDeck.querySelector(`[data-tab-id="${tabID}"]`);
		}

		_removeItemContext(tabID) {
			this._itemPaneDeck.querySelector(`[data-tab-id="${tabID}"]`).remove();
		}
	
		_selectItemContext(tabID) {
			let previousPinnedPane = this._sidenav.container?.pinnedPane || "";
			let selectedPanel = this._getItemContext(tabID);
			if (selectedPanel) {
				this._itemPaneDeck.selectedPanel = selectedPanel;
				selectedPanel.sidenav = this._sidenav;
				if (previousPinnedPane) selectedPanel.pinnedPane = previousPinnedPane;
			}
		}
	
		async _addItemContext(tabID, itemID, tabType = "") {
			let { libraryID } = Zotero.Items.getLibraryAndKeyFromID(itemID);
			let library = Zotero.Libraries.get(libraryID);
			await library.waitForDataLoad('item');
	
			let item = Zotero.Items.get(itemID);
			if (!item) {
				return;
			}
			libraryID = item.libraryID;
			let readOnly = !Zotero.Libraries.get(libraryID).editable;
			let parentID = item.parentID;
	
			let previousPinnedPane = this._sidenav.container?.pinnedPane || "";
			
			let targetItem = parentID ? Zotero.Items.get(parentID) : item;
	
			let itemDetails = document.createXULElement('item-details');
			itemDetails.id = tabID + '-context';
			itemDetails.dataset.tabId = tabID;
			itemDetails.className = 'zotero-item-pane-content';
			this._itemPaneDeck.appendChild(itemDetails);
	
			itemDetails.mode = readOnly ? "view" : null;
			itemDetails.item = targetItem;
			// Manually cache parentID
			itemDetails.parentID = parentID;
			itemDetails.sidenav = this._sidenav;
			if (previousPinnedPane) itemDetails.pinnedPane = previousPinnedPane;
	
			// `unloaded` tabs are never selected and shouldn't be rendered on creation.
			// Use `includes` here for forward compatibility.
			if (!tabType.includes("unloaded")) {
				this._selectItemContext(tabID);
			}
		}
	
		_focus() {
			let splitter = ZoteroContextPane.getSplitter();
			let node;
	
			if (splitter.getAttribute('state') != 'collapsed') {
				if (this.viewType == "item") {
					node = this._itemPaneDeck.selectedPanel;
					node.focus();
					return true;
				}
				else {
					this._getCurrentNotesContext()?.focus();
				}
			}
			return false;
		}
	}
	customElements.define("context-pane", ContextPane);
}