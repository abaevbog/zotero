/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
				     George Mason University, Fairfax, Virginia, USA
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
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
Services.scriptloader.loadSubScript("chrome://zotero/content/customElements.js", this);

var Zotero_QuickFormat = new function () {
	const pixelRe = /^([0-9]+)px$/
	const specifiedLocatorRe = /^(?:,? *(p{1,2})(?:\. *| *)|:)([0-9\-]+) *$/;
	const yearRe = /,? *([0-9]+) *(B[. ]*C[. ]*(?:E[. ]*)?|A[. ]*D[. ]*|C[. ]*E[. ]*)?$/i;
	const locatorRe = / (?:,? *(p{0,2})\.?|(\:)) *([0-9\-–]+)$/i;
	const creatorSplitRe = /(?:,| *(?:and|\&)) +/;
	const charRe = /[\w\u007F-\uFFFF]/;
	const numRe = /^[0-9\-–]+$/;
	
	var initialized, io, qfs, qfe, qfb, qfGuidance,
		keepSorted, showEditor, referencePanel, referenceBox, referenceHeight = 0,
		separatorHeight = 0, currentLocator, currentLocatorLabel, currentSearchTime, dragPlaceholder,
		panel, panelPrefix, panelSuffix, panelSuppressAuthor, panelLocatorLabel, panelLocator,
		panelLibraryLink, panelInfo, panelRefersToBubble, panelFrameHeight = 0, accepted = false,
		isPaste = false, lastEnter, lastEscape, throttleEscape = false, throttleEnter = false;
	var locatorLocked = true;
	var locatorNode = null;
	var _searchPromise;
	var _lastFocusedInput = null;
	
	const SEARCH_TIMEOUT = 250;
	const SHOWN_REFERENCES = 7;
	const WINDOW_WIDTH = 800;
	// Only one Enter/Escape keypress within this time window is processed to prevent
	// accidental double clicks from closing the dialog
	const MILISECONDS_BETWEEN_KEYPRESSES = 1000;

	/**
	 * Pre-initialization, when the dialog has loaded but has not yet appeared
	 */
	this.onDOMContentLoaded = function(event) {
		if(event.target === document) {
			initialized = true;
			io = window.arguments[0].wrappedJSObject;

			Zotero.debug(`Quick Format received citation:`);
			Zotero.debug(JSON.stringify(io.citation.toJSON()));
			
			if (io.disableClassicDialog) {
				document.getElementById('classic-view').hidden = true;
			}
			
			// Only hide chrome on Windows or Mac
			if(Zotero.isMac) {
				document.documentElement.setAttribute("drawintitlebar", true);
			} else if(Zotero.isWin) {
				document.documentElement.setAttribute("hidechrome", true);
			}
			
			// Include a different key combo in message on Mac
			if(Zotero.isMac) {
				var qf = document.querySelector('.citation-dialog.guidance');
				qf && qf.setAttribute('about', qf.getAttribute('about') + "Mac");
			}
			
			new WindowDraggingElement(document.querySelector("window.citation-dialog"), window);
			
			qfs = document.querySelector(".citation-dialog.search");
			qfb = document.querySelector(".citation-dialog.entry");
			qfe = document.querySelector(".citation-dialog.editor");
			qfb.addEventListener("click", _onQuickSearchClick, false);
			qfb.addEventListener("keypress", _onQuickSearchKeyPress, false);
			qfe.addEventListener("dragover", _onBubbleDragOver);
			qfe.addEventListener("drop", _onBubbleDrop, false);
			qfbHeight = qfb.scrollHeight;
			referencePanel = document.querySelector(".citation-dialog.reference-panel");
			referenceBox = document.querySelector(".citation-dialog.reference-list");
			// Explicitly set the focused reference as the selected item. Screenreaders may focus
			// on the richlistitem, announce it but not actually select it.
			referenceBox.addEventListener('focus', (_) => {
				if (!_sameZoteroItem(document.activeElement, referenceBox.selectedItem)) {
					referenceBox.selectedItem = document.activeElement;
				}
			}, true);
			// Navigation within the reference panel
			referenceBox.addEventListener("keypress", (event) => {
				// Enter or ; selects the reference
				if (event.key == "Enter" || event.charCode == 59) {
					event.preventDefault();
					event.stopPropagation();
					event.target.closest("richlistitem").click();
				}
				// Tab will move focus back to the input field
				else if (event.key === "Tab") {
					event.preventDefault();
					event.stopPropagation();
					_lastFocusedInput.focus();
				}
				// Can keep typing from the reference box
				else if (event.key.length === 1 || event.key === 'Backspace') {
					event.preventDefault();
					if (event.key === 'Backspace') {
						_lastFocusedInput.value = _lastFocusedInput.value.slice(0, -1);
					}
					else {
						_lastFocusedInput.value += event.key;
					}
					_lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
					_lastFocusedInput.focus();
				}
			});
			if (Zotero.isWin) {
				referencePanel.style.marginTop = "-29px";
				if (Zotero.Prefs.get('integration.keepAddCitationDialogRaised')) {
					qfb.setAttribute("square", "true");
				}
			}
			// With fx60 and drawintitlebar=true Firefox calculates the minHeight
			// as titlebar+maincontent, so we have hack around that here.
			else if (Zotero.isMac) {
				qfb.style.marginBottom = "-28px";
			}
			
			keepSorted = document.getElementById("keep-sorted");
			showEditor = document.getElementById("show-editor");
			if(keepSorted && io.sortable) {
				keepSorted.hidden = false;
				if(!io.citation.properties.unsorted) {
					keepSorted.setAttribute("checked", "true");
				}
			}
			// Make icon focusable only if there's a visible menuitem
			for (let menuitemID of ["keep-sorted", "show-editor", "classic-view"]) {
				if (document.getElementById(menuitemID).getAttribute("hidden") != "true") {
					document.getElementById("zotero-icon").removeAttribute("disabled");
				}
			}
			// Nodes for citation properties panel
			panel = document.getElementById("citation-properties");
			if (panel) {
				panelPrefix = document.getElementById("prefix");
				panelSuffix = document.getElementById("suffix");
				panelSuppressAuthor = document.getElementById("suppress-author");
				panelLocatorLabel = document.getElementById("locator-label");
				panelLocator = document.getElementById("locator");
				panelInfo = document.getElementById("citation-properties-info");
				panelLibraryLink = document.getElementById("citation-properties-library-link");
				// add labels to popup
				var locators = Zotero.Cite.labels;
				var labelList = document.getElementById("locator-label-popup");
				for(var locator of locators) {
					let locatorLabel = Zotero.Cite.getLocatorString(locator);

					// add to list of labels
					var child = document.createXULElement("menuitem");
					child.setAttribute("value", locator);
					child.setAttribute("label", locatorLabel);
					labelList.appendChild(child);
				}
				// If the focus leaves the citation properties panel, close it
				panel.addEventListener("focusout", (_) => {
					setTimeout(() => {
						if (!panel.contains(document.activeElement)) {
							panel.hidePopup();
						}
					});
				});
			}
			
			// Don't need to set noautohide dynamically on these platforms, so do it now
			if(Zotero.isMac || Zotero.isWin) {
				referencePanel.setAttribute("noautohide", true);
			}

			// Resize whenever a bubble/input is added or removed
			let resizeObserver = new MutationObserver(function (mutationsList) {
				for (let mutation of mutationsList) {
					if (mutation.type === 'childList') {
						// Due to very odd mozilla behavior, calls to resize the window when
						// dragging is happening make the next drag events after resize
						// act strange (dragging doesn't happen, though dragstart fires but dragend doesn't)
						// Resizing after delay in onDrop seems to not cause this issue
						if (!dragPlaceholder) {
							_resize();
						}
					}
				}
			});
			resizeObserver.observe(qfe, { childList: true });

			// Always focus onto the selected reference item
			let referenceSelectObserved = new MutationObserver(function (mutationsList) {
				for (let mutation of mutationsList) {
					if (mutation.type === 'attributes' && mutation.attributeName === 'selected') {
						let focused = document.activeElement;
						if (_sameZoteroItem(focused, referenceBox.selectedItem)) {
							return;
						}
						if (focused.getAttribute("keep-focus")) {
							return;
						}
						referenceBox.selectedItem.focus();
					}
				}
			});
			referenceSelectObserved.observe(referenceBox, { attributeFilter: ['selected'], subtree: true, attributes: true });
		}
	};
	
	/**
	 * Initialize add citation dialog
	 */
	this.onLoad = async function (event) {
		try {
			if (event.target !== document) return;
			// make sure we are visible
			let resizePromise = (async function () {
				let screenX = window.screenX, screenY = window.screenY, i = 5;
				while (!screenX && i--) {
					await new Promise(resolve => window.requestAnimationFrame(resolve));
					screenX = window.screenX;
					screenY = window.screenY;
				}
				window.resizeTo(window.outerWidth, qfb.clientHeight);
				var xRange = [window.screen.availLeft, window.screen.left + window.screen.width - window.outerWidth];
				var yRange = [window.screen.availTop, window.screen.top + window.screen.height - window.outerHeight];
				if (screenX < xRange[0] || screenX > xRange[1] || screenY < yRange[0] || screenY > yRange[1]) {
					var targetX = Math.max(Math.min(screenX, xRange[1]), xRange[0]);
					var targetY = Math.max(Math.min(screenY, yRange[1]), yRange[0]);
					Zotero.debug(`Moving window to ${targetX}, ${targetY}`);
					window.moveTo(targetX, targetY);
				}
				qfGuidance = document.querySelector('.citation-dialog.guidance');
				qfGuidance && qfGuidance.show();
				_refocusQfe();
			})();
			
			_refocusQfe();
			
			// load citation data
			if (io.citation.citationItems.length) {
				await resizePromise;
				_showCitation(null);
			}
			// Create and focus input in the end onload
			let input = _createInputField();
			qfe.appendChild(input);
			input.focus();
		}
		catch (e) {
			Zotero.logError(e);
		}
	};
	
	function _refocusQfe() {
		referencePanel.blur();
		qfe.focus();
	}

	function _createInputField() {
		let newInput = MozXULElement.parseXULToFragment(`
			<html:input class="zotero-bubble-input" aria-description="&zotero.citation.input;"></html:input>
		`, ['chrome://zotero/locale/zotero.dtd']);
		newInput = document.importNode(newInput.querySelector("input"));
		newInput.addEventListener("input", (_) => {
			// Resize window to make it taller in case if the input moves to the next line
			_resize();
			_resetSearchTimer();
			// Expand/shrink the input field to match the width of content
			let width = widthOfContent(newInput);
			newInput.style.width = width + 'px';
		});
		newInput.addEventListener("keypress", onInputPress);
		newInput.addEventListener("paste", _onPaste, false);
		newInput.addEventListener("focus", (_) => {
			newInput.setAttribute("keep-focus", true);

			// Refresh search results when a non-empty input when focused
			// Clear result list if an empty input is focused to prevent
			// results of the previous input from sticking around for a moment after focus change
			if (!inputEmpty(newInput)) {
				_resetSearchTimer();
			}
			else {
				_updateItemList({ citedItems: [] });
			}

			if (referencePanel.hidden) {
				referencePanel.hidden = false;
				_resizeReferencePanel();
			}
		});
		// Delete empty input on blur
		newInput.addEventListener("blur", (_) => {
			if (inputEmpty(newInput)) {
				// Removing the input right before drag-drop reordering starts, will interrupt the
				// drag event. To avoid it, wait for a second to delete empty input during drag-drop.
				setTimeout(() => {
					newInput.remove();
				}, 500);
			}
			else {
				_lastFocusedInput = newInput;
			}
			// If focus leaves input, hide the reference panel.
			setTimeout(() => {
				if (referencePanel.contains(document.activeElement)) {
					return;
				}
				let focusedInput = _getInput();
				if (!focusedInput) {
					referencePanel.hidden = true;
					_resizeReferencePanel();
				}
			});
		});
		return newInput;
	}
	

	/**
	 * Updates currentLocator based on a string
	 * @param {String} str String to search for locator
	 * @return {String} str without locator
	 */
	function _updateLocator(str) {
		m = !isPaste && locatorRe.exec(str);
		if(m && (m[1] || m[2] || m[3].length !== 4) && m.index > 0) {
			currentLocator = m[3];
			str = str.substr(0, m.index)+str.substring(m.index+m[0].length);
		}
		return str;
	}

	/**
	 * Does the dirty work of figuring out what the user meant to type
	 */
	var _quickFormat = Zotero.Promise.coroutine(function* () {
		var str = _getEditorContent();
		if (str && str.match(/\s$/)) {
			locatorLocked = true;
		}
		var haveConditions = false;
		
		const etAl = " et al.";
		
		var m,
			year = false,
			isBC = false,
			dateID = false;
		
		currentLocator = false;
		currentLocatorLabel = false;
		
		// check for adding a number onto a previous page number
		if(!locatorLocked && numRe.test(str)) {
			// add to previous cite
			let citationItem = JSON.parse(locatorNode && locatorNode.dataset.citationItem || "null");
			if (citationItem) {
				if (!("locator" in citationItem)) {
					citationItem.locator = "";
				}
				citationItem.locator += str;
				locatorNode.dataset.citationItem = JSON.stringify(citationItem);
				locatorNode.textContent = _buildBubbleString(citationItem);
				_clearEntryList();
				return;
			}
		}
		
		if(str && str.length > 1) {
			// check for specified locator
			m = specifiedLocatorRe.exec(str);
			if(m) {
				if(m.index === 0) {
					// add to previous cite
					let node = _getInput();
					var prevNode = locatorLocked ? node.previousElementSibling : locatorNode;
					let citationItem = JSON.parse(prevNode && prevNode.dataset.citationItem || "null");
					if (citationItem) {
						citationItem.locator = m[2];
						prevNode.dataset.citationItem = JSON.stringify(citationItem);
						prevNode.textContent = _buildBubbleString(citationItem);
						_clearEntryList();
						locatorLocked = false;
						locatorNode = prevNode;
						return;
					}
				}
				
				// TODO support types other than page
				currentLocator = m[2];
				str = str.substring(0, m.index);
			}

			str = _updateLocator(str);
			// check for year and pages
			m = yearRe.exec(str);
			if(m) {
				year = parseInt(m[1]);
				isBC = m[2] && m[2][0] === "B";
				str = str.substr(0, m.index)+str.substring(m.index+m[0].length);
			}
			if(year) str += " "+year;
			
			var s = new Zotero.Search();
			str = str.replace(/ (?:&|and) /g, " ", "g");
			str = str.replace(/^,/, '');
			if(charRe.test(str)) {
				Zotero.debug("QuickFormat: QuickSearch: "+str);
				// Exclude feeds
				Zotero.Feeds.getAll()
					.forEach(feed => s.addCondition("libraryID", "isNot", feed.libraryID));
				if (Zotero_QuickFormat.citingNotes) {
					s.addCondition("quicksearch-titleCreatorYearNote", "contains", str);
				}
				else {
					s.addCondition("quicksearch-titleCreatorYear", "contains", str);
					s.addCondition("itemType", "isNot", "attachment");
					if (io.filterLibraryIDs) {
						io.filterLibraryIDs.forEach(id => s.addCondition("libraryID", "is", id));
					}
				}
				haveConditions = true;
			}
		}
		
		if (!haveConditions && Zotero_QuickFormat.citingNotes) {
			s = new Zotero.Search();
			str = "";
			s.addCondition("quicksearch-titleCreatorYearNote", "contains", str);
			haveConditions = true;
		}
		
		if (haveConditions) {
			var searchResultIDs = (haveConditions ? (yield s.search()) : []);
			
			// Show items list without cited items to start
			yield _updateItemList({ searchString: str, searchResultIDs });
			
			// Check to see which search results match items already in the document
			var citedItems, completed = !!Zotero_QuickFormat.citingNotes, isAsync = false;
			// Save current search time so that when we get items, we know whether it's too late to
			// process them or not
			var lastSearchTime = currentSearchTime = Date.now();
			// This may or may not be synchronous
			if (!Zotero_QuickFormat.citingNotes) {
				io.getItems().then(function(citedItems) {
					// Don't do anything if panel is already closed
					if(isAsync &&
							((referencePanel.state !== "open" && referencePanel.state !== "showing")
							|| lastSearchTime !== currentSearchTime)) return;
					
					completed = true;
					
					if(str.toLowerCase() === Zotero.getString("integration.ibid").toLowerCase()) {
						// If "ibid" is entered, show all cited items
						citedItemsMatchingSearch = citedItems;
					} else {
						Zotero.debug("Searching cited items");
						// Search against items. We do this here because it's possible that some of these
						// items are only in the doc, and not in the DB.
						var splits = Zotero.Fulltext.semanticSplitter(str),
							citedItemsMatchingSearch = [];
						for(var i=0, iCount=citedItems.length; i<iCount; i++) {
							// Generate a string to search for each item
							let item = citedItems[i];
							let itemStr = item.getCreators()
								.map(creator => creator.firstName + " " + creator.lastName)
								.concat([item.getField("title"), item.getField("date", true, true).substr(0, 4)])
								.join(" ");
							
							// See if words match
							for(var j=0, jCount=splits.length; j<jCount; j++) {
								var split = splits[j];
								if(itemStr.toLowerCase().indexOf(split) === -1) break;
							}
							
							// If matched, add to citedItemsMatchingSearch
							if(j === jCount) citedItemsMatchingSearch.push(item);
						}
						Zotero.debug("Searched cited items");
					}
					
					_updateItemList({
						citedItems,
						citedItemsMatchingSearch,
						searchString: str,
						searchResultIDs,
						preserveSelection: isAsync
					});
				});
			}
			
			if(!completed) {
				// We are going to have to wait until items have been retrieved from the document.
				Zotero.debug("Getting cited items asynchronously");
				isAsync = true;
			} else {
				Zotero.debug("Got cited items synchronously");
			}
		} else {
			// No search conditions, so just clear the box
			_updateItemList({ citedItems: [] });
		}
	});
	
	/**
	 * Updates the item list
	 */
	var _updateItemList = async function (options = {}) {
		options = Object.assign({
				citedItems: false,
				citedItemsMatchingSearch: false,
				searchString: "",
				searchResultIDs: [],
				preserveSelection: false
			}, options);
		let { citedItems, citedItemsMatchingSearch, searchString,
			searchResultIDs, preserveSelection } = options
			
		var selectedIndex = 1, previousItemID;
		if (Zotero_QuickFormat.citingNotes) citedItems = [];
		
		// Do this so we can preserve the selected item after cited items have been loaded
		if(preserveSelection && referenceBox.selectedIndex !== -1 && referenceBox.selectedIndex !== 2) {
			previousItemID = parseInt(referenceBox.selectedItem.getAttribute("zotero-item"), 10);
		}
		
		while(referenceBox.hasChildNodes()) referenceBox.removeChild(referenceBox.firstChild);
		
		var nCitedItemsFromLibrary = {};
		if(!citedItems) {
			// We don't know whether or not we have cited items, because we are waiting for document
			// data
			referenceBox.appendChild(_buildListSeparator(Zotero.getString("integration.cited.loading")));
			selectedIndex = 2;
		} else if(citedItems.length) {
			// We have cited items
			for(var i=0, n=citedItems.length; i<n; i++) {
				var citedItem = citedItems[i];
				// Tabulate number of items in document for each library
				if(!citedItem.cslItemID) {
					var libraryID = citedItem.libraryID;
					if(libraryID in nCitedItemsFromLibrary) {
						nCitedItemsFromLibrary[libraryID]++;
					} else {
						nCitedItemsFromLibrary[libraryID] = 1;
					}
				}
			}
			
			if(citedItemsMatchingSearch && citedItemsMatchingSearch.length) {
				referenceBox.appendChild(_buildListSeparator(Zotero.getString("integration.cited")));
				for(var i=0; i<Math.min(citedItemsMatchingSearch.length, 50); i++) {
					var citedItem = citedItemsMatchingSearch[i];
					referenceBox.appendChild(_buildListItem(citedItem));
				}
			}
		}
		
		// Also take into account items cited in this citation. This means that the sorting isn't
		// exactly by # of items cited from each library, but maybe it's better this way.
		_updateCitationObject();
		for(var citationItem of io.citation.citationItems) {
			var citedItem = io.customGetItem && io.customGetItem(citationItem) || Zotero.Cite.getItem(citationItem.id);
			if(!citedItem.cslItemID) {
				var libraryID = citedItem.libraryID;
				if(libraryID in nCitedItemsFromLibrary) {
					nCitedItemsFromLibrary[libraryID]++;
				} else {
					nCitedItemsFromLibrary[libraryID] = 1;
				}
			}
		}

		if(searchResultIDs.length && (!citedItemsMatchingSearch || citedItemsMatchingSearch.length < 50)) {
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
				if(libA !== libB) {
					// Sort by number of cites for library
					if(nCitedItemsFromLibrary[libA] && !nCitedItemsFromLibrary[libB]) {
						return -1;
					}
					if(!nCitedItemsFromLibrary[libA] && nCitedItemsFromLibrary[libB]) {
						return 1;
					}
					if(nCitedItemsFromLibrary[libA] !== nCitedItemsFromLibrary[libB]) {
						return nCitedItemsFromLibrary[libB] - nCitedItemsFromLibrary[libA];
					}
					
					// Sort by ID even if number of cites is equal
					return libA - libB;
				}
			
				// Sort by last name of first author
				if (firstCreatorA !== "" && firstCreatorB === "") {
					return -1;
				} else if (firstCreatorA === "" && firstCreatorB !== "") {
					return 1
				} else if (firstCreatorA) {
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
			
			items.sort(Zotero_QuickFormat.citingNotes ? _noteSort : _itemSort);
			
			var previousLibrary = -1;
			for(var i=0, n=Math.min(items.length, citedItemsMatchingSearch ? 50-citedItemsMatchingSearch.length : 50); i<n; i++) {
				var item = items[i], libraryID = item.libraryID;
				
				if(previousLibrary != libraryID) {
					var libraryName = libraryID ? Zotero.Libraries.getName(libraryID)
						: Zotero.getString('pane.collections.library');
					referenceBox.appendChild(_buildListSeparator(libraryName));
				}

				referenceBox.appendChild(_buildListItem(item));
				previousLibrary = libraryID;
				
				if(preserveSelection && (item.cslItemID ? item.cslItemID : item.id) === previousItemID) {
					selectedIndex = referenceBox.childNodes.length-1;
				}
			}
		}
		
		_resizeReferencePanel();
		if((citedItemsMatchingSearch && citedItemsMatchingSearch.length) || searchResultIDs.length) {
			referenceBox.selectedIndex = selectedIndex;
			referenceBox.ensureIndexIsVisible(selectedIndex);
		}
	};
	
	/**
	 * Builds a string describing an item. We avoid CSL here for speed.
	 */
	function _buildItemDescription(item, infoHbox) {
		var nodes = [];
		var str = "";

		if (item.isNote()) {
			var date = Zotero.Date.sqlToDate(item.dateModified, true);
			date = Zotero.Date.toFriendlyDate(date);
			str += date;
			
			var text = item.note;
			text = Zotero.Utilities.unescapeHTML(text);
			text = text.trim();
			text = text.slice(0, 500);
			var parts = text.split('\n').map(x => x.trim()).filter(x => x.length);
			if (parts[1]) str += " " + parts[1];
		}
		else {
			var author, authorDate = "";
			if(item.firstCreator) author = authorDate = item.firstCreator;
			var date = item.getField("date", true, true);
			if(date && (date = date.substr(0, 4)) !== "0000") {
				authorDate += " (" + parseInt(date) + ")";
			}
			authorDate = authorDate.trim();
			if(authorDate) nodes.push(authorDate);
			
			var publicationTitle = item.getField("publicationTitle", false, true);
			if(publicationTitle) {
				var label = document.createXULElement("label");
				label.setAttribute("value", publicationTitle);
				label.setAttribute("crop", "end");
				label.style.fontStyle = "italic";
				nodes.push(label);
			}
			
			var volumeIssue = item.getField("volume");
			var issue = item.getField("issue");
			if(issue) volumeIssue += "("+issue+")";
			if(volumeIssue) nodes.push(volumeIssue);
			
			var publisherPlace = [], field;
			if((field = item.getField("publisher"))) publisherPlace.push(field);
			if((field = item.getField("place"))) publisherPlace.push(field);
			if(publisherPlace.length) nodes.push(publisherPlace.join(": "));
			
			var pages = item.getField("pages");
			if(pages) nodes.push(pages);
			
			if(!nodes.length) {
				var url = item.getField("url");
				if(url) nodes.push(url);
			}

			// compile everything together
			for(var i=0, n=nodes.length; i<n; i++) {
				var node = nodes[i];

				if(i != 0) str += ", ";

				if(typeof node === "object") {
					var label = document.createXULElement("label");
					label.setAttribute("value", str);
					label.setAttribute("crop", "end");
					infoHbox.appendChild(label);
					infoHbox.appendChild(node);
					str = "";
				} else {
					str += node;
				}
			}

			if(nodes.length && (!str.length || str[str.length-1] !== ".")) str += ".";	
		}
		
		var label = document.createXULElement("label");
		label.setAttribute("value", str);
		label.setAttribute("crop", "end");
		label.setAttribute("flex", "1");
		infoHbox.appendChild(label);
	}
	
	/**
	 * Creates an item to be added to the item list
	 */
	function _buildListItem(item) {
		var titleNode = document.createXULElement("label");
		titleNode.setAttribute("class", "citation-dialog title");
		titleNode.setAttribute("flex", "1");
		titleNode.setAttribute("crop", "end");
		titleNode.setAttribute("value", item.getDisplayTitle());
		
		var infoNode = document.createXULElement("hbox");
		infoNode.setAttribute("class", "citation-dialog info");
		_buildItemDescription(item, infoNode);
		
		// add to rich list item
		let rll = MozXULElement.parseXULToFragment(`
			<richlistitem class="citation-dialog item" orient="vertical" aria-description="&zotero.citation.item;"></richlistitem>
		`, ['chrome://zotero/locale/zotero.dtd']);
		rll = document.importNode(rll.querySelector("richlistitem"));
		rll.setAttribute("zotero-item", item.cslItemID ? item.cslItemID : item.id);
		rll.appendChild(titleNode);
		rll.appendChild(infoNode);
		rll.addEventListener("click", Zotero_QuickFormat._bubbleizeSelected, false);
		
		return rll;
	}

	/**
	 * Creates a list separator to be added to the item list
	 */
	function _buildListSeparator(labelText, loading) {
		var titleNode = document.createXULElement("label");
		titleNode.setAttribute("class", "citation-dialog separator-title");
		titleNode.setAttribute("flex", "1");
		titleNode.setAttribute("crop", "end");
		titleNode.setAttribute("value", labelText);
		
		// add to rich list item
		var rll = document.createXULElement("richlistitem");
		rll.setAttribute("orient", "vertical");
		rll.setAttribute("disabled", true);
		rll.setAttribute("class", loading ? "citation-dialog loading" : "citation-dialog separator");
		rll.appendChild(titleNode);
		rll.addEventListener("mousedown", _ignoreClick, true);
		rll.addEventListener("click", _ignoreClick, true);
		
		return rll;
	}
	
	/**
	 * Builds the string to go inside a bubble
	 */
	function _buildBubbleString(citationItem) {
		var item = io.customGetItem && io.customGetItem(citationItem) || Zotero.Cite.getItem(citationItem.id);
		// create text for bubble
		
		// Creator
		var title, delimiter;
		var str = item.getField("firstCreator");
		
		// Title, if no creator (getDisplayTitle in order to get case, e-mail, statute which don't have a title field)
		title = item.getDisplayTitle();
		title = title.substr(0, 32) + (title.length > 32 ? "…" : "");
 		if (!str) {
			str = Zotero.getString("punctuation.openingQMark") + title + Zotero.getString("punctuation.closingQMark");
		}
		
		// Date
		var date = item.getField("date", true, true);
		if(date && (date = date.substr(0, 4)) !== "0000") {
			str += ", " + parseInt(date);
		}
		
		// Locator
		if(citationItem.locator) {
			if(citationItem.label) {
				// TODO localize and use short forms
				var label = citationItem.label;
			} else if(/[\-–,]/.test(citationItem.locator)) {
				var label = "pp.";
			} else {
				var label = "p."
			}
			
			str += ", "+label+" "+citationItem.locator;
		}
		
		// Prefix
		if(citationItem.prefix && Zotero.CiteProc.CSL.ENDSWITH_ROMANESQUE_REGEXP) {
			let prefix = citationItem.prefix.substr(0, 10) + (citationItem.prefix.length > 10 ? "…" : "")
			str = prefix
				+(Zotero.CiteProc.CSL.ENDSWITH_ROMANESQUE_REGEXP.test(citationItem.prefix) ? " " : "")
				+str;
		}
		
		// Suffix
		if(citationItem.suffix && Zotero.CiteProc.CSL.STARTSWITH_ROMANESQUE_REGEXP) {
			let suffix = citationItem.suffix.substr(0, 10) + (citationItem.suffix.length > 10 ? "…" : "")
			str += (Zotero.CiteProc.CSL.STARTSWITH_ROMANESQUE_REGEXP.test(citationItem.suffix) ? " " : "")
				+ suffix;
		}
		
		return str;
	}
	
	/**
	 * Insert a bubble into the DOM at a specified position
	 */
	function _insertBubble(citationItem, nextNode) {
		var str = _buildBubbleString(citationItem);
		
		let bubble = MozXULElement.parseXULToFragment(`
			<html:div class="citation-dialog bubble" draggable="true" role="button" tabindex="0" aria-description="&zotero.citation.bubble;"></html:div>
		`, ['chrome://zotero/locale/zotero.dtd']);
		bubble = document.importNode(bubble.querySelector("div"));
		// VoiceOver works better without it
		if (!Zotero.isMac) {
			bubble.setAttribute("aria-label", str);
		}
		bubble.textContent = str;
		bubble.addEventListener("click", _onBubbleClick);
		bubble.addEventListener("dragstart", _onBubbleDrag);
		bubble.addEventListener("dragend", onBubbleDragEnd);
		bubble.addEventListener("keypress", onBubblePress);
		bubble.dataset.citationItem = JSON.stringify(citationItem);
		qfe.insertBefore(bubble, (nextNode ? nextNode : null));
		return bubble;
	}
	
	/**
	 * Clear list of bubbles
	 */
	function _clearEntryList() {
		while(referenceBox.hasChildNodes()) referenceBox.removeChild(referenceBox.firstChild);
		_resizeReferencePanel();
	}
	
	/**
	 * Converts the selected item to a bubble
	 */
	this._bubbleizeSelected = Zotero.Promise.coroutine(function* () {
		if(!referenceBox.hasChildNodes() || !referenceBox.selectedItem || !(_lastFocusedInput || _getInput())) return false;
		var citationItem = {"id":referenceBox.selectedItem.getAttribute("zotero-item")};
		if (typeof citationItem.id === "string" && citationItem.id.indexOf("/") !== -1) {
			var item = Zotero.Cite.getItem(citationItem.id);
			citationItem.uris = item.cslURIs;
			citationItem.itemData = item.cslItemData;
		}
		else if (Zotero.Retractions.isRetracted({ id: parseInt(citationItem.id) })) {
			citationItem.id = parseInt(citationItem.id);
			if (Zotero.Retractions.shouldShowCitationWarning(citationItem)) {
				referencePanel.hidden = true;
				var ps = Services.prompt;
				var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
					+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL
					+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
				var checkbox = { value: false };
				var result = ps.confirmEx(null,
					Zotero.getString('general.warning'),
					Zotero.getString('retraction.citeWarning.text1') + '\n\n'
						+ Zotero.getString('retraction.citeWarning.text2'),
					buttonFlags,
					Zotero.getString('general.continue'),
					null,
					Zotero.getString('pane.items.showItemInLibrary'),
					Zotero.getString('retraction.citationWarning.dontWarn'), checkbox);
				referencePanel.hidden = false;
				if (result > 0) {
					if (result == 2) {
						Zotero_QuickFormat.showInLibrary(parseInt(citationItem.id));
					}
					return false;
				}
				if (checkbox.value) {
					Zotero.Retractions.disableCitationWarningsForItem(citationItem);
				}
			}
			citationItem.ignoreRetraction = true;
		}
		
		_updateLocator(_getEditorContent());
		if(currentLocator) {
			 citationItem["locator"] = currentLocator;
			if(currentLocatorLabel) {
				citationItem["label"] = currentLocatorLabel;
			}
		}
		locatorLocked = "locator" in citationItem;
		
		// We are setting a locator node here, but below 2 calls reset
		// the bubble list for sorting, so we do some additional
		// handling to maintain the correct locator node in
		// _showCitation()
		let input = _getInput() || _lastFocusedInput;
		locatorNode = _insertBubble(citationItem, input);
		input.remove();
		isPaste = false;
		_clearEntryList();
		yield _previewAndSort();
		_refocusQfe();
		locatorNode.focus();
		return true;
	});
	
	/**
	 * Ignores clicks (for use on separators in the rich list box)
	 */
	function _ignoreClick(e) {
		e.stopPropagation();
		e.preventDefault();
	}

	function _resize() {
		let box = document.querySelector(".citation-dialog.entry");
		let contentHeight = box.getBoundingClientRect().height;
		window.resizeTo(WINDOW_WIDTH, contentHeight);
		if (Zotero.isMac && Zotero.platformMajorVersion >= 60) {
			document.children[0].setAttribute('drawintitlebar', 'false');
			document.children[0].setAttribute('drawintitlebar', 'true');
		}
	}
	
	function _resizeReferencePanel() {
		var childNodes = referenceBox.childNodes, numReferences = 0, numSeparators = 0,
			firstReference, firstSeparator, height;
		for(var i=0, n=childNodes.length; i<n && numReferences < SHOWN_REFERENCES; i++) {
			if(childNodes[i].className === "citation-dialog item") {
				numReferences++;
				if(!firstReference) {
					firstReference = childNodes[i];
					if(referenceBox.selectedIndex === -1) referenceBox.selectedIndex = i;
				}
			} else if(childNodes[i].className === "citation-dialog separator") {
				numSeparators++;
				if(!firstSeparator) firstSeparator = childNodes[i];
			}
		}
		
		var panelShowing = referencePanel.state === "open" || referencePanel.state === "showing";
		
		if(numReferences || numSeparators) {
			if(((!referenceHeight && firstReference) || (!separatorHeight && firstSeparator)
					|| !panelFrameHeight) && !panelShowing) {
				_openReferencePanel();
				panelShowing = true;
			}
		
			if(!referenceHeight && firstReference) {
				referenceHeight = firstReference.scrollHeight + 1;
			}
			
			if(!separatorHeight && firstSeparator) {
				separatorHeight = firstSeparator.scrollHeight + 1;
			}
			
			if(!panelFrameHeight) {
				panelFrameHeight = referencePanel.getBoundingClientRect().height - referencePanel.clientHeight;
				var computedStyle = window.getComputedStyle(referenceBox, null);
				for(var attr of ["border-top-width", "border-bottom-width"]) {
					var val = computedStyle.getPropertyValue(attr);
					if(val) {
						var m = pixelRe.exec(val);
						if(m) panelFrameHeight += parseInt(m[1], 10);
					}
				}
			}
			referencePanel.sizeTo(window.outerWidth-30,
				numReferences*referenceHeight+numSeparators*separatorHeight+panelFrameHeight);
			if(!panelShowing) _openReferencePanel();
		} else if(panelShowing) {
			referencePanel.hidePopup();
			referencePanel.sizeTo(window.outerWidth-30, 0);
			_refocusQfe();
		}
	}
	
	/**
	 * Opens the reference panel and potentially refocuses the main text box
	 */
	function _openReferencePanel() {
		var panelShowing = referencePanel.state === "open" || referencePanel.state === "showing";
		
		if (!panelShowing && !Zotero.isMac && !Zotero.isWin) {
			// noautohide and noautofocus are incompatible on Linux
			// https://bugzilla.mozilla.org/show_bug.cgi?id=545265
			referencePanel.setAttribute("noautohide", "false");
			
			// reinstate noautohide after the window is shown
			referencePanel.addEventListener("popupshowing", function() {
				referencePanel.removeEventListener("popupshowing", arguments.callee, false);
				referencePanel.setAttribute("noautohide", "true");
			}, false);
		}

		referencePanel.openPopup(document.documentElement, "after_start", 15,
			qfb.clientHeight-window.clientHeight, false, false, null);
	}
	
	/**
	 * Clears all citations
	 */
	function _clearCitation() {
		var citations = document.getElementsByClassName("citation-dialog bubble");
		while(citations.length) {
			citations[0].parentNode.removeChild(citations[0]);
		}
	}
	
	/**
	 * Shows citations in the citation object
	 */
	function _showCitation(insertBefore) {
		if(!io.citation.properties.unsorted
				&& keepSorted && keepSorted.hasAttribute("checked")
				&& io.citation.sortedItems
				&& io.citation.sortedItems.length) {
			for(var i=0, n=io.citation.sortedItems.length; i<n; i++) {
				const bubble = _insertBubble(io.citation.sortedItems[i][1], insertBefore);
				if (locatorNode && bubble.textContent == locatorNode.textContent) {
					locatorNode = bubble;
				}
			}
		} else {
			for(var i=0, n=io.citation.citationItems.length; i<n; i++) {
				const bubble = _insertBubble(io.citation.citationItems[i], insertBefore);
				if (locatorNode && bubble.textContent == locatorNode.textContent) {
					locatorNode = bubble;
				}
			}
		}
	}
	
	/**
	 * Populates the citation object
	 */
	function _updateCitationObject() {
		var nodes = qfe.childNodes;
		io.citation.citationItems = [];
		for (let node of nodes) {
			if (node.dataset && node.dataset.citationItem) {
				io.citation.citationItems.push(JSON.parse(node.dataset.citationItem));
			}
		}
		
		if(io.sortable) {
			if(keepSorted && keepSorted.hasAttribute("checked")) {
				delete io.citation.properties.unsorted;
			} else {
				io.citation.properties.unsorted = true;
			}
		}
	}
	
	/**
	 * Generates the preview and sorts citations
	 */
	var _previewAndSort = Zotero.Promise.coroutine(function* () {
		var shouldKeepSorted = keepSorted && keepSorted.hasAttribute("checked"),
			editorShowing = showEditor && showEditor.hasAttribute("checked");
		if(!shouldKeepSorted && !editorShowing) return;
		
		_updateCitationObject();
		yield io.sort();
		if(shouldKeepSorted) {
			// means we need to resort citations
			_clearCitation();
			_showCitation();
		}
	});
	
	/**
	 * Shows the citation properties panel for a given bubble
	 */
	function _showCitationProperties(target) {
		panelRefersToBubble = target;
		let citationItem = JSON.parse(target.dataset.citationItem);
		panelPrefix.value = citationItem["prefix"] ? citationItem["prefix"] : "";
		panelSuffix.value = citationItem["suffix"] ? citationItem["suffix"] : "";
		var pageOption = panelLocatorLabel.getElementsByAttribute("value", "page")[0];
		if(citationItem["label"]) {
			var option = panelLocatorLabel.getElementsByAttribute("value", citationItem["label"]);
			if(option.length) {
				panelLocatorLabel.selectedItem = option[0];
			} else {
				panelLocatorLabel.selectedItem = pageOption;
			}
		} else {
			panelLocatorLabel.selectedItem = pageOption;
		}
		panelLocator.value = citationItem["locator"] ? citationItem["locator"] : "";
		panelSuppressAuthor.checked = !!citationItem["suppress-author"];
		
		var item = io.customGetItem && io.customGetItem(citationItem) || Zotero.Cite.getItem(citationItem.id);
		document.getElementById("citation-properties-title").textContent = item.getDisplayTitle();
		while(panelInfo.hasChildNodes()) panelInfo.removeChild(panelInfo.firstChild);
		_buildItemDescription(item, panelInfo);
		// Aria label for the info panel to be visible to the screen readers
		let description = Array.from(panelInfo.childNodes).map(label => label.value).join(".");
		panelInfo.setAttribute('aria-label', description);
		panelLibraryLink.hidden = !item.id;
		if(item.id) {
			var libraryName = item.libraryID ? Zotero.Libraries.getName(item.libraryID)
							: Zotero.getString('pane.collections.library');
			panelLibraryLink.label = Zotero.getString("integration.openInLibrary", libraryName);
		}

		target.setAttribute("selected", "true");
		panel.openPopup(target, "after_start",
			target.clientWidth/2, 0, false, false, null);
		referencePanel.hidden = true;
	}
	
	/**
	 * Called when progress changes
	 */
	function _onProgress(percent) {
		var meter = document.querySelector(".citation-dialog.progress-meter");
		if(percent === null) {
			meter.removeAttribute('value');
		} else {
			meter.value = Math.round(percent);
		}
	}
	
	/**
	 * Accepts current selection and adds citation
	 */
	this._accept = function() {
		if(accepted) return;
		accepted = true;
		try {
			_updateCitationObject();
			document.querySelector(".citation-dialog.deck").selectedIndex = 1;
			io.accept(_onProgress);
		} catch(e) {
			Zotero.debug(e);
		}
	}
	
	/**
	 * Handles windows closed with the close box
	 */
	this.onUnload = function() {
		if(accepted) return;
		accepted = true;
		io.citation.citationItems = [];
		io.accept();
	}
	
	// Flag any duplicate Enter or Escape events coming in within MILISECONDS_BETWEEN_KEYPRESSES
	// of each other
	this.throttleEscapeEnter = function (e) {
		let now = new Date();
		if (accepted) {
			e.stopPropagation();
			e.preventDefault();
			return;
		}
		if (e.key == "Enter") {
			if (lastEnter && now - lastEnter < MILISECONDS_BETWEEN_KEYPRESSES) {
				throttleEnter = true;
				return;
			}
			throttleEnter = false;
			lastEnter = new Date();
		}
		else if (e.key == "Escape") {
			if (lastEscape && now - lastEscape < MILISECONDS_BETWEEN_KEYPRESSES) {
				throttleEscape = true;
				return;
			}
			lastEscape = new Date();
			throttleEscape = false;
		}
	};

	/**
	 * Handle escape for entire window
	 */
	this.onWindowKeyPress = function (event) {
		if (accepted) return;
		var keyCode = event.keyCode;
		if (keyCode === event.DOM_VK_ESCAPE && !throttleEscape) {
			accepted = true;
			io.citation.citationItems = [];
			io.accept();
			window.close();
		}
		else if (event.key == "Enter" && !throttleEnter) {
			event.preventDefault();
			Zotero_QuickFormat._accept();
		}
	};

	function moveFocusForward(node) {
		if (node.nextElementSibling?.focus) {
			node.nextElementSibling.focus();
			return true;
		}
		return false;
	}

	function moveFocusBack(node) {
		// Skip line break if it's before the node
		if (node.previousElementSibling?.tagName == "BR") {
			node = node.previousElementSibling;
		}
		if (node.previousElementSibling?.focus) {
			node.previousElementSibling.focus();
			return true;
		}
		return false;
	}

	/**
	 * Gets text within the currently selected node
	 */
	function _getEditorContent() {
		let node = _getInput();
		return node ? node.value.trim() : false;
	}

	function _getInput() {
		if (isInput(document.activeElement)) {
			return document.activeElement;
		}
		return false;
	}

	function widthOfContent(input) {
		let span = document.createElement("span");
		span.classList = "zotero-bubble-input";
		span.innerText = input.value;
		qfe.appendChild(span);
		let spanWidth = span.getBoundingClientRect().width;
		span.remove();
		return spanWidth;
	}

	// Determine if the input has anything that is not just whitepsace
	function inputEmpty(input) {
		if (!input) {
			return true;
		}
		return !/\S/.test(input.value);
	}

	function isInput(node) {
		if (!node) return false;
		return node.classList.contains("zotero-bubble-input");
	}

	function _sameZoteroItem(nodeOne, nodeTwo) {
		if (!nodeOne || !nodeTwo) {
			return false;
		}
		return nodeOne.getAttribute("zotero-item") == nodeTwo.getAttribute("zotero-item");
	}

	/**
	 * Reset timer that controls when search takes place. We use this to avoid searching after each
	 * keypress, since searches can be slow.
	 */
	function _resetSearchTimer() {
		// Show spinner
		var spinner = document.querySelector('.citation-dialog.spinner');
		spinner.style.visibility = '';
		// Cancel current search if active
		if (_searchPromise && _searchPromise.isPending()) {
			_searchPromise.cancel();
		}
		// Start new search
		_searchPromise = Zotero.Promise.delay(SEARCH_TIMEOUT)
			.then(() => _quickFormat())
			.then(() => {
				_searchPromise = null;
				spinner.style.visibility = 'hidden';
			});
	}

	function lastBubbleBeforePoint(x, y) {
		let bubbles = document.querySelectorAll('.bubble');
		let lastBubble = null;
		let newline = false;
		for (let i = 0; i < bubbles.length; i++) {
			let rect = bubbles[i].getBoundingClientRect();
			// If within the vertical range of a bubble
			if (y >= rect.top && y <= rect.bottom) {
				// If the click is to the right of a bubble, it becomes a candidate
				if (x > rect.right) {
					lastBubble = i;
				}
				// Otherwise, stop and return the last bubble we saw if any
				else {
					if (i == 0) {
						lastBubble = null;
					}
					else {
						// If there is no bubble before this one, we'll want to add a newline
						// so that the placeholder shows up in the same row
						newline = lastBubble === null;
						lastBubble = Math.max(i - 1, 0);
					}
					break;
				}
			}
		}
		if (lastBubble !== null) {
			lastBubble = bubbles[lastBubble];
		}
		return { lastBubble: lastBubble, newline: newline };
	}
	
	function _onQuickSearchClick(event) {
		if (qfGuidance) qfGuidance.hide();
		if (!event.target.classList.contains("editor")) {
			return;
		}
		let clickX = event.clientX;
		let clickY = event.clientY;
		let { lastBubble, newline } = lastBubbleBeforePoint(clickX, clickY);
		// If click happened right before another input, focus that input
		// instead of adding another one
		if (isInput(lastBubble?.nextElementSibling)) {
			lastBubble.nextElementSibling.focus();
			return;
		}
		let newInput = _createInputField();
		if (lastBubble !== null) {
			lastBubble.after(newInput);
			if (newline) {
				let lineBreak = document.createElement("br");
				lastBubble.after(lineBreak);
			}
		}
		else {
			qfe.prepend(newInput);
		}
		newInput.focus();
	}
	

	var onInputPress = function (event) {
		if (accepted) return;
		if ((event.charCode === 59 /* ; */ || event.key === "Enter") && referencePanel.state === "open") {
			event.preventDefault();
			event.stopPropagation();
			Zotero_QuickFormat._bubbleizeSelected();
		}
		else if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.shiftKey) {
			locatorLocked = true;
			// On arrow left from the beginning of the input, move to previous bubble
			if (event.key === "ArrowLeft" && this.selectionStart === 0) {
				moveFocusBack(this);
				event.preventDefault();
			}
			// On arrow right from the end of the input, move to next bubble
			else if (event.key === "ArrowRight" && this.selectionStart === this.value.length) {
				moveFocusForward(this);
				event.preventDefault();
			}
		}
		else if (["Backspace", "Delete"].includes(event.key) && !this.value) {
			event.preventDefault();
			moveFocusBack(this);
			this.remove();
		}
		else if (["ArrowDown", "ArrowUp"].includes(event.key) && referencePanel.state === "open") {
			this.removeAttribute("keep-focus");
		}
	};

	var onBubblePress = function(event) {
		if (accepted) return;
		if (event.key == " ") {
			// On space, open new citation properties panel
			_showCitationProperties(this);
			event.preventDefault();
		}
		else if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.shiftKey) {
			event.preventDefault();
			let newInput = _createInputField();
			
			if (["ArrowLeft"].includes(event.key)) {
				if (isInput(this.previousElementSibling)) {
					moveFocusBack(this);
				}
				else {
					this.before(newInput);
					newInput.focus();
				}
			}
			else if (["ArrowRight"].includes(event.key)) {
				if (isInput(this.nextElementSibling)) {
					moveFocusForward(this);
				}
				else {
					this.after(newInput);
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
					node = event.key == "ArrowLeft" ? node.previousElementSibling : node.nextElementSibling;
				} while (node && !(node.classList.contains("bubble") || node.classList.contains("zotero-bubble-input")));
				return node;
			};
			let nextBubble = findNextBubble();
			if (nextBubble) {
				// If we ran into a line break on the way, delete it
				if (nextBubble.previousElementSibling?.tagName == "br") {
					nextBubble.previousElementSibling.remove();
				}
				if (event.key == "ArrowLeft") {
					nextBubble.before(this);
				}
				else {
					nextBubble.after(this);
				}
				// Do not "Keep Sources Sorted"
				if (io.sortable && keepSorted?.hasAttribute("checked")) {
					keepSorted.removeAttribute("checked");
				}
				_previewAndSort();
			}
			
			this.focus();
		}
		else if (["Backspace", "Delete"].includes(event.key)) {
			event.preventDefault();
			if (!moveFocusBack(this)) {
				moveFocusForward(this);
			}
			this.parentNode.removeChild(this);
			_resize();
		}
	};

	/**
	 * Handle return or escape
	 */
	var _onQuickSearchKeyPress = Zotero.Promise.coroutine(function* (event) {
		// Prevent hang if another key is pressed after Enter
		// https://forums.zotero.org/discussion/59157/
		if (accepted) {
			event.preventDefault();
			return;
		}
		if(qfGuidance) qfGuidance.hide();
		
		var keyCode = event.keyCode;
		let focusedInput = _getInput();
		if (event.key == ' ') {
			// Space on toolbarbutton opens the popup
			if (event.target.tagName == "toolbarbutton") {
				event.target.firstChild.openPopup();
			}
		}
		else if (["ArrowDown", "ArrowUp"].includes(event.key) && referencePanel.state === "open") {
			// Arrow up/down from wherever will navigate the references panel if that's opened
			locatorLocked = true;
			var e = new KeyboardEvent('keypress', {
				key: event.key,
				code: event.code,
				keyCode: event.keyCode,
				bubbles: true
			});
			referenceBox.dispatchEvent(e);
			event.preventDefault();
		}
		// On Home from the beginning of the input, create and focus input in the beginning
		// If there is an input in the beginning already, just focus it
		else if (event.key === "Home"
			&& (!focusedInput || (focusedInput.selectionStart === 0 && focusedInput.previousElementSibling))) {
			let input;
			if (isInput(qfe.firstChild)) {
				input = qfe.firstChild;
			}
			else {
				input = _createInputField();
				qfe.prepend(input);
			}
			input.focus();
		}
		// On End from the beginning of the input, create and focus input in the end.
		// If there is an input in the end already, just focus it
		else if (event.key === "End"
			&& (!focusedInput || (focusedInput.selectionStart === focusedInput.value.length && focusedInput.nextElementSibling))) {
			let input;
			if (isInput(qfe.childNodes[qfe.childNodes.length - 1])) {
				input = qfe.childNodes[qfe.childNodes.length - 1];
			}
			else {
				input = _createInputField();
				qfe.appendChild(input);
			}
			input.focus();
		}
		else if (keyCode == event.DOM_VK_TAB) {
			// Shift-Tab from the input field tries to focus on zotero icon dropdown
			if (event.shiftKey) {
				let icon = document.getElementById("zotero-icon");
				if (icon.getAttribute("disabled") != "true") {
					icon.focus();
					event.preventDefault();
					return;
				}
			}
			// Tab places focus on the existing input or creates a new one in the end
			if (_lastFocusedInput) {
				_lastFocusedInput.focus();
			}
			else {
				let newInput = _createInputField();
				qfe.appendChild(newInput);
				newInput.focus();
			}
			
			event.preventDefault();
		}
		else {
			isPaste = false;
		}
	});
	
	/**
	 * Adds a dummy element to make dragging work
	 */
	function _onBubbleDrag(event) {
		dragPlaceholder = this.cloneNode(true);
		dragPlaceholder.setAttribute("id", "dragged-placeholder");
		this.style.cursor = "grabbing";
		setTimeout(() => {
			this.setAttribute("id", "dragged-bubble");
			this.style.display = "none";
		});
		let index = _getBubbleIndex(this);
		event.dataTransfer.setData("zotero/citation_bubble", index);
		dragPlaceholder.setAttribute("original-index", index);
		event.dataTransfer.effectAllowed = "move";
		event.stopPropagation();
	}

	function _onBubbleDragOver(event) {
		event.preventDefault();
		let bubbleIndex = dragPlaceholder.getAttribute("original-index");
		let bubble = event.target;
		if (bubble.classList?.contains("editor")) {
			let { lastBubble, _ } = lastBubbleBeforePoint(event.clientX, event.clientY);
			if (!lastBubble) {
				return false;
			}
			bubble = lastBubble;
		}
		if (isNaN(parseInt(bubbleIndex)) || !bubble.classList?.contains("bubble")) {
			return false;
		}
		if (bubble.getAttribute("id") == "dragged-placeholder") {
			return true;
		}

		let placeholder = dragPlaceholder;
		let bubbleRect = bubble.getBoundingClientRect();
		let midpoint = (bubbleRect.right + bubbleRect.left) / 2;
		if (event.clientX > midpoint && bubble.nextElementSibling?.id !== "dragged-placeholder") {
			if (bubble.nextElementSibling) {
				qfe.insertBefore(placeholder, bubble.nextElementSibling);
			}
			else {
				qfe.appendChild(placeholder);
			}
			for (let linebreak of document.querySelectorAll("br")) {
				linebreak.remove();
			}
		}
		else if (event.clientX < midpoint && bubble.previousElementSibling?.id !== "dragged-placeholder") {
			let previousBubbleRect = bubble.previousElementSibling?.getBoundingClientRect();
			if (previousBubbleRect?.top && previousBubbleRect.top !== bubbleRect.top) {
				let linebreak = document.querySelector("br");
				if (!linebreak) {
					linebreak = document.createElement("br");
				}
				qfe.insertBefore(linebreak, bubble);
			}
			qfe.insertBefore(placeholder, bubble);
		}
		return false;
	}

	function onBubbleDragEnd(_) {
		if (dragPlaceholder) {
			dragPlaceholder.remove();
		}
		let bubble = document.getElementById("dragged-bubble");
		if (bubble) {
			bubble.style = "";
			bubble.removeAttribute("id");
		}
		for (let linebreak of document.querySelectorAll("br")) {
			linebreak.remove();
		}
	}

	/**
	 * Get index of bubble in citations
	 */
	function _getBubbleIndex(bubble) {
		var nodes = qfe.childNodes, index = 0;
		for (let node of nodes) {
			if (node.dataset && node.dataset.citationItem) {
				if (node == bubble) return index;
				index++;
			}
		}
		return -1;
	}
	
	/**
	 * Replaces the dummy element with a node to make dropping work
	 */
	var _onBubbleDrop = Zotero.Promise.coroutine(function* (event) {
		event.preventDefault();
		event.stopPropagation();
		let oldPosition = parseInt(dragPlaceholder.getAttribute("original-index"));
		let bubble = document.getElementById("dragged-bubble");
		if (isNaN(oldPosition) || !bubble) return;

		dragPlaceholder.after(bubble);

		// Manual call to resize after delay to avoid strange mozilla behaviors that affect
		// subsequent drag events when resizing happens around the same time as drag events
		setTimeout(() => {
			_resize();
		}, 50);

		// If moved out of order, turn off "Keep Sources Sorted"
		if(io.sortable && keepSorted && keepSorted.hasAttribute("checked") && oldPosition !== -1 &&
				oldPosition != _getBubbleIndex(bubble)) {
			keepSorted.removeAttribute("checked");
		}

		onBubbleDragEnd();

		yield _previewAndSort();
	});
	
	/**
	 * Handle a click on a bubble
	 */
	function _onBubbleClick(_) {
		// If citation properties dialog is opened for another bubble, just close it.
		if (panelRefersToBubble) {
			document.getElementById("citation-properties").hidePopup();
			return;
		}
		_showCitationProperties(this);
	}

	/**
	 * Called when the user attempts to paste
	 */
	function _onPaste(event) {
		event.stopPropagation();
		event.preventDefault();

		var str = Zotero.Utilities.Internal.getClipboard("text/unicode");
		if (str) {
			isPaste = true;
			this.value = str.replace(/[\r\n]/g, " ").trim();
			let width = widthOfContent(this);
			this.style.width = width + 'px';
			// Move curor to the end
			this.setSelectionRange(str.length, str.length);
			// Resize window to make it taller in case if the input moves to the next line
			_resize();
			_resetSearchTimer();
		}
	}
	
	/**
	 * Handle changes to citation properties
	 */
	this.onCitationPropertiesChanged = function(event) {
		let citationItem = JSON.parse(panelRefersToBubble.dataset.citationItem || "{}");
		if(panelPrefix.value) {
			citationItem["prefix"] = panelPrefix.value;
		} else {
			delete citationItem["prefix"];
		}
		if(panelSuffix.value) {
			citationItem["suffix"] = panelSuffix.value;
		} else {
			delete citationItem["suffix"];
		}
		if(panelLocatorLabel.selectedIndex !== 0) {
			citationItem["label"] = panelLocatorLabel.selectedItem.value;
		} else {
			delete citationItem["label"];
		}
		if(panelLocator.value) {
			citationItem["locator"] = panelLocator.value;
		} else {
			delete citationItem["locator"];
		}
		if(panelSuppressAuthor.checked) {
			citationItem["suppress-author"] = true;
		} else {
			delete citationItem["suppress-author"];
		}
		locatorLocked = "locator" in citationItem;
		locatorNode = panelRefersToBubble;
		panelRefersToBubble.dataset.citationItem = JSON.stringify(citationItem);
		panelRefersToBubble.textContent = _buildBubbleString(citationItem);
	};

	this.ignoreEvent = function (event) {
		event.stopPropagation();
	};
	
	/**
	 * Handle closing citation properties panel. Focus last opened input if possible.
	 * Otherwise, return focus to the bubble.
	 */
	this.onCitationPropertiesClosed = function(event) {
		if (!panelRefersToBubble) {
			return;
		}
		panelRefersToBubble.removeAttribute("selected");
		Zotero_QuickFormat.onCitationPropertiesChanged();
		if (_lastFocusedInput) {
			_lastFocusedInput.focus();
		}
		else {
			panelRefersToBubble.focus();
		}
		panelRefersToBubble = null;
	}
	
	/**
	 * Keyboard navigation within citation properties dialog
	 */
	this.onPanelKeyPress = function(event) {
		// Tabbing through the fields. This should not be necessary but for some reason
		// without manually handling focus, the buttons are skipped during tabbing
		if (event.key === "Tab") {
			event.preventDefault();
			let tabIndex = parseInt(event.target.closest("[tabindex]").getAttribute("tabindex"));
			tabIndex += event.shiftKey ? -1 : 1;
			if (tabIndex == 9) {
				tabIndex = 1;
			}
			if (tabIndex == 0) {
				tabIndex = 8;
			}

			panel.querySelector(`[tabindex='${tabIndex}']`).focus();
		}
		// Space or enter triggers a click on buttons, checkboxes or menulist
		if (event.key == ' ' || event.key === "Enter") {
			if (event.target.tagName == "button"
				|| event.target.getAttribute("type") == "checkbox") {
				event.target.click();
				event.stopPropagation();
				event.preventDefault();
			}
			else if (event.target.tagName == "menulist") {
				event.target.firstChild.openPopup();
				event.stopPropagation();
				event.preventDefault();
			}
			// Enter anywhere else closes the dialog
			else if (event.key === "Enter") {
				document.getElementById("citation-properties").hidePopup();
				event.stopPropagation();
				event.preventDefault();
			}
		}
		// Arrow up closes the popup
		if (event.key === "ArrowUp" && !(event.ctrlKey || event.altKey || event.metaKey)) {
			document.getElementById("citation-properties").hidePopup();
			event.stopPropagation();
			event.preventDefault();
		}
	};
	
	/**
	 * Handle checking/unchecking "Keep Citations Sorted"
	 */
	this.onKeepSortedCommand = function(event) {
		_previewAndSort();
	};
	
	/**
	 * Open classic Add Citation window
	 */
	this.onClassicViewCommand = function(event) {
		_updateCitationObject();
		var newWindow = window.newWindow = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
			.getService(Components.interfaces.nsIWindowWatcher)
			.openWindow(null, 'chrome://zotero/content/integration/addCitationDialog.xhtml',
			'', 'chrome,centerscreen,resizable', io);
		newWindow.addEventListener("focus", function() {
			newWindow.removeEventListener("focus", arguments.callee, true);
			window.close();
		}, true);
		accepted = true;
	}
	
	/**
	 * Show an item in the library it came from
	 */
	this.showInLibrary = async function (itemID) {
		let citationItem = JSON.parse(panelRefersToBubble.dataset.citationItem || "{}");
		var id = itemID || citationItem.id;
		var pane = Zotero.getActiveZoteroPane();
		// Open main window if it's not open (Mac)
		if (!pane) {
			let win = Zotero.openMainWindow();
			await new Zotero.Promise((resolve) => {
				let onOpen = function () {
					win.removeEventListener('load', onOpen);
					resolve();
				};
				win.addEventListener('load', onOpen);
			});
			pane = win.ZoteroPane;
		}
		pane.selectItem(id);
		
		// Pull window to foreground
		Zotero.Utilities.Internal.activate(pane.document.defaultView);
	}
	
	/**
	 * Resizes windows
	 * @constructor
	 */
	var Resizer = function(panel, targetWidth, targetHeight, pixelsPerStep, stepsPerSecond) {
		this.panel = panel;
		this.curWidth = panel.clientWidth;
		this.curHeight = panel.clientHeight;
		this.difX = (targetWidth ? targetWidth - this.curWidth : 0);
		this.difY = (targetHeight ? targetHeight - this.curHeight : 0);
		this.step = 0;
		this.steps = Math.ceil(Math.max(Math.abs(this.difX), Math.abs(this.difY))/pixelsPerStep);
		this.timeout = (1000/stepsPerSecond);
		
		var me = this;
		this._animateCallback = function() { me.animate() };
	};
	
	/**
	 * Performs a step of the animation
	 */
	Resizer.prototype.animate = function() {
		if(this.stopped) return;
		this.step++;
		this.panel.sizeTo(this.curWidth+Math.round(this.step*this.difX/this.steps),
			this.curHeight+Math.round(this.step*this.difY/this.steps));
		if(this.step !== this.steps) {
			window.setTimeout(this._animateCallback, this.timeout);
		}
	};
	
	/**
	 * Halts resizing
	 */
	Resizer.prototype.stop = function() {
		this.stopped = true;
	};
}

window.addEventListener("DOMContentLoaded", Zotero_QuickFormat.onDOMContentLoaded, false);
window.addEventListener("load", Zotero_QuickFormat.onLoad, false);
window.addEventListener("keydown", Zotero_QuickFormat.throttleEscapeEnter, true);
