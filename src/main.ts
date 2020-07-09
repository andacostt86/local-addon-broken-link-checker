import * as LocalMain from "@getflywheel/local/main";
const { fork } = require('child_process');
import path from 'path';
import ipcAsync from "./ipcAsync"; // This might not be the solution I use
const process = fork(path.join(__dirname, '../src/processes', 'checkLinks.jsx'), null, {
	stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});

export default function (context) {
	const { electron } = context;
	const { ipcMain } = electron;
	let theSiteId = null;

	ipcMain.on("store-broken-links", (event, siteId, brokenLinks) => {
		LocalMain.SiteData.updateSite(siteId, {
			id: siteId,
			brokenLinks,
		});
	});

	ipcMain.on("get-total-posts", async (event, replyChannel, siteId, prefix) => {
		event.reply(replyChannel, await getTotalPosts(siteId, prefix));
	});

	ipcMain.on("get-table-prefix", async (event, replyChannel, siteId) => {
		theSiteId = siteId;
		event.reply(replyChannel, await getTablePrefix(siteId));
	});

	ipcMain.on("fork-process", async (event, replyChannel, command, siteURL) => {
		LocalMain.getServiceContainer().cradle.localLogger.log(
			"info",
			`FORKPROCESS Received request to fork the process`
		); // This gets logged
		event.reply(replyChannel, await spawnChildProcess(command, siteURL));
	});

	// When process sends message that's not in response to a direct command from renderer
	// This might not be the solution I use
	process.on('message', (message) => {
		LocalMain.getServiceContainer().cradle.localLogger.log(
		   "info",
		   `FORKPROCESS The process sent over this message ${message}`
		); 
		ipcAsync("blc-process-add-broken-link", theSiteId, message);
	 });
}

async function getTotalPosts(siteId, prefix) {
	const site = LocalMain.SiteData.getSite(siteId);

	let numberOfPostsDbCall = await LocalMain.getServiceContainer().cradle.siteDatabase.exec(
		site,
		[
			"local",
			"--batch",
			"--skip-column-names",
			"-e",
			"SELECT COUNT(ID) FROM " + prefix + "posts WHERE post_status = 'publish'",
		]
	).catch((error) => {
		LocalMain.getServiceContainer().cradle.localLogger.log(
			"info",
			"STARTDEBUG encountered this error when calling DB: " + error
		);
	});

	// then((data) => {
	// 	LocalMain.getServiceContainer().cradle.localLogger.log(
	// 		"info",
	// 		"STARTDEBUG Hey here is some data from the db call: " + data
	// 	);
	// })
	

	LocalMain.getServiceContainer().cradle.localLogger.log(
		"info",
		`test in getTotalPosts(): ${numberOfPostsDbCall}`
	);

	return numberOfPostsDbCall;
}

async function getTablePrefix(siteId) {
	const site = LocalMain.SiteData.getSite(siteId);

	let wpPrefixCall = await LocalMain.getServiceContainer().cradle.siteDatabase.getTablePrefix(site).catch((error) => {
		LocalMain.getServiceContainer().cradle.localLogger.log(
			"info",
			"Encountered this error when getting table prefix: " + error
		);
	});

	return wpPrefixCall;
}

async function spawnChildProcess(command, siteURL) {

	process.send([command,siteURL]);   // poke the bull so the bull can send something back

	try {
		let returnMessage = await new Promise((resolve) => {
			process.on('message', (message) => {
			   LocalMain.getServiceContainer().cradle.localLogger.log(
				  "info",
				  `FORKPROCESS They indeed received the ${message[0]}`
			   ); // this now gets logged!
			   resolve(message);
			});
		 });
		 return returnMessage;
	}
	catch (e) {
		LocalMain.getServiceContainer().cradle.localLogger.log(
			"info",
			`FORKPROCESS There was an error returned from the process: ${e}`
		); 
		return false;
	}
}