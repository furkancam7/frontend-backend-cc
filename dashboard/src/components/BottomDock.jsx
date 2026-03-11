import { useState, useRef, useEffect, useCallback } from 'react'

const normalizeAccuracy = (detection) => {
  if (!detection) return 0
  const raw = detection.accuracy ?? detection.confidence ?? 0
  const value = typeof raw === 'string' ? parseFloat(raw) : raw
  return value > 1 ? value : value * 100 
}

const drawCornerMarkers = (ctx, x, y, width, height, color, markerSize = 10) => {
  ctx.lineWidth = 3
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y + markerSize)
  ctx.lineTo(x, y)
  ctx.lineTo(x + markerSize, y)
  ctx.moveTo(x + width - markerSize, y)
  ctx.lineTo(x + width, y)
  ctx.lineTo(x + width, y + markerSize)
  ctx.moveTo(x, y + height - markerSize)
  ctx.lineTo(x, y + height)
  ctx.lineTo(x + markerSize, y + height)
  ctx.moveTo(x + width - markerSize, y + height)
  ctx.lineTo(x + width, y + height)
  ctx.lineTo(x + width, y + height - markerSize)
  ctx.stroke()
}

const drawBoundingBox = (ctx, detection, scaleX, scaleY) => {
  if (!detection?.bbox) return

  const { x1, y1, x2, y2 } = detection.bbox
  const scaledX = x1 * scaleX
  const scaledY = y1 * scaleY
  const scaledWidth = (x2 - x1) * scaleX
  const scaledHeight = (y2 - y1) * scaleY
  const color = '#00E0FF'
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.strokeRect(scaledX, scaledY, scaledWidth, scaledHeight)
  const accuracy = normalizeAccuracy(detection)
  const label = `${detection.class || 'object'} ${accuracy.toFixed(2)}%`
  ctx.font = '14px Inter, sans-serif'
  const textMetrics = ctx.measureText(label)
  const textHeight = 20
  const padding = 4
  ctx.fillStyle = color
  ctx.fillRect(scaledX, scaledY - textHeight - padding, textMetrics.width + padding * 2, textHeight + padding)
  ctx.fillStyle = '#000000'
  ctx.font = 'bold 14px Inter, sans-serif'
  ctx.fillText(label, scaledX + padding, scaledY - padding - 4)
  drawCornerMarkers(ctx, scaledX, scaledY, scaledWidth, scaledHeight, color)
}

const calculateCanvasDimensions = (img, containerWidth, containerHeight) => {
  const safeW = Math.max(1, containerWidth)
  const safeH = Math.max(1, containerHeight)
  const imgAspect = img.width / img.height
  const containerAspect = safeW / safeH
  if (imgAspect > containerAspect) {
    return { width: safeW, height: safeW / imgAspect }
  }
  return { width: safeH * imgAspect, height: safeH }
}

export default function BottomDock({ fullFrame, selectedCrop, onClose }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const imageRef = useRef(null)
  const dimensionsRef = useRef({ width: 0, height: 0 })
  const [imageLoaded, setImageLoaded] = useState(false)
  const recordId = fullFrame?.record_id
  const capturedTime = fullFrame?.captured_time
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    const { width: containerW, height: containerH } = dimensionsRef.current
    if (!containerW || !containerH) return

    const dpr = window.devicePixelRatio || 1
    const { width: cssWidth, height: cssHeight } = calculateCanvasDimensions(
      img,
      containerW - 32, 
      containerH - 32
    )
    const physicalWidth = Math.round(cssWidth * dpr)
    const physicalHeight = Math.round(cssHeight * dpr)

    if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
      canvas.width = physicalWidth
      canvas.height = physicalHeight
      canvas.style.width = `${cssWidth}px`
      canvas.style.height = `${cssHeight}px`
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)
    ctx.drawImage(img, 0, 0, cssWidth, cssHeight)

    if (selectedCrop?.bbox) {
      const scaleX = cssWidth / img.width
      const scaleY = cssHeight / img.height
      drawBoundingBox(ctx, selectedCrop, scaleX, scaleY)
    }
  }, [selectedCrop])
  const drawRef = useRef(drawCanvas)
  useEffect(() => {
    drawRef.current = drawCanvas
    if (imageRef.current) {
      requestAnimationFrame(drawCanvas)
    }
  }, [drawCanvas])

  useEffect(() => {
    if (!recordId || !canvasRef.current) return
    const img = new Image()
    let isCancelled = false
    const handleLoad = () => {
      if (isCancelled) return
      imageRef.current = img
      setImageLoaded(true)
    }
    const handleError = () => {
      if (isCancelled) return
      console.error('Failed to load image:', recordId)
    }
    img.onload = handleLoad
    img.onerror = handleError
    img.src = `/api/image/fullframe/${recordId}${capturedTime ? `?t=${encodeURIComponent(capturedTime)}` : ''}`

    return () => {
      isCancelled = true
      img.onload = null
      img.onerror = null
      imageRef.current = null
      setImageLoaded(false)
    }
  }, [recordId, capturedTime])

  useEffect(() => {
    if (imageLoaded) {
      requestAnimationFrame(drawCanvas)
    }
  }, [imageLoaded, drawCanvas])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return

      dimensionsRef.current = { width, height }
      requestAnimationFrame(() => drawRef.current?.())
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  if (!fullFrame) return null

  const displayAccuracy = selectedCrop ? normalizeAccuracy(selectedCrop).toFixed(1) : null

  return (
    <div className="h-[45vh] bg-black border-t-2 border-tactical-border">
      <div className="h-full flex flex-col">
        {}
        <div className="flex items-center justify-between px-4 py-2 bg-tactical-panel border-b border-tactical-border">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium text-tactical-cyan">Full Frame Viewer</div>
            {selectedCrop && (
              <div className="text-xs text-tactical-text-secondary bg-tactical-bg px-2 py-1 rounded border border-tactical-border">
                Showing: <span className="text-tactical-cyan capitalize">{selectedCrop.class}</span>
                <span className="text-amber-400 ml-1">({displayAccuracy}%)</span>
              </div>
            )}
            {imageLoaded && (
              <div className="text-xs text-tactical-text-secondary">
                {fullFrame.detection_count || 0} detection(s) total
              </div>
            )}
          </div>
          <button
            className="tactical-button text-xs hover:bg-red-500/20 px-3 py-1"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {}
        <div ref={containerRef} className="flex-1 bg-black overflow-auto relative">
          <div className="w-full h-full flex items-center justify-center p-4">
            {!imageLoaded && (
              <div className="text-tactical-text-secondary text-sm">
                <div className="animate-pulse flex flex-col items-center gap-2">
                  <div className="w-8 h-8 bg-tactical-cyan rounded-full" />
                  <div>Loading original image with bounding box...</div>
                </div>
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full"
              style={{ display: imageLoaded ? 'block' : 'none' }}
            />
            {imageLoaded && selectedCrop && (
              <div className="absolute bottom-4 left-4 bg-tactical-panel/95 border border-tactical-border px-3 py-2 rounded shadow-lg">
                <span className="text-tactical-text-secondary text-xs">Highlighted: </span>
                <span className="text-tactical-cyan capitalize font-semibold">{selectedCrop.class}</span>
                <span className="text-tactical-text-secondary text-xs ml-2">({displayAccuracy}%)</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
