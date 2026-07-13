/*
 * 隐藏视图启动或 SDK 初始化期间使用定时器驱动帧回调；
 * 初始化完成后恢复原生实现，使隐藏期间提交的帧在视图显示时继续执行。
 */
if(typeof window !== 'undefined') {
  const FRAME_MS = 1000 / 60;
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const handles = new Map<number, {native: boolean, handle: number}>();
  let nextHandle = 0;

  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = ++nextHandle;
    const wrappedCallback = (timestamp: number) => {
      handles.delete(id);
      callback(timestamp);
    };
    const apiUtils = (window as any).ApiUtils;
    const shouldUseTimer = apiUtils?.initialized === false || (document.hidden && !apiUtils);
    if(shouldUseTimer) {
      const handle = window.setTimeout(() => wrappedCallback(performance.now()), FRAME_MS);
      handles.set(id, {native: false, handle});
    } else {
      const handle = nativeRequestAnimationFrame(wrappedCallback);
      handles.set(id, {native: true, handle});
    }

    return id;
  };

  window.cancelAnimationFrame = (id: number) => {
    const entry = handles.get(id);
    if(!entry) return;
    handles.delete(id);
    if(entry.native) nativeCancelAnimationFrame(entry.handle);
    else window.clearTimeout(entry.handle);
  };
}
