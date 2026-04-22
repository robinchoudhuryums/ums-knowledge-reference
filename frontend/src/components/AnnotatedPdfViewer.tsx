/**
 * AnnotatedPdfViewer — Interactive PDF viewer with movable/removable annotations,
 * manual highlight drawing, and undo/redo support.
 *
 * Architecture:
 * - PDF.js renders each page onto a <canvas>
 * - An SVG overlay sits on top for interactive annotations
 * - Annotations are positioned using normalized (0-1) coordinates
 * - Manual highlights are drawn by click-dragging on the SVG
 * - Undo/redo stack tracks all annotation mutations
 * - Export flattens current annotations back to a PDF via the backend
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { downloadAnnotatedPdf, type FormReviewField } from '../services/api';

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// --- Types ---

export interface Annotation {
  id: string;
  /** Normalized 0-1 coordinates relative to page */
  x: number;
  y: number;
  width: number;
  height: number;
  page: number; // 1-indexed
  label: string;
  type: 'auto' | 'manual';
  color: 'red' | 'amber' | 'blue' | 'green';
  visible: boolean;
}

type UndoAction =
  | { type: 'remove'; annotation: Annotation }
  | { type: 'add'; annotationId: string }
  | { type: 'move'; annotationId: string; prevX: number; prevY: number }
  | { type: 'restore'; annotation: Annotation };

interface Props {
  /** The original PDF file */
  file: File;
  /** Auto-detected empty fields from form review */
  emptyFields?: FormReviewField[];
  /** Auto-detected low-confidence fields */
  lowConfidenceFields?: FormReviewField[];
  /** Called when viewer is closed */
  onClose: () => void;
}

// --- Helpers ---

let nextId = 1;
function genId(): string {
  return `ann-${nextId++}`;
}

// Raw colors only. PDF.js SVG fill/stroke and on-canvas rendering require
// concrete color strings; CSS variables wouldn't resolve in the SVG
// namespace. These stay decoupled from the warm-paper palette-picker
// intentionally — they encode the backend PDF annotator's semantic
// categories (red=missing required, amber=low-conf, blue=in-progress,
// green=done) and must match the server-side renderer.
const ANNOTATION_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  red: { fill: 'rgba(255, 0, 0, 0.12)', stroke: '#DC2626', label: '#991B1B' },
  amber: { fill: 'rgba(245, 158, 11, 0.12)', stroke: '#D97706', label: '#92400E' },
  blue: { fill: 'rgba(37, 99, 235, 0.12)', stroke: '#2563EB', label: '#1E40AF' },
  green: { fill: 'rgba(5, 150, 105, 0.12)', stroke: '#059669', label: '#065F46' },
};

const PDF_SCALE = 1.5;

// --- Component ---

