// Renderer interface contract.
//
// All positions and sizes are in world-space meters unless the name ends in _px.
// The renderer owns the world-to-screen transform. A future Three.js renderer
// must expose the same methods to be a drop-in swap.
//
//   resize()
//   beginFrame()
//   endFrame()
//   setCamera({ x, y, zoom })
//   getCamera() -> { x, y, zoom }
//   drawGrid(step, color)
//   drawCircle(x, y, r, style)
//   drawEllipse(x, y, rx, ry, rotation, style)
//   drawRect(x, y, w, h, style)
//   drawLine(x1, y1, x2, y2, style)
//   drawPolygon(points, style)
//   drawText(x, y, text, style)        // world anchor, screen-pixel font size
//   screenToWorld(sx, sy) -> { x, y }
//   getSize() -> { w, h }              // CSS pixels
//
// style = { fill, stroke, lineWidth, alpha }

export { createCanvas2DRenderer } from './canvas2d.js';
