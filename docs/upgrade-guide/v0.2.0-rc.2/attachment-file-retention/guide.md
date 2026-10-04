---
kind: upgrade-guide
description: "Update attachment providers and Session export consumers for durable generic-file retention and protected reads."
---

# Generic-file attachment retention

English | [中文](guide.zh.md)

## Change

The attachment service adds explicit generic-file staging, owner retention, protected reads and conservative deletion. JSONL Session publication now requires `commitFileReferences` to complete before a batch containing files becomes durable. A missing attachment provider or failed retention commit refuses that batch. Forks retain inherited files under their own Session ids; closing a handle does not release the persisted owner's files.

Session log export requires `acquireFileReadLease` before streaming each log that names generic files. Completion, failure and cancellation release the acquired protections; teardown reports release failures. Its Host plugin now requires the attachment service, so an absent provider leaves the download route unregistered (404) instead of returning 500. Provider replacement recreates the export owner. Custom attachment providers must implement the new methods even when their retention policy always keeps files. Image retention is unchanged.

The local provider now requires the storage domain facility for staged uploads, owner updates, and deletion. One live provider holds the canonical root exclusively; competing providers fail with `ATTACHMENT_STORE_OWNED`. Legacy saves and historical files keep unknown ownership. Explicit deletion reports canonical bytes removed, not physical free space.

## Migration

1. Update custom `AttachmentStore` implementations with the staging, owner, read-lease and deletion methods declared in `@deepseek-ai/dsh-attachment`. Keep files with unknown ownership rather than treating an absent inventory as zero references.
2. Mount the attachment provider with JSONL persistence whenever Session events contain generic-file references. Commit owners durably before publishing their references and release owners only after those references are durably inaccessible. Preserve separate ownership for forks.
3. Mount the attachment provider with the export plugin. Update custom export consumers to acquire `FileReadLease` before publishing logs that name the files and to release every lease on success, failure and cancellation. Keep the protection until all file reads finish and report failed releases during teardown.
4. Host upload, persistence, and export consumers bind their private file publisher or reader to their actual Service-owning context. Keep producer cleanup in its bound drain so staged tickets can release before the provider closes. Under the Web testing policy, public model or direct-service calls cannot modify owner records or release another producer's stages.
5. Verify that failed retention leaves a new Session artifact unpublished, a fork preserves shared bytes independently, deletion refuses files while an export reads them, and producer cleanup finishes before provider withdrawal. Preserve existing Session generations and uninventoried historical files.
