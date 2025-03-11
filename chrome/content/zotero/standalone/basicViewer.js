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

/*const { E10SUtils } = ChromeUtils.import(
	"resource://gre/modules/E10SUtils.jsm"
);*/

const SANDBOXED_SCRIPTS = 0x80;

var browser;

window.addEventListener("load", /*async */function () {
	browser = document.querySelector('browser');
	
	browser.addEventListener('pagetitlechanged', () => {
		document.title = browser.contentTitle || browser.currentURI.spec;
	});
	
	/*
	browser.setAttribute("remote", "true");
	//browser.setAttribute("remoteType", E10SUtils.EXTENSION_REMOTE_TYPE);
	
	await new Promise((resolve) => {
		browser.addEventListener("XULFrameLoaderCreated", () => resolve());
	});
	*/
	
	/*browser.messageManager.loadFrameScript(
		'chrome://zotero/content/standalone/basicViewerContent.js',
		false
	);*/
	//browser.docShellIsActive = false;

	// Get URI and options passed in via openWindow()
	let { uri, options } = window.arguments[0].wrappedJSObject;
	window.viewerOriginalURI = uri;
	loadURI(Services.io.newURI(uri), options);
}, false);

window.addEventListener("unload", function () {
	RequestObserver.unregister();
});

window.addEventListener("keypress", function (event) {
	// Cmd-R/Ctrl-R (with or without Shift) to reload
	if (((Zotero.isMac && event.metaKey && !event.ctrlKey)
			|| (!Zotero.isMac && event.ctrlKey))
			&& !event.altKey && event.which == 114) {
		browser.reloadWithFlags(browser.webNavigation.LOAD_FLAGS_BYPASS_CACHE);
	}
});

window.addEventListener('dragover', (e) => {
	// Prevent default to allow drop (e.g. to allow dropping an XPI on the Add-ons window)
	e.preventDefault();
});

function loadURI(uri, options = {}) {
	// browser.browsingContext.allowJavascript (sic) would seem to do what we want here,
	// but it has no effect. So we use sandboxFlags instead:
	if (options.allowJavaScript !== false) {
		browser.browsingContext.sandboxFlags &= ~SANDBOXED_SCRIPTS;
	}
	else {
		browser.browsingContext.sandboxFlags |= SANDBOXED_SCRIPTS;
	}
	if (options.cookieSandbox) {
		options.cookieSandbox.attachToBrowser(browser);
	}

	RequestObserver.register();

	browser.loadURI(
		uri,
		{
			triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
		}
	);
}


// There is a POST request that fails with NS_BINDING_ABORTED status. Rerunning
// that request gets the captcha to pass somehhow. Here, wait for that POST
// request to fail and then try to rerun it manually with the same payload.
var RequestObserver = {
	requests: new Map(),
  
	register: function () {
		Services.obs.addObserver(this, "http-on-opening-request", false);
		Services.obs.addObserver(this, "http-on-examine-response", false);
		Services.obs.addObserver(this, "http-on-examine-merged-response", false);
		Services.obs.addObserver(this, "http-on-stop-request", false);
	},
  
	unregister: function () {
		Services.obs.removeObserver(this, "http-on-opening-request");
		Services.obs.removeObserver(this, "http-on-examine-response");
		Services.obs.removeObserver(this, "http-on-examine-merged-response");
		Services.obs.removeObserver(this, "http-on-stop-request");
	},
  
	// Get request body from upload stream
	getRequestBody: function (uploadChannel) {
		try {
			if (!uploadChannel) return null;
      
			let uploadStream = uploadChannel.QueryInterface(Ci.nsIUploadChannel).uploadStream;
			if (!uploadStream) return null;
      
			// Try to rewind the stream
			if (uploadStream instanceof Ci.nsISeekableStream) {
				uploadStream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
			}
			else {
				return null;
			}
      
			// Read the stream content
			let stream = Cc["@mozilla.org/scriptableinputstream;1"]
        		.createInstance(Ci.nsIScriptableInputStream);
			stream.init(uploadStream);
      
			let body = stream.read(stream.available());
      
			// Rewind again
			if (uploadStream instanceof Ci.nsISeekableStream) {
				uploadStream.seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);
			}
      
			return body;
		}
		catch (e) {
			console.log("RequestObserver: Error reading request body: " + e);
			return null;
		}
	},
  
	observe: function (subject, topic, data) {
		try {
			let channel = subject.QueryInterface(Ci.nsIHttpChannel);
			let requestId = channel.channelId;
      
			// Record when post request arrives
			if (topic === "http-on-opening-request") {
				if (channel.requestMethod !== "POST") return;
        
				// Store information about the request
				let requestInfo = {
					id: requestId,
					url: channel.URI.spec,
					method: channel.requestMethod,
					startTime: Date.now(),
					headers: {}
				};
        
				// Get headers
				channel.visitRequestHeaders({
					visitHeader: function(name, value) {
						requestInfo.headers[name] = value;
					}
				});
        
				// Get request body
				if (channel instanceof Ci.nsIUploadChannel) {
					requestInfo.body = this.getRequestBody(channel);
				}
        
				this.requests.set(requestId, requestInfo);
			}
      
			// Wait for the POST request to fail to retry
			else if (topic === "http-on-stop-request") {
				if (!this.requests.has(requestId)) return;
        
				let requestInfo = this.requests.get(requestId);
				requestInfo.endTime = Date.now();
				requestInfo.duration = requestInfo.endTime - requestInfo.startTime;
				let status = subject.QueryInterface(Ci.nsIRequest).status;
        
				// NS_BINDING_ABORTED is 0x804b0002
				const NS_BINDING_ABORTED = 0x804b0002;
				if (status === NS_BINDING_ABORTED) {
					requestInfo.error = "NS_BINDING_ABORTED";
          
					// Log detailed information about the aborted request
					console.log("===================== ABORTED POST REQUEST DETAILS =====================");
					console.log("URL: " + requestInfo.url);
					console.log("Method: " + requestInfo.method);
					console.log("Status: " + (requestInfo.statusCode || "N/A"));
					console.log("Duration: " + requestInfo.duration + "ms");
					console.log("Headers: " + JSON.stringify(requestInfo.headers, null, 2));
					console.log("Body: " + requestInfo.body);
					console.log("===================================================================");
          
					setTimeout(() => {
						retryRequestWithFetch(requestInfo)
							.then(result => {
								console.log("Request retried successfully:", result);
							})
							.catch(error => {
								console.error("Retry attempt failed:", error);
							});
					}, 3000);
				}
				// Clean up
				this.requests.delete(requestId);
			}
		}
		catch (e) {
			console.log("RequestObserver: Error in observer: " + e);
		}
	}
};

window.addEventListener("unload", function() {
	// Clean up on window close
	RequestObserver.unregister();
}, false);


function retryRequestWithFetch(requestInfo) {
	// Add headers from the original request
	let headers = new Headers();
	for (let name in requestInfo.headers) {
	  headers.append(name, requestInfo.headers[name]);
	}

	let fetchOptions = {
	  method: requestInfo.method,
	  headers: headers,
	  redirect: 'manual',
	  credentials: 'include',
	};
	
	// Add body for POST requests
	if (requestInfo.method === 'POST' && requestInfo.body) {
	  fetchOptions.body = requestInfo.body;
	}
	
	// Perform the fetch request
	return fetch(requestInfo.url, fetchOptions);
}
