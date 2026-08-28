#!/usr/bin/env bun

import { cac } from "cac";
import { version } from "../../package.json" with { type: "json" };
import registerStartCommand from "./start";

const cli = cac("koishi").help().version(version);

registerStartCommand(cli);

const argv = cli.parse();

if (!cli.matchedCommand && !argv.options["help"]) {
	cli.outputHelp();
}
