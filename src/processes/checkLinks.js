const {
	SiteChecker,
	HtmlUrlChecker
} = require("broken-link-checker");
const { send } = require("process");
let userCancelled = false;


// receive message from master process
process.on('message', (m) => {

	if( (m[0] === "start-scan") && (m[1] !== 'undefined')) {
		checkLinks(m[1]).then((data) => process.send(["scan-finished", data]));
	} else if ( (m[0] === "cancel-scan") && (m[1] !== 'undefined')) {
		userCancelled = true;
		sendDebugData('We just cancelled it');
	}

});

let checkLinks = function(siteURL) {
	return new Promise(function(resolve, reject) {

		let siteCheckerSiteId = null;

		// TODO: Handle self-signed certificates more securely, like https://stackoverflow.com/questions/20433287/node-js-request-cert-has-expired#answer-29397100
		process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

		let options = new Object();
		options.maxSocketsPerHost = 10;

		let siteChecker = new SiteChecker(options, {
			html: (tree, robots, response, pageUrl, customData) => {

				if(userCancelled){
					// User cancelled the scan

					try {
						if(siteChecker.dequeue(siteCheckerSiteId)){
							callCancelSuccess();
						}
					} catch(e){
						sendDebugData("error in dequeueing the site");
					}
					// sendDebugData('This is the  number of links with active requests.');
					// sendDebugData(siteChecker.numActiveLinks());
					// sendDebugData('This is the  total number of pages in the queue.');
					// sendDebugData(siteChecker.numPages());
					// sendDebugData('This is the  number of links that currently have no active requests.');
					// sendDebugData(siteChecker.numQueuedLinks());

					siteChecker.pause();
					//.numSites()
				}


				// This code is used to increment the number of WP posts we traverse in our scan
				if (findWpPostIdInMarkup(tree)) {
					incrementNumberPostsFound();
					updateCurrentCheckingUri(pageUrl);
				}
			},
			link: (result, customData) => {
				try {
					if (result.broken && (result.http.response.statusCode != 999)) {

						let statusCode = '';
						let statusCodeCheck = result.http.response && result.http.response.statusCode;

						if(result.brokenReason === "HTTP_undefined"){
							statusCode = "Timeout";
						} else if(containsPhpError(String(result.html.text))){
							statusCode = "Error";
						} else if(!statusCodeCheck && result.http.response && result.http.response.code) {
							// Fallback to error code from response for things like bad domains.
							statusCode = result.http.response.code;
						} else {
							//statusCode = String(result.http.response.statusCode);
							statusCode = statusCodeCheck;
						}

						// Old status code handling (remove after testing)
						//let statusCode = '';
						// if(result.brokenReason === "HTTP_undefined"){
						// 	statusCode = "Timeout";
						// } else if(containsPhpError(String(result.html.text))){
						// 	statusCode = "Error";
						// } else {
						// 	statusCode = String(result.http.response.statusCode);
						// }

						let linkText = '';
						if(result.html.text){
							if(containsPhpError(String(result.html.text))){
								linkText = containsPhpError(String(result.html.text));
							} else {
								linkText = String(result.html.text);
							}
						}

						let brokenLinkScanResults = {
							statusCode: String(statusCode),
							linkURL: String(result.url.original),
							linkText: String(linkText),
							originURL: String(result.base.original),
							originURI: String(result.base.parsed.path),
							resultDump: result
						};

						let singlePageChecker = new HtmlUrlChecker(null, {
							html: (tree, robots, response, pageUrl, customData) => {

								let wpPostId = findWpPostIdInMarkup(tree);

								if (wpPostId !== null) {
									addBrokenLink(
										customData["statusCode"],
										customData["linkURL"],
										customData["linkText"],
										customData["originURL"],
										customData["originURI"],
										wpPostId
									);

									updateBrokenLinksFound(true);
								}
							}
						});

						singlePageChecker.enqueue(
							brokenLinkScanResults["originURL"],
							brokenLinkScanResults
						);
					}
				} catch(e){
					// The "broken" link was missing critical fields (such as a status code), so we skip
					reportError('caught-error-while-checking-broken-or-999-status-code', e);
					sendDebugData('caught-error-while-checking-broken-or-999-status-code');
					sendDebugData(e);
				}
			},
			site: (error, siteUrl, customData) => {
				reportError('site-scan-threw-site-error', JSON.stringify(error));
				sendDebugData(`This URL was involved in the error: ${siteUrl}`);
				sendDebugData('Oh and this was the error');
				sendDebugData(error);
			},
			end: (result, customData) => {
				// At last the first run is done, so we update the state
				updateFirstRunComplete(true);
				updateScanInProgress(false);
				callScanFinished(true);
				
				resolve('finished');
			},
		});
		siteCheckerSiteId = siteChecker.enqueue(siteURL);

	});
}



function findWpPostIdInMarkup(tree) {
	let stringOfBodyClasses = '';

	tree.childNodes.forEach(function(item,key){
		if(item.nodeName === "html"){
			item.childNodes.forEach(function(item,key){
				if(item.nodeName === "body"){
					stringOfBodyClasses = item.attrMap.class;
				}
			})
		}
	});

	// TODO: Also make note of special classes like .home
	let findPostId = stringOfBodyClasses.match(
		/(^|\s)postid-(\d+)(\s|$)/
	);

	let findPageId = stringOfBodyClasses.match(
		/(^|\s)page-id-(\d+)(\s|$)/
	);

	let wpPostId = null;
	if (findPostId) {
		wpPostId = findPostId[2];
	} else if (findPageId) {
		wpPostId = findPageId[2];
	}

	return wpPostId;
}

function containsPhpError(string){
	let subString = '';
	if(string.indexOf(':') && string.indexOf('fatal error')){
		subString = string.substring(0, string.indexOf(':'));
	} else {
		return false;
	}

	return (subString === '') ? false : subString;
}

// Functions used to track data during the check links process
function incrementNumberPostsFound(){
	// Needs to call incrementNumberPostsFound() back in the renderer
	process.send(["increment-number-posts-found", 'yes']);
}

function updateCurrentCheckingUri(pageUrl){
	// Needs to call updateCurrentCheckingUri() back in the renderer
	process.send(["update-current-checking-uri", pageUrl]);
}

function addBrokenLink(statusCode, linkURL, linkText, originURL, originURI, wpPostId){
	// Needs to make addBrokenLink() and incrementNumberBrokenLinksFound() be called back in renderer
	process.send( ["add-broken-link", [statusCode, linkURL, linkText, originURL, originURI, wpPostId] ] );
}

function updateBrokenLinksFound(boolean){
	// Needs to call updateBrokenLinksFound() back in the renderer
	process.send(["update-broken-links-found-boolean", boolean]);
}

function updateFirstRunComplete(boolean){
	// Needs to call updateFirstRunComplete() back in renderer
	process.send(["update-first-run-complete-boolean", boolean]);
}

function updateScanInProgress(boolean){
	// Needs to call updateScanInProgress() back in renderer
	process.send(["update-scan-in-progress-boolean", boolean]);
}

function callScanFinished(boolean){
	process.send(["scan-finished", boolean]);
}

function callCancelSuccess(){
	process.send(["scan-cancelled-success", true]);
}

function reportError(name, errorInfo){
	process.send(["error-encountered", name, errorInfo]);
}

function sendDebugData(data){
	process.send(["debug-data", data]);
}
