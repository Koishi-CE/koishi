/**
 * 虚拟列表的核心计算模型（移植自 vue-virtual-scroll-list 的 virtual.js）：
 * 只维护「当前应渲染 [start, end) 哪一段」以及前后两段撑开滚动条的
 * padding 尺寸，不接触 DOM。list.vue 负责滚动事件与渲染，item.ts 负责
 * 上报每项实际尺寸，本类据此在「定长 / 动态长度」两种模式下推算范围。
 */
import { reactive } from "vue";

// erasableSyntaxOnly:enum → const 对象 + 同名类型
const CALC_TYPE = {
	INIT: 0,
	FIXED: 1,
	DYNAMIC: 2,
} as const;

type CalcType = (typeof CALC_TYPE)[keyof typeof CALC_TYPE];

// 数据变化时沿当前滚动方向额外预渲染的条数
const LEADING_BUFFER = 2;

/** 当前渲染范围：起止下标 + 前后两段的占位 padding（单位 px） */
export interface Range {
	start: number;
	end: number;
	padFront: number;
	padBehind: number;
}

/** 虚拟化参数：可视条数、预估项高、上下预渲染缓冲、全量 uid 列表 */
interface VirtualConfig {
	count: number;
	estimated: number;
	buffer: number;
	uids: string[];
}

export default class Virtual {
	/** 各项实测尺寸，按 uid 记录；header / footer 为两个保留插槽位 */
	sizes = new Map<string, number>([
		["header", 0],
		["footer", 0],
	]);

	// delete 操作要求属性可选(fixedSizeValue/firstRangeTotalSize 会被 delete)
	firstRangeTotalSize?: number = 0;
	firstRangeAverageSize = 0;
	lastCalcIndex = 0;
	fixedSizeValue?: number = 0;
	calcType: CalcType = CALC_TYPE.INIT;
	offset = 0;
	direction: 0 | 1 | -1 = 0;
	// 构造函数末尾 checkRange → updateRange 会立即写入全部字段,
	// 这里给出零值仅为满足必填类型,不改变任何可观察行为
	range = reactive<Range>({
		start: 0,
		end: 0,
		padFront: 0,
		padBehind: 0,
	});

	param: VirtualConfig;

	constructor(param: VirtualConfig) {
		this.param = param;
		this.checkRange(0, param.count);
	}

	/** 数据源变化后同步 uid 列表，并清掉已消失项的尺寸记录（保留 header/footer） */
	updateUids(uids: string[]) {
		this.param.uids = uids;
		this.sizes.forEach((_v, key) => {
			if (!uids.includes(key) && key !== "header" && key !== "footer")
				this.sizes.delete(key);
		});
	}

	/**
	 * 记录一项的实测尺寸（item.ts 的 ResizeObserver 上报入口）。
	 * 尺寸推断策略：初始假设列表为定长（FIXED）并记住首个尺寸；一旦出现
	 * 不同尺寸即升级为动态长度（DYNAMIC）并丢弃 fixedSizeValue；动态
	 * 模式下仅在首个渲染范围内累计 firstRangeTotalSize 求平均项高，
	 * 覆盖满一个范围后停止统计。
	 */
	saveSize = (id: string, size: number) => {
		this.sizes.set(id, size);

		// 起始阶段假定列表为定长并记住第一个尺寸值；后续若一直与它相同
		// 就按定长列表处理，一旦出现不同尺寸则转为动态长度列表
		if (this.calcType === CALC_TYPE.INIT) {
			this.fixedSizeValue = size;
			this.calcType = CALC_TYPE.FIXED;
		} else if (
			this.calcType === CALC_TYPE.FIXED &&
			this.fixedSizeValue !== size
		) {
			this.calcType = CALC_TYPE.DYNAMIC;
			// 动态模式下该值再无用处
			delete this.fixedSizeValue;
		}

		// 仅在首个渲染范围内统计平均尺寸
		if (
			this.calcType !== CALC_TYPE.FIXED &&
			typeof this.firstRangeTotalSize !== "undefined"
		) {
			if (
				this.sizes.size < Math.min(this.param.count, this.param.uids.length)
			) {
				this.firstRangeTotalSize = [...this.sizes.values()].reduce(
					(acc, val) => acc + val,
					0,
				);
				this.firstRangeAverageSize = Math.round(
					this.firstRangeTotalSize / this.sizes.size,
				);
			} else {
				// 统计完成，此后不再维护
				delete this.firstRangeTotalSize;
			}
		}
	};

	/**
	 * 数据变化（如列表长度改变）时立即重算范围：
	 * 沿当前滚动方向额外前移 / 后移 LEADING_BUFFER 条预渲染，
	 * 保证新数据进入视口时已经渲染。
	 */
	handleDataChange() {
		let start = this.range.start;

		if (this.direction < 0) {
			start = start - LEADING_BUFFER;
		} else if (this.direction > 0) {
			start = start + LEADING_BUFFER;
		}

		start = Math.max(start, 0);

		this.updateRange(this.range.start, this.getEndByStart(start));
	}

	/** 插槽（header / footer）尺寸变化同样触发强制重算 */
	handleSlotSizeChange() {
		this.handleDataChange();
	}

	/**
	 * 滚动事件处理：根据本次 offset 与上一次的差值判定方向，
	 * 向上滚动交给 handleFront，向下交给 handleBehind。
	 */
	handleScroll(offset: number) {
		// Math.sign 对有限数返回 -1/0/1，按三态映射回 direction（NaN 亦归 0）
		const sign = Math.sign(offset - this.offset);
		this.direction = sign > 0 ? 1 : sign < 0 ? -1 : 0;
		this.offset = offset;

		if (this.direction < 0) {
			this.handleFront();
		} else if (this.direction > 0) {
			this.handleBehind();
		}
	}

