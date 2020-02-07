import React, { Component, Fragment } from "react";
import { ipcRenderer } from "electron";
const { SiteChecker, HtmlUrlChecker, UrlChecker } = require("broken-link-checker");
import { TableListRepeater } from "@getflywheel/local-components";

export default class BrokenLinkChecker extends Component {
	constructor(props) {
		super(props);

		this.state = {
			brokenLinks: this.fetchBrokenLinks(),
			resultsOnScreen: this.ifBrokenLinksFetched(),
			firstRunComplete: false,
			brokenLinksFound: false,
			siteStatus: null,
			siteRootUrl: null,
			siteId: null
		};

		this.checkLinks = this.checkLinks.bind(this);
		this.updateSiteState = this.updateSiteState.bind(this);
	}

	componentDidMount() {
		let routeChildrenProps = this.props.routeChildrenProps;
		let siteStatus = routeChildrenProps.siteStatus;
		let site = routeChildrenProps.site;
		let siteDomain = site.domain;

		let siteId = routeChildrenProps.site.id;

		// TODO: Add checking to see if site is running with HTTP or HTTPS. Right now HTTP is assumed
		//let possibleSecureHttpStatus = site.services.nginx.ports.HTTP;
		//let otherPossibleSecureHttpStatus = site.services.nginx.role;

		//let siteUrl = "http://" + siteDomain;

		this.testSiteRootUrlVariantsAndUpdate(siteDomain);
		//this.updateSiteRootUrl(siteUrl);
		this.updateSiteId(siteId);
		this.updateSiteState(siteStatus);
	}

	addBrokenLink(statusCode, linkURL, linkText, originURL, wpPostId) {
		let newBrokenLink = {
			statusCode: statusCode,
			linkURL: linkURL,
			linkText: linkText,
			originURL: originURL,
			wpPostId: wpPostId
		};

		this.updateResultsOnScreen(true);

		this.setState(
			prevState => ({
				brokenLinks: [...prevState.brokenLinks, newBrokenLink]
			}),
			this.syncBrokenLinks
		);
	}

	clearBrokenLinks() {
		this.setState({ brokenLinks: [] }, this.syncBrokenLinks);
	}

	syncBrokenLinks() {
		ipcRenderer.send(
			"store-broken-links",
			this.state.siteId,
			this.state.brokenLinks
		);
	}

	fetchBrokenLinks() {
		const brokenLinks = this.props.routeChildrenProps.site.brokenLinks;

		if (!brokenLinks) {
			return [];
		}

		return brokenLinks;
	}

	ifBrokenLinksFetched() {
		const brokenLinks = this.props.routeChildrenProps.site.brokenLinks;

		if (!brokenLinks) {
			return false;
		}

		return true;
	}

	testSiteRootUrlVariantsAndUpdate(siteDomain) {

		let options = {
			'cacheResponses': false,
			'rateLimit': 500
		};

		let isUrlBrokenChecker = new UrlChecker(options, {
			link: function (result, customData) {
				if (!result.broken) {
					let workingUrl = result.url.original;

					console.log('Not Broken:');
					console.log(result);
					return;
				} else {
					console.log('Broken:');
					console.log(result);
				}
			},
			end: function () { console.log('This is the end'); }
		});
		isUrlBrokenChecker.enqueue('http://' + siteDomain + '/');
		isUrlBrokenChecker.enqueue('https://' + siteDomain + '/');
		isUrlBrokenChecker.enqueue('http://' + siteDomain + '/');
		isUrlBrokenChecker.enqueue('https://' + siteDomain + '/');

		this.setState(prevState => ({
			siteRootUrl: 'http://' + siteDomain
		}));
	}

	updateSiteState(newStatus) {
		this.setState(prevState => ({
			siteStatus: newStatus
		}));
	}

	updateSiteRootUrl(siteUrl) {
		this.setState(prevState => ({
			siteRootUrl: siteUrl
		}));
	}

	updateSiteId(siteId) {
		this.setState(prevState => ({
			siteId: siteId
		}));
	}

	updateResultsOnScreen(boolean) {
		this.setState(prevState => ({
			resultsOnScreen: boolean
		}));
	}

