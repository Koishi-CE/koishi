import { type Component, defineComponent, h } from "vue";
import Download from "~icons/k/download";
import FileArchive from "~icons/k/file-archive";
/**
 * market 图标注册表（<market-icon> 组件）。
 *
 * 图标已收敛进 @koishi-ce/components 的集中 .svg 资产（assets/icons/，
 * 经 ~icons/k/* 虚拟模块在编译期转组件，构建接线见 console-builder 的
 * icons.ts；该 vendor 子树经授权豁免上游同步纪律，见 upstream.md）。
 * misc 平名组中与主库同名同语义的 6 个（download / file-archive /
 * search / star-empty / star-full / tag）直接复用主库资产，其余以
 * market- 前缀命名；outline / solid 两套线型以 market-outline- /
 * market-solid- 前缀保留。渲染层与 name 查找契约不变，调用点零改动。
 */
import Asc from "~icons/k/market-asc";
import Award from "~icons/k/market-award";
import Balance from "~icons/k/market-balance";
import Close from "~icons/k/market-close";
import Desc from "~icons/k/market-desc";
import HeartPulse from "~icons/k/market-heart-pulse";
import Insecure from "~icons/k/market-insecure";
import Installed from "~icons/k/market-installed";
import Newborn from "~icons/k/market-newborn";
import OutlineAdapter from "~icons/k/market-outline-adapter";
import OutlineAi from "~icons/k/market-outline-ai";
import OutlineCore from "~icons/k/market-outline-core";
import OutlineExtension from "~icons/k/market-outline-extension";
import OutlineGame from "~icons/k/market-outline-game";
import OutlineGametool from "~icons/k/market-outline-gametool";
import OutlineGeneral from "~icons/k/market-outline-general";
import OutlineImage from "~icons/k/market-outline-image";
import OutlineLife from "~icons/k/market-outline-life";
import OutlineManage from "~icons/k/market-outline-manage";
import OutlineMedia from "~icons/k/market-outline-media";
import OutlineMeme from "~icons/k/market-outline-meme";
import OutlineOther from "~icons/k/market-outline-other";
import OutlinePreset from "~icons/k/market-outline-preset";
import OutlineTool from "~icons/k/market-outline-tool";
import OutlineWebUI from "~icons/k/market-outline-webui";
import Portable from "~icons/k/market-portable";
import Preview from "~icons/k/market-preview";
import SolidAdapter from "~icons/k/market-solid-adapter";
import SolidAi from "~icons/k/market-solid-ai";
import SolidAll from "~icons/k/market-solid-all";
import SolidCore from "~icons/k/market-solid-core";
import SolidExtension from "~icons/k/market-solid-extension";
import SolidGame from "~icons/k/market-solid-game";
import SolidGametool from "~icons/k/market-solid-gametool";
import SolidGeneral from "~icons/k/market-solid-general";
import SolidImage from "~icons/k/market-solid-image";
import SolidLife from "~icons/k/market-solid-life";
import SolidManage from "~icons/k/market-solid-manage";
import SolidMedia from "~icons/k/market-solid-media";
import SolidMeme from "~icons/k/market-solid-meme";
import SolidOther from "~icons/k/market-solid-other";
import SolidPreset from "~icons/k/market-solid-preset";
import SolidTool from "~icons/k/market-solid-tool";
import SolidWebUI from "~icons/k/market-solid-webui";
import StarHalf from "~icons/k/market-star-half";
import Verified from "~icons/k/market-verified";
import Search from "~icons/k/search";
import StarEmpty from "~icons/k/star-empty";
import StarFull from "~icons/k/star-full";
import Tag from "~icons/k/tag";

const misc: Record<string, Component> = {
	asc: Asc,
	award: Award,
	balance: Balance,
	close: Close,
	desc: Desc,
	download: Download,
	"file-archive": FileArchive,
	"heart-pulse": HeartPulse,
	insecure: Insecure,
	installed: Installed,
	newborn: Newborn,
	portable: Portable,
	preview: Preview,
	search: Search,
	"star-empty": StarEmpty,
	"star-full": StarFull,
	"star-half": StarHalf,
	tag: Tag,
	verified: Verified,
};

const outline: Record<string, Component> = {
	"outline:adapter": OutlineAdapter,
	"outline:ai": OutlineAi,
	"outline:core": OutlineCore,
	"outline:extension": OutlineExtension,
	"outline:game": OutlineGame,
	"outline:gametool": OutlineGametool,
	"outline:general": OutlineGeneral,
	"outline:image": OutlineImage,
	"outline:life": OutlineLife,
	"outline:manage": OutlineManage,
	"outline:media": OutlineMedia,
	"outline:meme": OutlineMeme,
	"outline:other": OutlineOther,
	"outline:preset": OutlinePreset,
	"outline:tool": OutlineTool,
	"outline:webui": OutlineWebUI,
};

const solid: Record<string, Component> = {
	"solid:adapter": SolidAdapter,
	"solid:ai": SolidAi,
	"solid:all": SolidAll,
	"solid:core": SolidCore,
	"solid:extension": SolidExtension,
	"solid:game": SolidGame,
	"solid:gametool": SolidGametool,
	"solid:general": SolidGeneral,
	"solid:image": SolidImage,
	"solid:life": SolidLife,
	"solid:manage": SolidManage,
	"solid:media": SolidMedia,
	"solid:meme": SolidMeme,
	"solid:other": SolidOther,
	"solid:preset": SolidPreset,
	"solid:tool": SolidTool,
	"solid:webui": SolidWebUI,
};

const registry: Record<string, Component> = {
	...misc,
	...outline,
	...solid,
};

export default defineComponent({
	props: {
		name: String,
	},
	render(props: { name?: string }) {
		const icon = props.name
			? registry[props.name]
			: undefined;
		return icon
			? h(icon, {
					class: "market-icon",
				})
			: [];
	},
});