export function AnnotatedPdfViewer({ file, emptyFields, lowConfidenceFields, onClose }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [tool, setTool] = useState<'select' | 'highlight'>('select');
  const [highlightColor, setHighlightColor] = useState<'red' | 'amber' | 'blue' | 'green'>('blue');
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      if (cancelled) return;
      pdfDocRef.current = pdf;
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [file]);

  // Initialize annotations from form review data
  useEffect(() => {
    const anns: Annotation[] = [];

    if (emptyFields) {
      for (const f of emptyFields) {
        if (f.page === undefined) continue;
        anns.push({
          id: genId(),
          x: 0, y: 0, width: 0.15, height: 0.02, // defaults; will be overridden if bbox available
          page: f.page,
          label: f.key || '(blank field)',
          type: 'auto',
          color: f.isRequired ? 'red' : 'red',
          visible: true,
        });
      }
    }

    if (lowConfidenceFields) {
      for (const f of lowConfidenceFields) {
        if (f.page === undefined) continue;
        anns.push({
          id: genId(),
          x: 0, y: 0, width: 0.15, height: 0.02,
          page: f.page,
          label: f.key || '(uncertain field)',
          type: 'auto',
          color: 'amber',
          visible: true,
        });
      }
    }

    setAnnotations(anns);
  }, [emptyFields, lowConfidenceFields]);

  // Render current page
  useEffect(() => {
    if (!pdfDocRef.current || currentPage < 1) return;
    let cancelled = false;

    async function renderPage() {
      const pdf = pdfDocRef.current!;
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: PDF_SCALE });

      if (cancelled) return;

      setPageDimensions({ width: viewport.width, height: viewport.height });

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
    }

    renderPage();
    return () => { cancelled = true; };
  }, [currentPage, totalPages]);

  // --- Annotation actions ---

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev, action]);
    setRedoStack([]); // Clear redo on new action
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => {
      const ann = prev.find(a => a.id === id);
      if (ann) {
        pushUndo({ type: 'remove', annotation: { ...ann } });
      }
      return prev.filter(a => a.id !== id);
    });
    setSelectedId(null);
  }, [pushUndo]);

  const toggleAnnotationVisibility = useCallback((id: string) => {
    setAnnotations(prev => prev.map(a =>
      a.id === id ? { ...a, visible: !a.visible } : a
    ));
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const remaining = prev.slice(0, -1);

      if (action.type === 'remove') {
        // Restore the removed annotation
        setAnnotations(anns => [...anns, action.annotation]);
        setRedoStack(r => [...r, { type: 'restore', annotation: action.annotation }]);
      } else if (action.type === 'add') {
        // Remove the added annotation
        setAnnotations(anns => {
          const ann = anns.find(a => a.id === action.annotationId);
          if (ann) {
            setRedoStack(r => [...r, { type: 'remove', annotation: { ...ann } }]);
          }
          return anns.filter(a => a.id !== action.annotationId);
        });
      } else if (action.type === 'move') {
        setAnnotations(anns => anns.map(a => {
          if (a.id === action.annotationId) {
            setRedoStack(r => [...r, { type: 'move', annotationId: a.id, prevX: a.x, prevY: a.y }]);
            return { ...a, x: action.prevX, y: action.prevY };
          }
          return a;
        }));
      } else if (action.type === 'restore') {
        setAnnotations(anns => anns.filter(a => a.id !== action.annotation.id));
        setRedoStack(r => [...r, { type: 'add', annotationId: action.annotation.id }]);
      }

      return remaining;
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const action = prev[prev.length - 1];
      const remaining = prev.slice(0, -1);

      if (action.type === 'remove') {
        setAnnotations(anns => [...anns, action.annotation]);
        setUndoStack(u => [...u, { type: 'restore', annotation: action.annotation }]);
      } else if (action.type === 'add') {
        // This was an undo of an add — redo means remove it again
        setAnnotations(anns => {
          const ann = anns.find(a => a.id === action.annotationId);
          if (ann) {
            setUndoStack(u => [...u, { type: 'remove', annotation: { ...ann } }]);
          }
          return anns.filter(a => a.id !== action.annotationId);
        });
      } else if (action.type === 'move') {
        setAnnotations(anns => anns.map(a => {
          if (a.id === action.annotationId) {
            setUndoStack(u => [...u, { type: 'move', annotationId: a.id, prevX: a.x, prevY: a.y }]);
            return { ...a, x: action.prevX, y: action.prevY };
          }
          return a;
        }));
      } else if (action.type === 'restore') {
        setAnnotations(anns => [...anns, action.annotation]);
        setUndoStack(u => [...u, { type: 'add', annotationId: action.annotation.id }]);
      }

      return remaining;
    });
  }, []);

  // --- Mouse handlers for SVG overlay ---

  const getSvgCoords = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / pageDimensions.width,
      y: (e.clientY - rect.top) / pageDimensions.height,
    };
  }, [pageDimensions]);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'highlight') return;
    const coords = getSvgCoords(e);
    setDrawing({ startX: coords.x, startY: coords.y, curX: coords.x, curY: coords.y });
    setSelectedId(null);
  }, [tool, getSvgCoords]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drawing) {
      const coords = getSvgCoords(e);
      setDrawing(prev => prev ? { ...prev, curX: coords.x, curY: coords.y } : null);
      return;
    }

    if (dragging) {
      const coords = getSvgCoords(e);
      const dx = coords.x - dragging.startX;
      const dy = coords.y - dragging.startY;
      setAnnotations(prev => prev.map(a =>
        a.id === dragging.id ? { ...a, x: dragging.origX + dx, y: dragging.origY + dy } : a
      ));
    }
  }, [drawing, dragging, getSvgCoords]);

  const handleSvgMouseUp = useCallback(() => {
    if (drawing) {
      const x = Math.min(drawing.startX, drawing.curX);
      const y = Math.min(drawing.startY, drawing.curY);
      const w = Math.abs(drawing.curX - drawing.startX);
      const h = Math.abs(drawing.curY - drawing.startY);

      // Only create if large enough (prevent accidental clicks)
      if (w > 0.01 && h > 0.005) {
        const newAnn: Annotation = {
          id: genId(),
          x, y, width: w, height: h,
          page: currentPage,
          label: 'Manual highlight',
          type: 'manual',
          color: highlightColor,
          visible: true,
        };
        setAnnotations(prev => [...prev, newAnn]);
        pushUndo({ type: 'add', annotationId: newAnn.id });
      }

      setDrawing(null);
      return;
    }

    if (dragging) {
      // Record final position for undo
      setAnnotations(prev => {
        const ann = prev.find(a => a.id === dragging.id);
        if (ann && (ann.x !== dragging.origX || ann.y !== dragging.origY)) {
          pushUndo({ type: 'move', annotationId: dragging.id, prevX: dragging.origX, prevY: dragging.origY });
        }
        return prev;
      });
      setDragging(null);
    }
  }, [drawing, dragging, currentPage, highlightColor, pushUndo]);

  const handleAnnotationMouseDown = useCallback((e: React.MouseEvent, ann: Annotation) => {
    e.stopPropagation();
    if (tool === 'highlight') return; // Don't interact with annotations in highlight mode

    setSelectedId(ann.id);
    const coords = getSvgCoords(e as unknown as React.MouseEvent<SVGSVGElement>);
    setDragging({ id: ann.id, startX: coords.x, startY: coords.y, origX: ann.x, origY: ann.y });
  }, [tool, getSvgCoords]);

  // --- Export ---

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await downloadAnnotatedPdf(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `REVIEW-${file.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [file]);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          removeAnnotation(selectedId);
        }
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        setTool('select');
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleUndo, handleRedo, selectedId, removeAnnotation]);

  // Current page annotations
  const pageAnnotations = annotations.filter(a => a.page === currentPage && a.visible);
  const hiddenCount = annotations.filter(a => a.page === currentPage && !a.visible).length;

  return (
    <div style={viewerStyles.wrapper}>
      {/* Toolbar */}
      <div style={viewerStyles.toolbar}>
        <div style={viewerStyles.toolbarLeft}>
          <button onClick={onClose} style={viewerStyles.closeBtn}>Close</button>
          <span style={viewerStyles.divider} />

          {/* Page navigation */}
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={currentPage <= 1 ? viewerStyles.navBtnDisabled : viewerStyles.navBtn}
          >
            Prev
          </button>
          <span style={viewerStyles.pageInfo}>Page {currentPage} / {totalPages}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={currentPage >= totalPages ? viewerStyles.navBtnDisabled : viewerStyles.navBtn}
          >
            Next
          </button>

          <span style={viewerStyles.divider} />

          {/* Tool selection */}
          <button
            onClick={() => setTool('select')}
            style={tool === 'select' ? viewerStyles.toolBtnActive : viewerStyles.toolBtn}
          >
            Select / Move
          </button>
          <button
            onClick={() => setTool('highlight')}
            style={tool === 'highlight' ? viewerStyles.toolBtnActiveHighlight : viewerStyles.toolBtn}
          >
            Highlight
          </button>

          {tool === 'highlight' && (
            <div style={viewerStyles.colorPicker}>
              {(['red', 'amber', 'blue', 'green'] as const).map(c => (
                <button
                  key={c}
                  onClick={() => setHighlightColor(c)}
                  style={{
                    ...viewerStyles.colorSwatch,
                    background: ANNOTATION_COLORS[c].stroke,
                    outline: highlightColor === c ? '2px solid var(--foreground)' : 'none',
                    outlineOffset: '2px',
                  }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        <div style={viewerStyles.toolbarRight}>
          {/* Undo/Redo */}
          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            style={undoStack.length === 0 ? viewerStyles.actionBtnDisabled : viewerStyles.actionBtn}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={redoStack.length === 0 ? viewerStyles.actionBtnDisabled : viewerStyles.actionBtn}
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>

          <span style={viewerStyles.divider} />

          <button
            onClick={handleExport}
            disabled={exporting}
            style={exporting ? viewerStyles.exportBtnDisabled : viewerStyles.exportBtn}
          >
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div style={viewerStyles.statusBar}>
        <span>{pageAnnotations.length} annotation{pageAnnotations.length !== 1 ? 's' : ''} on this page</span>
        {hiddenCount > 0 && (
          <span style={viewerStyles.hiddenNote}>{hiddenCount} hidden</span>
        )}
        {selectedId && (
          <span style={viewerStyles.selectedNote}>
            Selected: {annotations.find(a => a.id === selectedId)?.label}
            {' '}
            <button onClick={() => removeAnnotation(selectedId)} style={viewerStyles.removeLink}>Remove</button>
            {' '}
            <button onClick={() => toggleAnnotationVisibility(selectedId)} style={viewerStyles.removeLink}>Hide</button>
          </span>
        )}
        {tool === 'highlight' && (
          <span style={viewerStyles.toolHint}>Click and drag to draw a highlight rectangle</span>
        )}
        {tool === 'select' && (
          <span style={viewerStyles.toolHint}>Click to select, drag to move, Delete to remove</span>
        )}
      </div>

      {/* PDF + Annotation overlay */}
      <div style={viewerStyles.canvasContainer} ref={containerRef}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <canvas ref={canvasRef} style={viewerStyles.canvas} />

          {pageDimensions.width > 0 && (
            <svg
              ref={svgRef}
              width={pageDimensions.width}
              height={pageDimensions.height}
              style={viewerStyles.svgOverlay}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onMouseLeave={handleSvgMouseUp}
            >
              {/* Rendered annotations */}
              {pageAnnotations.map(ann => {
                const colors = ANNOTATION_COLORS[ann.color];
                const px = ann.x * pageDimensions.width;
                const py = ann.y * pageDimensions.height;
                const pw = ann.width * pageDimensions.width;
                const ph = ann.height * pageDimensions.height;
                const isSelected = selectedId === ann.id;

                return (
                  <g key={ann.id} style={{ cursor: tool === 'select' ? 'move' : 'default' }}>
                    {/* Highlight rect */}
                    <rect
                      x={px}
                      y={py}
                      width={pw}
                      height={ph}
                      fill={colors.fill}
                      stroke={isSelected ? 'var(--foreground)' : colors.stroke}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      strokeDasharray={isSelected ? '4 2' : 'none'}
                      onMouseDown={(e) => handleAnnotationMouseDown(e, ann)}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(ann.id); }}
                    />
                    {/* Label */}
                    <text
                      x={px + 2}
                      y={py - 3}
                      fontSize="10"
                      fill={colors.label}
                      fontFamily="Helvetica, Arial, sans-serif"
                      fontWeight="600"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {ann.label.length > 35 ? ann.label.slice(0, 32) + '...' : ann.label}
                    </text>
                    {/* Remove button (when selected) */}
                    {isSelected && (
                      <g
                        onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle cx={px + pw + 6} cy={py - 6} r={8} fill="#DC2626" />
                        <text x={px + pw + 2.5} y={py - 2.5} fontSize="11" fill="white" fontWeight="bold">x</text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Drawing preview */}
              {drawing && (
                <rect
                  x={Math.min(drawing.startX, drawing.curX) * pageDimensions.width}
                  y={Math.min(drawing.startY, drawing.curY) * pageDimensions.height}
                  width={Math.abs(drawing.curX - drawing.startX) * pageDimensions.width}
                  height={Math.abs(drawing.curY - drawing.startY) * pageDimensions.height}
                  fill={ANNOTATION_COLORS[highlightColor].fill}
                  stroke={ANNOTATION_COLORS[highlightColor].stroke}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                />
              )}
            </svg>
          )}
        </div>
      </div>

      {/* Annotation list sidebar */}
      <div style={viewerStyles.sidebar}>
        <h4 style={viewerStyles.sidebarTitle}>Annotations ({annotations.filter(a => a.page === currentPage).length})</h4>
        <div style={viewerStyles.annList}>
          {annotations.filter(a => a.page === currentPage).map(ann => (
            <div
              key={ann.id}
              style={{
                ...viewerStyles.annItem,
                opacity: ann.visible ? 1 : 0.4,
                borderLeft: selectedId === ann.id ? `3px solid ${ANNOTATION_COLORS[ann.color].stroke}` : '3px solid transparent',
              }}
              onClick={() => setSelectedId(ann.id)}
            >
              <div style={viewerStyles.annItemTop}>
                <span
                  style={{
                    ...viewerStyles.annDot,
                    background: ANNOTATION_COLORS[ann.color].stroke,
                  }}
                />
                <span style={viewerStyles.annLabel}>
                  {ann.label.length > 25 ? ann.label.slice(0, 22) + '...' : ann.label}
                </span>
                <span style={viewerStyles.annType}>{ann.type}</span>
              </div>
              <div style={viewerStyles.annActions}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleAnnotationVisibility(ann.id); }}
                  style={viewerStyles.annActionBtn}
                >
                  {ann.visible ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }}
                  style={viewerStyles.annActionBtnDanger}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {annotations.filter(a => a.page === currentPage).length === 0 && (
            <p style={viewerStyles.annEmpty}>No annotations on this page</p>
          )}
        </div>
      </div>
    </div>
  );
}

const viewerStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--muted)',
    position: 'relative',
  },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 16px', background: 'var(--card)',
    borderBottom: '1px solid var(--border)', gap: '8px', flexShrink: 0,
    flexWrap: 'wrap',
  },
  toolbarLeft: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  toolbarRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  closeBtn: {
    padding: '6px 14px', border: '1px solid var(--border)', borderRadius: '8px',
    background: 'var(--card)', color: 'var(--foreground)', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
  },
  divider: {
    width: '1px', height: '24px', background: 'var(--border)', display: 'inline-block',
  },
  navBtn: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: '6px',
    background: 'var(--card)', color: 'var(--foreground)', fontSize: '12px', cursor: 'pointer',
  },
  navBtnDisabled: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: '6px',
    background: 'var(--muted)', color: 'var(--muted-foreground)', fontSize: '12px', cursor: 'default',
  },
  pageInfo: { fontSize: '13px', color: 'var(--foreground)', fontWeight: 600 },
  toolBtn: {
    padding: '6px 14px', border: '1px solid var(--border)', borderRadius: '8px',
    background: 'var(--card)', color: 'var(--muted-foreground)', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
  },
  toolBtnActive: {
    padding: '6px 14px', border: '1px solid var(--accent)', borderRadius: '8px',
    background: 'var(--copper-soft)', color: 'var(--accent)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  },
  toolBtnActiveHighlight: {
    padding: '6px 14px', border: '1px solid var(--amber)', borderRadius: '8px',
    background: 'var(--amber-soft)', color: 'var(--amber)', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  },
  colorPicker: { display: 'flex', gap: '4px', alignItems: 'center' },
  colorSwatch: {
    width: '20px', height: '20px', borderRadius: '4px', border: 'none',
    cursor: 'pointer',
  },
  actionBtn: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: '6px',
    background: 'var(--card)', color: 'var(--foreground)', fontSize: '12px', cursor: 'pointer',
  },
  actionBtnDisabled: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: '6px',
    background: 'var(--muted)', color: 'var(--muted-foreground)', fontSize: '12px', cursor: 'default',
  },
  exportBtn: {
    padding: '6px 16px', border: 'none', borderRadius: '8px',
    background: 'var(--accent)', color: 'white',
    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(27, 111, 201, 0.25)',
  },
  exportBtnDisabled: {
    padding: '6px 16px', border: 'none', borderRadius: '8px',
    background: 'var(--muted-foreground)', color: 'white',
    fontSize: '12px', fontWeight: 600, cursor: 'wait',
  },

  // Status bar
  statusBar: {
    display: 'flex', alignItems: 'center', gap: '16px', padding: '4px 16px',
    background: 'var(--muted)', borderBottom: '1px solid var(--border)', fontSize: '11px',
    color: 'var(--muted-foreground)', flexShrink: 0,
  },
  hiddenNote: { color: 'var(--amber)' },
  selectedNote: { color: 'var(--accent)', fontWeight: 600 },
  removeLink: {
    background: 'none', border: 'none', color: 'var(--warm-red)', fontSize: '11px',
    cursor: 'pointer', textDecoration: 'underline', padding: 0,
  },
  toolHint: { fontStyle: 'italic', color: 'var(--muted-foreground)' },

  // Canvas area
  canvasContainer: {
    flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center',
    padding: '20px', minHeight: 0,
  },
  canvas: { display: 'block', boxShadow: '0 2px 12px rgba(0,0,0,0.1)' },
  svgOverlay: {
    position: 'absolute', top: 0, left: 0,
    cursor: 'crosshair',
  },

  // Sidebar
  sidebar: {
    position: 'absolute', right: 0, top: '88px', bottom: 0, width: '240px',
    background: 'var(--card)', borderLeft: '1px solid var(--border)',
    overflowY: 'auto', padding: '12px', zIndex: 5,
  },
  sidebarTitle: {
    margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: 'var(--foreground)',
  },
  annList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  annItem: {
    padding: '8px', borderRadius: '6px', background: 'var(--muted)',
    cursor: 'pointer', transition: 'background 0.1s',
  },
  annItemTop: {
    display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px',
  },
  annDot: {
    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
  },
  annLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--foreground)', flex: 1 },
  annType: {
    fontSize: '9px', padding: '1px 4px', borderRadius: '3px',
    background: 'var(--border)', color: 'var(--muted-foreground)', textTransform: 'uppercase',
    fontWeight: 600, letterSpacing: '0.3px',
  },
  annActions: { display: 'flex', gap: '6px' },
  annActionBtn: {
    padding: '2px 8px', border: '1px solid var(--border)', borderRadius: '4px',
    background: 'var(--card)', color: 'var(--muted-foreground)', fontSize: '10px', cursor: 'pointer',
  },
  annActionBtnDanger: {
    padding: '2px 8px', border: '1px solid var(--warm-red)', borderRadius: '4px',
    background: 'var(--warm-red-soft)', color: 'var(--warm-red)', fontSize: '10px', cursor: 'pointer',
  },
  annEmpty: {
    margin: 0, fontSize: '12px', color: 'var(--muted-foreground)', fontStyle: 'italic',
  },
};
