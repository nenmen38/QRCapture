import React from "react";
import ReactDOM from "react-dom/client";
import { Camera, Copy, ImageUp, Link2, Loader2, RotateCcw } from "lucide-react";
import type { BrowserQRCodeReader as QRReader } from "@zxing/browser";
import "./styles.css";

type ScanMode = "idle" | "reading" | "camera" | "found" | "error";

let qrReaderPromise: Promise<QRReader> | null = null;

async function getQrReader() {
  qrReaderPromise ??= import("@zxing/browser").then(
    ({ BrowserQRCodeReader }) => new BrowserQRCodeReader(),
  );
  return qrReaderPromise;
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.name === "NotFoundException";
}

function normalizeTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return null;
  }
}

function App() {
  const [mode, setMode] = React.useState<ScanMode>("idle");
  const [message, setMessage] = React.useState("Paste an image or drop a file here.");
  const [result, setResult] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [cameraError, setCameraError] = React.useState("");
  const [isDragging, setIsDragging] = React.useState(false);
  const [isCopied, setIsCopied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<{ stop: () => void } | null>(null);
  const resultLockedRef = React.useRef(false);

  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((candidate) =>
        candidate.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) {
        void scanFile(file);
      }
    };

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }

  function handleFound(text: string) {
    if (resultLockedRef.current) return;

    const target = normalizeTarget(text);
    resultLockedRef.current = true;
    setResult(text);
    setMode("found");
    stopCamera();
    setMessage(
      target
        ? "QR found. Tap Open when you want to continue."
        : "QR found. This is not a link, so the result is shown below.",
    );
  }

  async function scanFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setMode("error");
      setMessage("Only image files are supported.");
      return;
    }

    stopCamera();
    resultLockedRef.current = false;
    setMode("reading");
    setResult("");
    setCameraError("");
    setMessage("Looking for a QR code.");

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return objectUrl;
    });

    const image = new Image();
    image.src = objectUrl;
    image.onload = async () => {
      try {
        const qrReader = await getQrReader();
        const decoded = await qrReader.decodeFromImageElement(image);
        handleFound(decoded.getText());
      } catch (error) {
        setMode("error");
        setMessage(
          isNotFoundError(error)
            ? "No QR code found. Try a clearer image."
            : "Something went wrong while reading the image.",
        );
      }
    };
    image.onerror = () => {
      setMode("error");
      setMessage("Could not load the image.");
    };
  }

  function resetToIdle() {
    stopCamera();
    setMode("idle");
    setCameraError("");
    setMessage("Paste an image or drop a file here.");
  }

  function toggleCamera() {
    if (mode === "camera") {
      resetToIdle();
      return;
    }

    void startCamera();
  }

  async function startCamera() {
    stopCamera();
    resultLockedRef.current = false;
    setMode("camera");
    setResult("");
    setCameraError("");
    setMessage("Point your camera at a QR code.");

    try {
      if (!videoRef.current) return;
      const qrReader = await getQrReader();
      const controls = await qrReader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (decoded, error) => {
          if (decoded) {
            handleFound(decoded.getText());
            return;
          }

          if (error && !isNotFoundError(error)) {
            setCameraError("Something went wrong while reading the camera feed.");
          }
        },
      );
      controlsRef.current = controls;
    } catch {
      setMode("error");
      setMessage("Could not start the camera.");
      setCameraError("Check that camera permission is allowed in your browser.");
    }
  }

  function onDrop(event: React.DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void scanFile(file);
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1300);
  }

  const targetUrl = result ? normalizeTarget(result) : null;

  return (
    <main className="app-shell">
      <section className="scanner" aria-label="QR scanner">
        <header className="app-header">
        </header>
        <button
          type="button"
          className={`drop-zone ${isDragging ? "dragging" : ""} ${mode}`}
          onClick={() => {
            if (mode !== "camera") inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <video
            ref={videoRef}
            className={`camera-view ${mode === "camera" ? "active" : ""}`}
            muted
            playsInline
          />

          {mode === "camera" ? null : previewUrl ? (
            <img src={previewUrl} alt="Uploaded QR preview" className="preview-image" />
          ) : (
            <span className="drop-empty">
              <ImageUp aria-hidden="true" />
              <strong>Paste in here QR</strong>
            </span>
          )}
          <span className="drop-hint">{message}</span>
          {mode === "reading" ? <Loader2 className="spinner" aria-hidden="true" /> : null}
        </button>

        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void scanFile(file);
            event.currentTarget.value = "";
          }}
        />

        <button
          type="button"
          className={`camera-button ${mode === "camera" ? "active" : ""}`}
          onClick={toggleCamera}
          aria-label={mode === "camera" ? "Turn camera off" : "Scan QR with camera"}
          aria-pressed={mode === "camera"}
        >
          <Camera aria-hidden="true" />
        </button>

        {cameraError ? <p className="error-text">{cameraError}</p> : null}

        {result ? (
          <div className="result-panel">
            <span className="result-label">Scan Result</span>
            <p>{result}</p>
            <div className="result-actions">
              <button type="button" onClick={() => void copyResult()}>
                <Copy aria-hidden="true" />
                {isCopied ? "Copied" : "Copy"}
              </button>
              {targetUrl ? (
                <a href={targetUrl}>
                  <Link2 aria-hidden="true" />
                  Open
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setResult("");
                  setPreviewUrl((current) => {
                    if (current) URL.revokeObjectURL(current);
                    return "";
                  });
                  setMode("idle");
                  setMessage("Paste an image or drop a file here.");
                }}
              >
                <RotateCcw aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
