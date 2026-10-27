type GlobalFileDropCallbacks = {
  onFiles: (files: File[]) => void;
  onUnreadable: () => void;
};

const INTERNAL_DRAG_TYPE = "application/x-chattask-internal-drag";

/** A drag that started in the app must never be imported as an external file. */
export function installGlobalFileDrop({ onFiles, onUnreadable }: GlobalFileDropCallbacks) {
  let internalDrag = false;
  const markInternalDrag = (event: DragEvent) => {
    internalDrag = true;
    try { event.dataTransfer?.setData(INTERNAL_DRAG_TYPE, "1"); } catch { /* Some native drags do not allow custom types. */ }
  };
  const clearInternalDrag = () => { internalDrag = false; };
  const preventFileNavigation = (event: DragEvent) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  };
  const handleDrop = (event: DragEvent) => {
    const startedInApp = internalDrag || Boolean(event.dataTransfer?.types.includes(INTERNAL_DRAG_TYPE));
    internalDrag = false;
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    if (startedInApp) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onFiles(files);
    else onUnreadable();
  };

  document.addEventListener("dragstart", markInternalDrag, true);
  window.addEventListener("dragend", clearInternalDrag, true);
  window.addEventListener("blur", clearInternalDrag);
  window.addEventListener("dragover", preventFileNavigation);
  window.addEventListener("drop", handleDrop);
  return () => {
    document.removeEventListener("dragstart", markInternalDrag, true);
    window.removeEventListener("dragend", clearInternalDrag, true);
    window.removeEventListener("blur", clearInternalDrag);
    window.removeEventListener("dragover", preventFileNavigation);
    window.removeEventListener("drop", handleDrop);
  };
}
