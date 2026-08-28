/**
 * Installer 的本地上传 mixin：把本地插件包分块上传与会话管理方法
 * （start/append/finish/commit/cancel + 本地绑定）内聚在这里，
 * 全部转发给 core 的 LocalPackageUploadService。
 *
 * 宿主面：uploadService 由 installer/index.ts 的 Installer 类在构造器
 * 中从 createInstallerCore 的产物赋值（见 wire.ts）。
 *
 * 架构位置：node 适配层 installer 模块；Installer 类的 mixin 之一。
 */
import type { LocalPackageUploadService } from "../../core/install/sources/upload.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadPreview,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "../../core/upload/types.js";

/** mixin 基类约束：任意构造函数（Service 天然满足）。 */
// biome-ignore lint/suspicious/noExplicitAny: TS mixin 要求基类构造器参数为 any[]
type GConstructor = abstract new (...args: any[]) => object;

export function UploadsMixin<T extends GConstructor>(Base: T) {
    abstract class UploadsImpl extends Base {
        /** @internal 本地上传会话门面（由 Installer 构造器注入）。 */
        public declare uploadService: LocalPackageUploadService;

        startLocalPackageUpload(
            request: LocalPackageUploadStartRequest,
        ): Promise<LocalPackageUploadStartResult> {
            return this.uploadService.startLocalPackageUpload(request);
        }

        appendLocalPackageUpload(
            request: LocalPackageUploadChunkRequest,
        ): Promise<LocalPackageUploadProgress> {
            return this.uploadService.appendLocalPackageUpload(request);
        }

        finishLocalPackageUpload(
            request: LocalPackageUploadFinishRequest,
        ): Promise<LocalPackageUploadPreview> {
            return this.uploadService.finishLocalPackageUpload(request);
        }

        commitLocalPackageUpload(uploadId: string): Promise<LocalPackageUploadCommitResult> {
            return this.uploadService.commitLocalPackageUpload(uploadId);
        }

        cancelLocalPackageUpload(uploadId: string) {
            return this.uploadService.cancelLocalPackageUpload(uploadId);
        }

        prepareLocalBinding(name: string) {
            return this.uploadService.prepareLocalBinding(name);
        }
    }
    return UploadsImpl;
}