	updateBrokenLinksFound(boolean) {
		this.setState(prevState => ({
			brokenLinksFound: boolean
		}));
	}

	updateFirstRunComplete(boolean) {
		this.setState(prevState => ({
			firstRunComplete: boolean
		}));
	}

	startScan = () => {
		let routeChildrenProps = this.props.routeChildrenProps;
		let siteStatus = routeChildrenProps.siteStatus;

		// Clear the existing broken links on screen if some have been rendered already
		if (this.state.resultsOnScreen) {
			this.clearBrokenLinks();
		}

		if (
			String(this.state.siteStatus) !== "halted" &&
			this.state.siteStatus != null
		) {
			this.checkLinks(this.state.siteRootUrl);
		} else {
			this.updateSiteState(siteStatus);
		}
	};

	checkLinks(siteURL) {
		let siteChecker = new SiteChecker(null, {
			link: (result, customData) => {
				if (result.broken) {
					let brokenLinkScanResults = {
						statusCode: String(result.http.response.statusCode),
						linkURL: String(result.url.original),
						linkText: String(result.html.text),
						originURL: String(result.base.original)
					};

					let singlePageChecker = new HtmlUrlChecker(null, {
						html: (tree, robots, response, pageUrl, customData) => {
							// TODO: Make this code continue to drill down until an exact match for the 'body' tag is found, just in case a custom template has modified the usual page structure
							let stringOfBodyClasses =
								tree.childNodes[1].childNodes[2].attrMap.class;

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

							this.addBrokenLink(
								customData["statusCode"],
								customData["linkURL"],
								customData["linkText"],
								customData["originURL"],
								wpPostId
							);
						}
					});
					singlePageChecker.enqueue(
						brokenLinkScanResults["originURL"],
						brokenLinkScanResults
					);

					this.updateBrokenLinksFound(true);
				}
			},
			end: (result, customData) => {
				// At last the first run is done, so we update the state
				this.updateFirstRunComplete(true);
			}
		});
		siteChecker.enqueue(siteURL);
	}

	render() {
		let message = "";
		if (this.state.siteStatus === "halted") {
			message = "Please start the site before running a link scan.";
		} else if (
			this.state.firstRunComplete &&
			!this.state.brokenLinksFound
		) {
			message = "No broken links found.";
		}

		let startButtonText = "Start Scan";
		if (this.state.resultsOnScreen) {
			startButtonText = "Re-Run Scan";
		}

		return (
			<div style={{ flex: "1", overflowY: "auto" }} className="brokenLinkCheckWrap">
				<p>{message}</p>

				<TableListRepeater
					header={
						<>
							<strong
								className="TableListRowHeader__SeparatorRight"
								style={{ width: "10%" }}
							>
								Status
          </strong>
							<strong style={{ width: "35%" }}>Origin URL</strong>
							<strong style={{ width: "30%" }}>Link URL</strong>
							<strong style={{ width: "15%" }}>Link Text</strong>
							<strong style={{ width: "10%" }}>Post ID</strong>
						</>
					}
					repeatingContent={(item, index, updateItem) => (
						<>
							<div className="TableListRowHeader__SeparatorRight">
								{item.statusCode}
							</div>

							<div><a href={item.originURL}>
								{item.originURL}
							</a></div>

							<div><a href={item.linkURL}>
								{item.linkURL}
							</a></div>

							<div><p>{item.linkText}</p></div>

							<div>{item.wpPostId}{" "}
								{item.wpPostId != null ? "(" : ""}
								<a
									href={
										this.state.siteRootUrl +
										"/wp-admin/post.php?post=" +
										item.wpPostId +
										"&action=edit"
									}
								>
									{item.wpPostId != null ? "Edit" : ""}
								</a>
								{item.wpPostId != null ? ")" : ""}</div>
						</>
					)}
					onSubmit={() => console.log('onSubmit')}
					submitLabel={startButtonText}
					itemTemplate={{}}
					data={this.state.brokenLinks}
				/>
				<a
					href="javascript:void(0);"
					onClick={this.startScan}
					style={{ marginTop: 15, marginLeft: 2, display: "block" }}
				>
					{startButtonText}
				</a>
			</div>
		);
	}
}
