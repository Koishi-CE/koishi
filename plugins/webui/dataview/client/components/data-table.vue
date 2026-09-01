<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (c) 2019-present Shigma and Koishijs contributors. -->
<!-- Copyright (c) 2026-present Koishi-CE contributors. -->

<template>
  <div class="content-right" v-loading="state.loading">
    <div class="header">
      <span class="table-title">
        {{ name }} {{
          table.size
            ? `(${formatSize(table.size)})`
            : ''
        }}
      </span>
      <div class="operations">
        <span v-if="existChanges">
          <el-button type="primary" :disabled="!existValidChanges" @click="onSubmitChanges">应用修改</el-button>
          <el-button type="danger" @click="onCancelChanges">取消修改</el-button>
        </span>
        <span v-else>双击单元格修改数据</span>
      </div>
    </div>
    <el-table
      :data="tableData"
      class="data-table"
      style="width: 100%"
      height="100%"
      :border="true"
      :cell-class-name="({ row, column, rowIndex, columnIndex }) => isCellChanged({ row, column, $index: rowIndex }, false)
        ? 'cell-changed'
        : ''
      "
      :cell-style="getCellStyle"
      @sort-change="onSort"
      @cell-dblclick="onOuterCellClick"
    >
      <el-table-column
        v-for="fName in Object.keys(table.fields)"
        :key="fName"
        :sortable="existChanges ? false : 'custom'"
        :prop="fName"
        :label="fName"
        :fixed="table.primary.includes(fName)"
        :resizable="true"
      >
        <template #header="{ column }">
          {{ column.label }}
          <div class="insertion" @click.stop>
            <component
              :is="columnInputAttr[column.label].is"
              @click.stop
              v-model="state.newRow[column.label]"
              v-bind="columnInputAttr[column.label].attrs || {}"
              size="small"
            ></component>
          </div>
        </template>
        <template #default="scope">
          <template v-if="isCellChanged(scope, false)">
            <component
              :is="columnInputAttr[scope.column.label].is"
              ref="changedCells"
              v-model="state.changes[scope.$index][scope.column.label].model"
              v-bind="columnInputAttr[scope.column.label].attrs || {}"
              size="small"
            >
              <template #suffix>
                <k-button frameless type="danger" @click="onCancelInput(scope)">
                  <k-icon name="times-full"></k-icon>
                </k-button>
              </template>
            </component>
          </template>
          <div v-else-if="['string', 'text', 'json', 'list'].includes(table.fields[fName]?.deftype)" @parent-dblclick="onCellDblClick(scope)" class="inner-cell">
            <el-tooltip :show-after="300" popper-class="tooltip-popper">
              <template #content>{{ renderCell(fName, scope) }}</template>
            {{
              renderCell(fName, scope)
            }}
            </el-tooltip>
          </div>
          <div v-else @parent-dblclick="onCellDblClick(scope)" class="inner-cell">
            {{
              renderCell(fName, scope)
            }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="60" fixed="right" align="center">
        <template #header="{ column }">
          {{ column.label }}
          <div class="insertion" @click.stop>
            <k-button frameless :disabled="!newRowValid || existChanges" @click="onInsertRow">插入</k-button>
          </div>
        </template>

        <template #default="scope">
          <el-popconfirm
            @confirm="onDeleteRow(scope)"
            title="真的要删除这条数据吗？"
            confirm-button-text="是"
            cancel-button-text="否"
          >
            <template #reference>
              <k-button frameless type="danger" :disabled="existChanges">
                <k-icon name="times-full"></k-icon>
              </k-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      layout="total, sizes, prev, pager, next, jumper"
      :small="true"
      :total="table.count"
      :page-sizes="pageSizes"
      :default-page-size="pageSizes[0]"
      v-model:page-size="state.pageSize"
      :default-current-page="1"
      v-model:current-page="currPage"
      :disabled="existChanges"
    ></el-pagination>
  </div>
</template>

<script lang="ts" setup>
/*
 * 数据表视图：分页展示单张表的数据行，支持按列排序、按新行输入过滤、
 * 双击单元格就地编辑（应用前经校验）、插入与删除行；列头带新行输入框，
 * 编辑态单元格由动态组件（el-input / el-date-picker / el-time-picker）
 * 承载，字段类型经类型染色配置着色。
 */

import { type Dict, message, pick, store, useConfig } from "@koishi-ce/client";
import {
	type ComputedRef,
	computed,
	nextTick,
	reactive,
	ref,
	watch,
	watchEffect,
} from "vue";
import { schema } from "../index.ts";
import {
	dateStr,
	formatSize,
	handleError,
	sendQuery,
	timeStr,
} from "../utils.ts";

/** 单元格输入模型（el-input 的字符串/数字输入，或日期选择器的 Date） */
type CellModel = string | number | Date;

export interface TableStatus {
	loading: boolean;
	pageSize: number;
	offset: number;
	sort: SortState | null;
	changes: ChangesState;
	newRow: Record<string, CellModel>;
}

export type SortState = {
	field: string;
	order: "ascending" | "descending";
};

/** 行号 => 字段名 => 输入模型（暂存未提交的修改） */
export type ChangesState = Record<number, Record<string, { model: CellModel }>>;

const state = reactive<TableStatus>({
	loading: true,
	pageSize: 30,
	offset: 0,
	sort: null,
	changes: {},
	newRow: {},
});

const pageSizes = [30, 50, 100, 150, 200, 500, 1000];

const props = defineProps<{
	name: string;
	filter: boolean;
	color: boolean;
}>();

const table = computed(() => store.database?.tables[props.name]);

watchEffect(() => {
	state.pageSize = state.pageSize || (pageSizes[0] ?? 30);
});
watch(
	() => state.pageSize,
	(v) => {
		state.offset = Math.floor(state.offset / v) * v;
	},
);
watch(
	() => table.value?.fields,
	(v) => {
		for (const fName in v) {
			if (!(fName in state.newRow)) state.newRow[fName] = "";
		}
	},
	{ immediate: true },
);

// 单元格进入编辑态时，聚焦最后渲染出的输入框
const changedCells = ref<Array<{ focus: () => void }>>([]);
watch(
	() => changedCells.value.length,
	(v) => {
		if (v) changedCells.value[v - 1]?.focus();
	},
);

// 作为异步 computed 使用的数据行（分页 + 排序 + 可选过滤）
const tableData = ref<Record<string, unknown>[]>([]);

async function updateData() {
	if (!props.name) return;
	state.loading = true;
	const querySort = state.sort && {
		[state.sort.field]: {
			ascending: "asc" as const,
			descending: "desc" as const,
		}[state.sort.order],
	};
	const modifier = {
		offset: state.offset,
		limit: state.pageSize,
		sort: querySort,
	};
	try {
		const row = props.filter
			? Object.keys(state.newRow).reduce<Record<string, unknown>>(
					(o, field) => {
						if (state.newRow[field]) {
							o[field] = fromModelValue(field, state.newRow[field]);
						}
						return o;
					},
					{},
				)
			: {};
		tableData.value = await sendQuery(
			"get",
			props.name as never,
			row,
			modifier,
		);
	} catch {
		// 忽略非法查询（如过滤条件不合法）
	}
	await nextTick();
	state.loading = false;
}
watchEffect(updateData);

const rawConfig = useConfig();
const config = computed(() => schema(rawConfig.value));

function getCellStyle({
	column,
}: {
	column: { label: string; cellStyle?: Record<string, string> };
}) {
	if (!props.color) return (column.cellStyle = undefined);
	if (column.cellStyle) return column.cellStyle;
	for (const pref of config.value.dataview?.colors ?? []) {
		if (!pref?.types) continue;
		if (
			pref.types.includes(table.value?.fields?.[column.label]?.deftype as never)
		) {
			return (column.cellStyle = { "background-color": pref.color ?? "" });
		}
	}
	return (column.cellStyle = {});
}

defineExpose({
	sendQuery,
	updateData,
});

const currPage = computed({
	get: () => Math.floor(state.offset / state.pageSize) + 1,
	set: (p) => (state.offset = (p - 1) * state.pageSize),
});

/** 每个字段对应的输入组件与属性（列头新行输入、单元格编辑共用） */
interface ColumnInput {
	is: "el-input" | "el-date-picker" | "el-time-picker";
	attrs?: {
		type?: string;
		validate?: (val: CellModel) => boolean;
		step?: number;
		clearable?: boolean;
	};
}

const columnInputAttr: ComputedRef<Dict<ColumnInput>> = computed(() =>
	Object.keys(table.value?.fields ?? {}).reduce<Dict<ColumnInput>>(
		(o, fName) => {
			const fieldConfig = table.value?.fields[fName];
			if (!fieldConfig) return o;
			const dateAttrs = { clearable: false };

			let type = "text";
			let step: number | undefined;
			switch (fieldConfig.deftype) {
				case "time":
					o[fName] = { is: "el-time-picker", attrs: dateAttrs };
					return o;
				case "date":
					o[fName] = {
						is: "el-date-picker",
						attrs: { ...dateAttrs, type: "date" },
					};
					return o;
				case "timestamp":
					o[fName] = {
						is: "el-date-picker",
						attrs: { ...dateAttrs, type: "datetime" },
					};
					return o;

				case "integer":
				case "unsigned":
					step = 1;
					type = "number";
					break;

				case "float":
				case "double":
				case "decimal":
					type = "number";
					break;

				default:
					type = "text";
					break;
			}

			const validate = (val: CellModel) => {
				const text = String(val ?? "");
				if (fieldConfig.nullable === false && !text.length) return false;
				let value: number | string = text;
				// 上游此处误写为 type.value（恒假）；按其意图对数字输入先转数值再校验
				if (type === "number") value = Number.parseFloat(text);
				switch (fieldConfig.deftype) {
					// biome-ignore lint/suspicious/noFallthroughSwitchClause: 负数已提前返回,落入整数检查是上游既定语义
					case "unsigned":
						if (typeof value === "number" && value < 0) return false;
					case "integer":
						if (typeof value === "number" && value % 1 !== 0) return false;
						break;
					case "json":
						if (text === "") return true;
						if (!text.startsWith("{") || !text.endsWith("}")) return false;
						break;
				}
				return true;
			};

			o[fName] = { is: "el-input", attrs: { type, validate, step } };
			return o;
		},
		{},
	),
);

/** 仅保留通过输入校验的修改 */
const validChanges: ComputedRef<ChangesState> = computed(() => {
	const result: ChangesState = {};
	for (const i in state.changes) {
		for (const field in state.changes[i]) {
			const column = columnInputAttr.value[field];
			if (column?.attrs?.validate) {
				if (!column.attrs.validate(state.changes[i][field]?.model ?? "")) {
					continue; // 跳过非法修改
				}
			}
			(result[i] ??= {})[field] = state.changes[i][field];
		}
	}
	return result;
});

const existChanges = computed(() => !!Object.keys(state.changes).length);
const existValidChanges = computed(
	() => !!Object.keys(validChanges.value).length,
);
const newRowValid = computed(() => {
	for (const field in table.value?.fields) {
		const column = columnInputAttr.value[field];
		if (column?.attrs?.validate) {
			if (!column.attrs.validate(state.newRow[field] ?? "")) return false;
		}
	}
	return true;
});

function onSort(e: { prop: string; order: "ascending" | "descending" | null }) {
	if (e.order === null) {
		state.sort = null;
	} else {
		state.sort = {
			field: e.prop,
			order: e.order,
		};
	}
}

function renderCell(field: string, scope: { row: Record<string, unknown> }) {
	const fType = table.value?.fields[field]?.deftype;
	const data = scope.row[field];
	switch (fType) {
		case "json":
			return JSON.stringify(data);
		case "date":
			if (data instanceof Date) return dateStr(data);
			break;
		case "time":
			if (data instanceof Date) return timeStr(data);
			break;
		case "timestamp":
			if (data instanceof Date) return `${dateStr(data)} ${timeStr(data)}`;
			break;
		case "binary":
			return `<Binary len=${data}>`;
	}
	return data;
}

/** 把单元格数据转换为输入模型 */
function toModelValue(field: string, data: unknown): CellModel {
	const fType = table.value?.fields[field]?.deftype;
	if (fType === "list" || fType === "json") return JSON.stringify(data);
	if (fType === "time" && typeof data === "string") {
		const [h, m, s] = data.split(":");
		const time = new Date();
		time.setHours(
			Number.parseInt(h ?? "0", 10),
			Number.parseInt(m ?? "0", 10),
			Number.parseInt(s ?? "0", 10),
		);
		return time;
	}
	return data as CellModel;
}

/** 把输入模型转换回单元格数据 */
function fromModelValue(field: string, data: CellModel): unknown {
	const fType = table.value?.fields[field]?.deftype;
	switch (fType) {
		case "unsigned":
		case "integer":
		case "float":
		case "double":
			return +data;
		case "boolean":
		case "list":
		case "json":
			return JSON.parse(String(data));
	}
	return data;
}

/** 判断某单元格是否有待提交的修改 */
function isCellChanged(
	scope: {
		row: Record<string, unknown>;
		column: { label: string };
		$index: number;
	},
	checkValue = true,
) {
	const { row, column, $index } = scope;
	if (state.changes[$index]?.[column.label] === undefined) return false;
	if (!checkValue) return true;
	// 上游此分支以 row.id（而非 $index）比对 model.value；现有调用均传
	// checkValue=false，该分支不会执行，这里按输入模型与原值近似比较
	return state.changes[$index]?.[column.label]?.model === row[column.label];
}

/* 外层单元格双击时把事件转发给内部 .inner-cell（借此拿到 $index） */
function onOuterCellClick(
	_row: unknown,
	_column: unknown,
	element: HTMLElement,
) {
	element
		.querySelector(".inner-cell")
		?.dispatchEvent(new Event("parent-dblclick"));
}

function onCellDblClick(scope: {
	row: Record<string, unknown>;
	column: { label: string };
	$index: number;
}) {
	const { row, column, $index } = scope;
	if (isCellChanged(scope, false)) return; // 已有修改记录
	if (table.value?.fields[column.label]?.deftype === "binary") return;
	const record = (state.changes[$index] ??= {});
	record[column.label] = reactive({
		model: toModelValue(column.label, row[column.label]),
	});
}

/** 撤销当前单元格的修改 */
function onCancelInput(scope: { column: { label: string }; $index: number }) {
	const { column, $index } = scope;
	const record = state.changes[$index];
	if (!record) return;
	delete record[column.label];
	if (!Object.keys(record).length) delete state.changes[$index];
}

/** 撤销全部修改 */
function onCancelChanges() {
	state.changes = {};
}

async function onSubmitChanges() {
	state.loading = true;
	const submitted: {
		idx: string;
		field: string;
	}[] = [];
	for (const idx in validChanges.value) {
		try {
			const row = tableData.value[idx];
			const data: Dict<unknown> = {};
			for (const field in validChanges.value[idx]) {
				data[field] = fromModelValue(
					field,
					validChanges.value[idx][field]?.model ?? "",
				);
			}
			await sendQuery(
				"set",
				props.name as never,
				pick(row ?? {}, table.value?.primary ?? []) as never,
				data as never,
			);

			for (const field in validChanges.value[idx]) {
				submitted.push({ idx, field });
			}
		} catch (e) {
			handleError(e, "更新数据失败");
		}
	}

	// 清除已提交的修改
	for (const c of submitted) {
		delete state.changes[c.idx]?.[c.field];
	}
	for (const idx in state.changes) {
		if (!Object.keys(state.changes[idx] ?? {}).length)
			delete state.changes[idx];
	}
	await updateData();
	if (submitted.length) message.success(`成功修改 ${submitted.length} 项数据`);
	state.loading = false;
}

async function onDeleteRow(scope: {
	row: Record<string, unknown>;
	$index: number;
}) {
	state.loading = true;
	try {
		await sendQuery(
			"remove",
			props.name as never,
			pick(scope.row, table.value?.primary ?? []) as never,
		);
		await updateData();
		message.success("成功删除数据");
	} catch (e) {
		handleError(e, "数据删除失败");
	}
	state.loading = false;
}

async function onInsertRow() {
	state.loading = true;
	try {
		const row = Object.keys(state.newRow).reduce<Dict<unknown>>((o, field) => {
			if (state.newRow[field]) {
				o[field] = fromModelValue(field, state.newRow[field]);
			}
			return o;
		}, {});
		await sendQuery("create", props.name as never, row as never);
		await updateData();
		message.success("成功添加数据");
		for (const field in state.newRow) {
			state.newRow[field] = "";
		}
	} catch (e) {
		handleError(e, "添加数据失败");
	}
	state.loading = false;
}
</script>

<style lang="scss" scoped>

.content-right {
  display: flex;
  gap: 1em;
  align-items: center;
  flex-direction: column;
  padding: 2rem;
  max-width: 100%;
  max-height: 100%;
  height: 100%;
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  .table-title {
    font-weight: bold;
    font-size: 1.6em;
  }
}
.operations {
  .el-button:last-child {
    margin-right: 0;
  }
}
.insertion {
  float: left;
  width: 100%;
  margin-top: 0.5em;
}
</style>

<style lang="scss">
.data-table {
  .el-date-editor.el-input,
  .el-date-editor.el-input__inner {
    width: 100%;
  }
  .el-table__cell {
    padding: 4px 0;
  }
  .cell {
    word-break: keep-all;
    white-space: nowrap;
    line-height: 1.2;
  }
  .cell-changed {
    &.el-table__cell {
      padding: 0 2px;
    }

    .cell,
    .cell:first-child {
      padding: 0;
    }
  }

  .hover-row td {
    filter: brightness(0.95);
  }

  .el-input {
    .k-icon {
      display: block;
    }
  }
}

.tooltip-popper {
  max-width: 90%;
}
</style>
