import CAC from "cac";
import registerCloneCommand from "./clone";
import registerSetupCommand from "./setup";

const { version } = require("../package.json");

const cli = CAC("koishi-scripts").help().version(version);

registerCloneCommand(cli);
registerSetupCommand(cli);

cli.parse();

if (!cli.matchedCommand) {
	cli.outputHelp();
}
