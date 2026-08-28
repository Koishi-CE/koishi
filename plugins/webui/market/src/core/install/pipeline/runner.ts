/**
 * @file 包管理器子进程运行器(core/install/pipeline 域)。
 *
 * 职责:以 execa 拉起 npm/yarn 子进程执行安装,逐行转发 stdout/stderr 到
 * 安装日志(InstallLogStore)与宿主日志;yarn berry(>=2)追加 --json 参数并
 * 把 JSON 行解析降级为 logger 级别。进程退出码原样返回(0 成功),
 * 启动失败或被信号杀死时返回 -1,由上层决定回滚。
 *
 * 关键设计:
 * - npm 统一改写为 `npm install <args>`,yarn 保持原参数形态;
 * - 按行切流(stderr 逐行 warn;stdout 走 JSON/明文双模式),
 *   进程结束时 flush 残留的不完整行,保证日志不丢尾行;
 * - settled 单次结算标记,防止 exit 与 error 双路径重复 resolve。
 *
 * 架构位置:被 install-executor.ts 的 installWithRegistry 调用,
 * 是安装流水线里唯一真正拉起子进程的地方。
 */
import { execa } from "execa";
import type { InstallLogger } from "../types.js";
import { type YarnLog, yarnLogLevel } from "./exec-parse.js";

/** 宿主检测到的包管理器标识(name + version,version 缺省按旧版本处理)。 */
export interface PackageManagerAgent {
    name: string;
    version?: string | undefined;
}

/** 运行包管理器所需依赖面(cwd、agent、双通道日志输出)。 */
export interface RunPackageManagerDeps {
    /** 宿主工作目录(子进程 cwd) */
    cwd: string;
    /** 包管理器标识(undefined 时回退 npm) */
    agent: PackageManagerAgent | undefined;
    /** 宿主日志 */
    log: InstallLogger;
    /** 安装会话日志输出通道(前端实时可见) */
    emitLog: (type: "stdout" | "stderr", line: string) => void;
}

/** 运行包管理器并逐行转发 stdout/stderr（yarn berry 走 --json 解析）。 */
export async function runPackageManager(
    args: string[],
    deps: RunPackageManagerDeps,
): Promise<number> {
    const { log, emitLog } = deps;
    const agent = deps.agent;
    const name = agent?.name ?? "npm";
    // 只有 yarn berry(v2+)支持 --json 流式输出;yarn 1.x 与 npm 走明文
    const useJson = name === "yarn" && (agent?.version ?? "") >= "2";
    // npm 的语义是 `npm install` 后接参数;yarn install 不带子命令
    if (name !== "yarn") args.unshift("install");
    const start = Date.now();
    const agentLabel = agent ? `${name}@${agent.version ?? ""}` : name;
    log.info(
        `run package manager: agent=${agentLabel}, args=${args.join(" ") || "(none)"}, cwd=${deps.cwd}, json=${useJson}`,
    );
    if (useJson) args.push("--json");

    let stderr = "";
    let stdout = "";
    let settled = false;

    // reject: false —— 非零退出码不是异常,由返回值交给上层判定回滚
    return new Promise<number>((resolve) => {
        const subprocess = execa(name, args, { cwd: deps.cwd, reject: false });
        emitLog("stdout", `package manager started: agent=${agentLabel}`);

        const emitStdoutLine = (line: string) => {
            if (!line) return;
            if (!useJson || line[0] !== "{") {
                log.info(line);
                emitLog("stdout", line);
                return;
            }
            // JSON 模式:按 yarn 的 type 字段映射日志级别后输出 data 部分
            try {
                const parsed = JSON.parse(line) as YarnLog;
                const level = yarnLogLevel(parsed.type);
                if (level === "debug") log.debug(parsed.data);
                else if (level === "warn") log.warn(parsed.data);
                else log.info(parsed.data);
                emitLog("stdout", parsed.data);
            } catch (error) {
                // 形如 JSON 但解析失败:按原样告警,避免整行丢失
                log.warn(line);
                log.warn(error);
                emitLog("stderr", line);
            }
        };

        /** 结算前冲刷缓冲区里最后一个未带换行的残行。 */
        const flushBuffers = () => {
            if (stderr) {
                log.warn(stderr);
                emitLog("stderr", stderr);
                stderr = "";
            }
            if (stdout) {
                emitStdoutLine(stdout);
                stdout = "";
            }
        };

        const settle = (code: number) => {
            if (settled) return;
            settled = true;
            flushBuffers();
            resolve(code);
        };

        subprocess.stderr.on("data", (data) => {
            // 累积到换行才输出:避免一个中文/长行被 chunk 切开刷成多段
            stderr += data.toString();
            const lines = stderr.split("\n");
            stderr = lines.pop()!;
            for (const line of lines) {
                log.warn(line);
                emitLog("stderr", line);
            }
        });

        subprocess.stdout.on("data", (data) => {
            stdout += data.toString();
            const lines = stdout.split("\n");
            stdout = lines.pop()!;
            for (const line of lines) emitStdoutLine(line);
        });

        subprocess.then(
            (result) => {
                const code = result.exitCode;
                const signal = result.signal;
                log.info(
                    `package manager exited: code=${code}, signal=${signal ?? "-"}, elapsed=${Date.now() - start}ms`,
                );
                if (code == null) {
                    // 无退出码 = 被信号杀死等异常终止,统一折算为 -1
                    const message = signal
                        ? `package manager terminated by signal ${signal}`
                        : "package manager exited without an exit code";
                    emitLog("stderr", message);
                    settle(-1);
                    return;
                }
                emitLog(
                    code ? "stderr" : "stdout",
                    code
                        ? `package manager exited with code ${code}`
                        : "package manager finished successfully",
                );
                settle(code);
            },
            (error) => {
                log.warn(
                    `package manager failed to start: ${error instanceof Error ? error.message : String(error)}`,
                );
                emitLog(
                    "stderr",
                    `package manager failed to start: ${error instanceof Error ? error.message : String(error)}`,
                );
                settle(-1);
            },
        );
    });
}
