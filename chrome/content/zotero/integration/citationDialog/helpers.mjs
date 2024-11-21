var { Zotero } = ChromeUtils.importESModule("chrome://zotero/content/zotero.mjs");

// General helper functions
export class CitationDialogHelpers {
	constructor({ doc }) {
		this.doc = doc;
	}

	createNode(type, attributes, className) {
		let node = this.doc.createElement(type);
		for (let [key, val] of Object.entries(attributes)) {
			node.setAttribute(key, val);
		}
		node.className = className;
		return node;
	}

	buildItemDescription(item) {
		let descriptionWrapper = this.doc.createElement("div");
		descriptionWrapper.classList = "description";
		let wrapTextInSpan = (text, styles = {}) => {
			let span = this.doc.createElement("span");
			for (let [style, value] of Object.entries(styles)) {
				span.style[style] = value;
			}
			span.textContent = text;
			return span;
		};
		let addPeriodIfNeeded = (node) => {
			if (node.textContent.length && node.textContent[node.textContent.length - 1] !== ".") {
				let period = this.doc.createElement("span");
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

		// If no info, add a space so the rows are of the same length
		if (descriptionWrapper.childElementCount === 0) {
			descriptionWrapper.innerText = " ";
		}

		return descriptionWrapper;
	}

	buildItemsSection(id, headerText) {
		let section = this.createNode("div", { id }, "section");
		let header = this.createNode("div", {}, "header");
		header.innerText = headerText;
		let itemContainer = this.createNode("div", {}, "itemsContainer");
		section.append(header, itemContainer);
		return section;
	}

	// Fetch locator from a string and return an object: { label: string, page: string, onlyLocator: bool}
	// to identify the locator and pass that info to the dialog
	fetchLocator(string) {
		const numberRegex = /^[0-9\-–]+$/;
		if (numberRegex.test(string)) {
			return {
				label: "page",
				locator: string,
				onlyLocator: true,
				fullLocatorString: string
			};
		}
		
		// Check for different ways of typing the page locator
		const pageRegex = /^(?:,? *(p{1,2})(?:\. *| *)|:)([0-9\-–]+) *$/;
		let pageLocator = pageRegex.exec(string);
		if (pageLocator && pageLocator.length) {
			return {
				label: "page",
				locator: pageLocator[2],
				onlyLocator: pageLocator[0].length == string.length,
				fullLocatorString: pageLocator[0]
			};
		}
		// Check for a generalized way of typing any other locator in full or short form
		// Capture the first word (e.g. "act") followed by optional : or . with any number of whitespaces.
		// Then, capture either any text surrounded with " or ' (e.g. book: "Book title")
		// or just any word (e.g. l. 10)
		const generalRegex = /(\w+)\s*[:.]?\s*(?:(['"])(.*?)\2|(\w+))$/;
		let generalLocator = generalRegex.exec(string);
		if (generalLocator?.length) {
			let typedLocatorLabel = generalLocator[1].toLowerCase();
			let existingLocators = Zotero.Cite.labels;
			for (let existingLocator of existingLocators) {
				let locatorLabel = Zotero.Cite.getLocatorString(existingLocator).toLowerCase();
				// strip short locator labels of punctuation, so that e.g. for line locator, "l 10" is still counted as "l. 10"
				let locatorLabelShort = Zotero.Cite.getLocatorString(existingLocator, "short").replace(/[.,;:{}()]/g, "").toLowerCase();
				if (typedLocatorLabel == locatorLabel || typedLocatorLabel == locatorLabelShort) {
					// fetch either text in quotes or the last word without quotes as locator value
					let locatorValue = generalLocator[3] || generalLocator[4];
					return {
						label: existingLocator,
						locator: locatorValue,
						onlyLocator: generalLocator[0].length == string.length,
						fullLocatorString: generalLocator[0]
					};
				}
			}
		}
		return null;
	}
}
