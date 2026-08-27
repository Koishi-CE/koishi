declare module "which-pm-runs" {
	interface PMAgent {
		name: string;
		version: string;
	}
	export function whichPMRuns(): PMAgent | undefined;
}
