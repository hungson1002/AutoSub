export type UploadRequest = {
  id: number;
  controller: AbortController;
};

export class LatestUploadGuard {
  private nextId = 0;
  private active?: UploadRequest;

  begin() {
    this.active?.controller.abort();
    const request = { id: ++this.nextId, controller: new AbortController() };
    this.active = request;
    return request;
  }

  isCurrent(request: UploadRequest) {
    return this.active?.id === request.id;
  }

  complete(request: UploadRequest) {
    if (!this.isCurrent(request)) return false;
    this.active = undefined;
    return true;
  }

  cancel() {
    this.active?.controller.abort();
    this.active = undefined;
  }
}