	/** 向上滚动：可视下标未越过当前 start 时不动作，否则整体上移一个 buffer */
	handleFront() {
		const overs = this.getScrollOvers();
		// start 尚未超过可视下标时无需变更范围
		if (overs > this.range.start) {
			return;
		}

		// start 上移一个 buffer 长度，并兜底到 0
		const start = Math.max(overs - this.param.buffer, 0);
		this.checkRange(start, this.getEndByStart(start));
	}

	/** 向下滚动：可视下标仍在 start + buffer 之内不动作，否则以 overs 为新起点 */
	handleBehind() {
		const overs = this.getScrollOvers();
		// 可视下标仍在预渲染缓冲区内时无需变更范围
		if (overs < this.range.start + this.param.buffer) {
			return;
		}

		this.checkRange(overs, this.getEndByStart(overs));
	}

	/**
	 * 由当前滚动偏移反算「已经滚过了多少项」（即可视区第一项的下标）。
	 * 定长模式直接整除；动态模式用二分查找定位 offset 落在哪一项的区间。
	 */
	private getScrollOvers() {
		const offset = this.offset - (this.sizes.get("header") ?? 0);
		if (offset <= 0) return 0;

		// 定长模式可以直接整除得出（定长态 getEstimateSize 即实测固定值）
		if (this.isFixedType()) {
			return Math.floor(offset / this.getEstimateSize());
		}

		let low = 0;
		let middle = 0;
		let middleOffset = 0;
		let high = this.param.uids.length;

		while (low <= high) {
			middle = Math.floor((high + low) / 2);
			middleOffset = this.getOffset(middle);

			if (middleOffset === offset) {
				return middle;
			} else if (middleOffset < offset) {
				low = middle + 1;
			} else if (middleOffset > offset) {
				high = middle - 1;
			}
		}

		return low > 0 ? --low : 0;
	}

	/** 某个 uid 项顶部相对列表起点的偏移（用于滚动定位到指定项） */
	getUidOffset(uid: string) {
		return this.getOffset(this.param.uids.indexOf(uid));
	}

	/**
	 * 计算第 givenIndex 项顶部的累计偏移：逐项累加实测尺寸，未测过的
	 * 项用估算尺寸兜底。调用频率虽高，但只是数字累加，性能可接受。
	 */
	getOffset(givenIndex: number) {
		if (!givenIndex) {
			return 0;
		}

		let offset = 0;
		for (let index = 0; index < givenIndex; index++) {
			// 下标恒在 uids 界内；越界（不可能发生）按未测量兜底到估算值
			const uid = this.param.uids[index] ?? "";
			offset = offset + (this.sizes.get(uid) ?? this.getEstimateSize());
		}

		// 记录已精确计算到的最大下标（getPadBehind 据此判断能否精确取值）
		this.lastCalcIndex = Math.max(this.lastCalcIndex, givenIndex);
		this.lastCalcIndex = Math.min(this.lastCalcIndex, this.getLastIndex());

		return offset;
	}

	/** 当前是否为定长模式 */
	isFixedType() {
		return this.calcType === CALC_TYPE.FIXED;
	}

	/** 最后一项的下标（即 uid 总数） */
	getLastIndex() {
		return this.param.uids.length;
	}

	/**
	 * 校正范围并按需切换到新范围：数据总量不足可视条数时全量渲染；
	 * 范围长度不足时以 end 为基准回推 start。
	 */
	checkRange(start: number, end: number) {
		const keeps = this.param.count;
		const total = this.param.uids.length;

		// 数据量不超过可视条数时全部渲染
		if (total <= keeps) {
			start = 0;
			end = total;
		} else if (end - start < keeps - 1) {
			// 范围长度不足可视条数时，以 end 为基准向前补齐
			start = end - keeps;
		}

		if (this.range.start !== start) {
			this.updateRange(start, end);
		}
	}

	/** 切换到新范围并同步重算前后占位 padding（range 为响应式，触发重渲染） */
	updateRange(start: number, end: number) {
		this.range.start = start;
		this.range.end = end;
		this.range.padFront = this.getPadFront();
		this.range.padBehind = this.getPadBehind();
	}

	/** 由 start 推算对应范围的 end（不超过数据总量） */
	getEndByStart(start: number) {
		return Math.min(start + this.param.count, this.param.uids.length);
	}

	/** 渲染范围之前的总占位高度 */
	getPadFront() {
		if (this.isFixedType()) {
			// 定长态 getEstimateSize 即实测固定值
			return this.getEstimateSize() * this.range.start;
		} else {
			return this.getOffset(this.range.start);
		}
	}

	/** 渲染范围之后的总占位高度 */
	getPadBehind() {
		const end = this.range.end;
		const lastIndex = this.getLastIndex();

		if (this.isFixedType()) {
			// 定长态 getEstimateSize 即实测固定值
			return (lastIndex - end) * this.getEstimateSize();
		}

		// 已全部精确计算过时返回精确值
		if (this.lastCalcIndex === lastIndex) {
			return this.getOffset(lastIndex) - this.getOffset(end);
		} else {
			// 否则用估算尺寸兜底
			return (lastIndex - end) * this.getEstimateSize();
		}
	}

	/** 取当前估算的项高：定长取实测值，动态取首范围平均值，再退到初始预估 */
	getEstimateSize() {
		// FIXED 态下 fixedSizeValue 必然已写入（delete 仅发生在转入 DYNAMIC 时）
		if (this.isFixedType() && this.fixedSizeValue !== undefined) {
			return this.fixedSizeValue;
		}
		return this.firstRangeAverageSize || this.param.estimated;
	}
}
