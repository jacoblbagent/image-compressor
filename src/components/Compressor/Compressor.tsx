import { useRef, useState } from 'react';
import {
  compressImage,
  fitWithin,
  humanSize,
  loadImage,
  objectUrl,
  type CompressOptions,
  type CompressResult,
  type OutputFormat,
} from '../../lib/imageCompress';
import './Compressor.scss';

interface FileEntry {
  id: string;
  file: File;
  originalUrl: string;
  imgW: number;
  imgH: number;
  output: CompressResult | null;
  outputUrl: string;
}

let counter = 0;
const nextId = () => `img-${++counter}-${Date.now()}`;

export function Compressor() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [format, setFormat] = useState<OutputFormat>('jpeg');
  const [quality, setQuality] = useState(0.7);
  const [maxWidth, setMaxWidth] = useState(1600);
  const [lossyPng, setLossyPng] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const opts: CompressOptions = { format, quality, maxWidth, lossyPng };

  // ---- ingest -------------------------------------------------------
  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;

    const added: FileEntry[] = await Promise.all(
      list.map(async (file) => {
        let imgW = 0, imgH = 0;
        try {
          const img = await loadImage(file);
          imgW = img.naturalWidth;
          imgH = img.naturalHeight;
        } catch {
          /* keep 0 -> entry will be skipped below */
        }
        if (!imgW || !imgH) return null as unknown as FileEntry;
        return {
          id: nextId(),
          file,
          originalUrl: URL.createObjectURL(file),
          imgW,
          imgH,
          output: null,
          outputUrl: '',
        };
      })
    );

    const valid = added.filter(Boolean);
    setEntries((prev) => [...prev, ...valid]);
  }

  function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = ''; // allow re-selecting the same file
  }

  function removeEntry(id: string) {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id);
      if (target) {
        URL.revokeObjectURL(target.originalUrl);
        if (target.outputUrl) URL.revokeObjectURL(target.outputUrl);
      }
      return prev.filter((e) => e.id !== id);
    });
  }

  function clearAll() {
    entries.forEach((e) => {
      URL.revokeObjectURL(e.originalUrl);
      if (e.outputUrl) URL.revokeObjectURL(e.outputUrl);
    });
    setEntries([]);
  }

  // ---------- compress ------------------------------------------------
  async function compressAll() {
    if (entries.length === 0 || busy) return;
    setBusy(true);
    try {
      // compress sequentially to keep memory predictable
      for (const entry of entries) {
        const result = await compressImage(entry.file, opts);
        const url = objectUrl(result.blob, entry.outputUrl || null);
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, output: result, outputUrl: url } : e))
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Compression failed.');
    } finally {
      setBusy(false);
    }
  }

  function download(entry: FileEntry) {
    if (!entry.output) return;
    const base = entry.file.name.replace(/\.[^.]+$/, '');
    const slash = format === 'webp' ? 'webp' : format === 'png' ? 'png' : 'jpg';
    const a = document.createElement('a');
    a.href = entry.outputUrl;
    a.download = `${base}-compressed.${slash}`;
    a.click();
  }

  function downloadAll() {
    entries.forEach((e) => e.output && download(e));
  }

  const hasOutput = entries.some((e) => e.output !== null);

  // ---------- render ---------------------------------------------------
  return (
    <div className="compressor page">
      <header className="page-header">
        <h1>Pixel<span className="accent">Slim</span></h1>
        <p className="subtitle">In-browser image compression — no uploads, everything stays on your device.</p>
      </header>

      {/* Controls */}
      <section className="controls card">
        <div className="ctrl">
          <label htmlFor="fmt">Format</label>
          <select id="fmt" value={format} onChange={(e) => setFormat(e.target.value as OutputFormat)}>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="png">PNG</option>
          </select>
        </div>

        {format !== 'png' && (
          <div className="ctrl">
            <label htmlFor="qlty">Quality · {Math.round(quality * 100)}%</label>
            <input
              id="qlty"
              type="range"
              min={0.05} max={1} step={0.05} value={quality}
              onChange={(e) => setQuality(parseFloat(e.target.value))}
            />
          </div>
        )}

        {format === 'png' && (
          <div className="ctrl ctrl-toggle">
            <label>
              <input type="checkbox" checked={lossyPng} onChange={(e) => setLossyPng(e.target.checked)} />
              <span>Lossy palette (8-bit, shrinks photos)</span>
            </label>
          </div>
        )}

        <div className="ctrl">
          <label htmlFor="max">Max wide edge · {maxWidth === 0 ? 'Original' : `${maxWidth}px`}</label>
          <input
            id="maxw"
            type="range"
            min={256} max={4096} step={64} value={maxWidth}
            onChange={(e) => setMaxWidth(parseInt(e.target.value))}
          />
          <button className="link" onClick={() => setMaxWidth(0)}>Keep original</button>
        </div>

        <button className="btn primary" onClick={compressAll} disabled={busy || entries.length === 0}>
          {busy ? 'Compressing…' : entries.length ? `Compress ${entries.length} image${entries.length > 1 ? 's' : ''}` : 'Add images'}
        </button>
      </section>

      {/* Dropzone */}
      <section
        className={`dropzone card ${dragOver ? 'over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
        <p className="drop-title">Drop images here or <span className="accent link">browse</span></p>
        <p className="hint">PNG, JPEG, WebP, GIF, AVIF · processed entirely in your browser</p>
      </section>

      {/* Results */}
      {entries.length > 0 && (
        <section className="results">
          <div className="results-head">
            <span>{entries.length} image{entries.length > 1 ? 's' : ''}</span>
            <div className="head-actions">
              {hasOutput && <button className="btn ghost" onClick={downloadAll}>⤓ Download all</button>}
              <button className="btn ghost" onClick={clearAll}>Clear</button>
            </div>
          </div>

          <div className="grid">
            {entries.map((e) => {
              const { width, height } = fitWithin(e.imgW, e.imgH, maxWidth);
              const pct = e.output
                ? Math.round((1 - e.output.size / e.file.size) * 100)
                : 0;
              const good = e.output !== null && e.output.size < e.file.size;
              return (
                <article className="tile card" key={e.id}>
                  <div className="previews">
                    <figure className="preview">
                      <img src={e.originalUrl} alt="original" />
                      <figcaption>
                        <b>Original</b>
                        <span>{e.imgW}×{e.imgH} · {humanSize(e.file.size)}</span>
                      </figcaption>
                    </figure>
                    <span className="arrow">→</span>
                    <figure className="preview">
                      {e.outputUrl ? (
                        <img src={e.outputUrl} alt="compressed" />
                      ) : (
                        <div className="placeholder">Not compressed yet</div>
                      )}
                      <figcaption>
                        <b>Compressed</b>
                        {e.output ? (
                          <span>{e.output.width}×{e.output.height} · {humanSize(e.output.size)}</span>
                        ) : (
                          <span className="dim">Planned: {width}×{height}</span>
                        )}
                      </figcaption>
                    </figure>
                  </div>

                  <div className="footer">
                    {e.output && (
                      <span className={`badge ${good ? 'good' : 'bad'}`}>
                        {good ? `−${pct}% Saving` : `${pct >= 0 ? '+' : ''}${pct}% Larger`}
                      </span>
                    )}
                    <span className="name" title={e.file.name}>{e.file.name}</span>
                    <button className="btn small" onClick={() => download(e)} disabled={!e.output}>
                      ⤓
                    </button>
                    <button className="btn small muted" onClick={() => removeEntry(e.id)} aria-label="remove">✕</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}